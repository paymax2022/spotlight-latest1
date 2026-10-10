package healthpharmacy

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/ledger"
)

// wedgeEscrow injects a one-shot fault into the escrow resolve leg, then
// delegates to the real service. It is the live-DB stand-in for "the domain
// transition committed and THEN the money leg faulted" (ledger F2): the first
// call fails after the transition, the retry must re-enter and complete the
// idempotent release/refund exactly once.
type wedgeHoldRef struct{ id string }

func (h wedgeHoldRef) HoldID() string { return h.id }

type wedgeEscrow struct {
	real        *escrow.Service
	failRelease bool
	failRefund  bool
}

func (w *wedgeEscrow) Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (HoldRef, error) {
	hold, err := w.real.Hold(ctx, payerID, reference, moduleType, idemKey, amountKobo)
	if err != nil {
		return nil, err
	}
	return wedgeHoldRef{id: hold.ID}, nil
}
func (w *wedgeEscrow) Release(ctx context.Context, escrowID, payeeID string) error {
	if w.failRelease {
		w.failRelease = false
		return errors.New("wedge: injected release fault")
	}
	return w.real.Release(ctx, escrowID, payeeID)
}
func (w *wedgeEscrow) Refund(ctx context.Context, escrowID string) error {
	if w.failRefund {
		w.failRefund = false
		return errors.New("wedge: injected refund fault")
	}
	return w.real.Refund(ctx, escrowID)
}

func seedHeldHold(t *testing.T, ctx context.Context, pool *pgxpool.Pool, payerID, ref string, kobo int64) (escrowID string) {
	t.Helper()
	escrowID = uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO escrow_holds (id, reference, module_type, payer_id, amount_kobo, state, idempotency_key)
		VALUES ($1,$2,'health.pharmacy',$3,$4,'HELD',$5)`,
		escrowID, ref, payerID, kobo, "wedge-"+escrowID); err != nil {
		t.Fatalf("seed escrow hold: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM escrow_holds WHERE id=$1`, escrowID) })
	return escrowID
}

func holdState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, escrowID string) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(ctx, `SELECT state FROM escrow_holds WHERE id=$1`, escrowID).Scan(&s); err != nil {
		t.Fatalf("read hold state: %v", err)
	}
	return s
}

// walletKobo projects the wallet balance straight off the ledger — the same
// math the wallet projection uses — so an over- or double-posting surfaces as
// a wrong total.
func walletKobo(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN le.type='CREDIT' THEN le.amount_kobo ELSE -le.amount_kobo END),0)
		FROM ledger_entries le
		JOIN ledger_accounts la ON la.id = le.account_id
		WHERE la.user_id = $1`, userID).Scan(&bal); err != nil {
		t.Fatalf("wallet balance: %v", err)
	}
	return bal
}

// orderState is already defined in authz_live_db_test.go.

func newWedgeService(pool *pgxpool.Pool, w *wedgeEscrow) *Service {
	return NewService(pool, w, nil, nil, nil, nil, nil, nil)
}

// READY_FOR_PICKUP → COLLECTED commits; the release leg faults. The retry must
// not be refused by "already COLLECTED" — it skips the transition and reruns
// the idempotent release leg exactly once (ledger F2).
func TestLiveDB_Complete_ReleaseFaultReentersMoneyLeg(t *testing.T) {
	pool := authzPool(t)
	ctx := context.Background()
	patientID, ownerID, _, pharmacyID := seedAuthzFixture(t, ctx, pool)

	wedge := &wedgeEscrow{real: escrow.NewService(pool, ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil)), nil), failRelease: true}
	svc := newWedgeService(pool, wedge)

	escrowID := seedHeldHold(t, ctx, pool, patientID, "pharmacy-wedge-complete", 50000)
	orderID := seedOrder(t, ctx, pool, patientID, pharmacyID, "READY_FOR_PICKUP", "PICKUP",
		map[string]any{"pickup_code": "654321", "escrow_id": escrowID})

	if _, err := svc.Complete(ctx, patientID, orderID, "654321"); err == nil {
		t.Fatal("first Complete must fail on the injected release fault")
	}
	if got := orderState(t, ctx, pool, orderID); got != "COLLECTED" {
		t.Fatalf("state = %s after faulted release, want COLLECTED (transition committed)", got)
	}
	if got := holdState(t, ctx, pool, escrowID); got != "HELD" {
		t.Fatalf("hold = %s after faulted release, want still HELD", got)
	}
	if got := walletKobo(t, ctx, pool, ownerID); got != 0 {
		t.Fatalf("payee credited %d before retry, want 0", got)
	}

	// Re-entry: state is already COLLECTED — same target → skip the
	// transition, rerun the idempotent release leg.
	out, err := svc.Complete(ctx, patientID, orderID, "")
	if err != nil {
		t.Fatalf("re-entry Complete must retry the money leg, got %v", err)
	}
	if out.State != StateClosed {
		t.Fatalf("state = %s after re-entry, want CLOSED", out.State)
	}
	if got := holdState(t, ctx, pool, escrowID); got != "RELEASED" {
		t.Fatalf("hold = %s, want RELEASED", got)
	}
	if got := walletKobo(t, ctx, pool, ownerID); got != 50000 {
		t.Fatalf("payee credited %d, want exactly 50000 once", got)
	}

	// A third call replays safely: no second posting.
	if _, err := svc.Complete(ctx, patientID, orderID, ""); err != nil {
		t.Fatalf("terminal replay must succeed, got %v", err)
	}
	if got := walletKobo(t, ctx, pool, ownerID); got != 50000 {
		t.Fatalf("payee credited %d after replay, want 50000 (exactly once)", got)
	}
}

// Same wedge on the delivery leg: IN_DELIVERY → DELIVERED commits, release
// faults, retry re-enters and releases the hold.
func TestLiveDB_Complete_DeliveryReleaseFaultReentersMoneyLeg(t *testing.T) {
	pool := authzPool(t)
	ctx := context.Background()
	patientID, ownerID, _, pharmacyID := seedAuthzFixture(t, ctx, pool)

	wedge := &wedgeEscrow{real: escrow.NewService(pool, ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil)), nil), failRelease: true}
	svc := newWedgeService(pool, wedge)

	escrowID := seedHeldHold(t, ctx, pool, patientID, "pharmacy-wedge-deliver", 50000)
	orderID := seedOrder(t, ctx, pool, patientID, pharmacyID, "IN_DELIVERY", "DELIVERY",
		map[string]any{"pickup_code": "123456", "delivery_ref": "deliv-wedge-1", "escrow_id": escrowID})

	if _, err := svc.Complete(ctx, ownerID, orderID, "123456"); err == nil {
		t.Fatal("first Complete must fail on the injected release fault")
	}
	if got := orderState(t, ctx, pool, orderID); got != "DELIVERED" {
		t.Fatalf("state = %s after faulted release, want DELIVERED", got)
	}
	if got := holdState(t, ctx, pool, escrowID); got != "HELD" {
		t.Fatalf("hold = %s, want still HELD", got)
	}

	out, err := svc.Complete(ctx, ownerID, orderID, "")
	if err != nil {
		t.Fatalf("re-entry Complete must retry the money leg, got %v", err)
	}
	if out.State != StateClosed {
		t.Fatalf("state = %s after re-entry, want CLOSED", out.State)
	}
	if got := holdState(t, ctx, pool, escrowID); got != "RELEASED" {
		t.Fatalf("hold = %s, want RELEASED", got)
	}
	if got := walletKobo(t, ctx, pool, ownerID); got != 50000 {
		t.Fatalf("payee credited %d, want 50000", got)
	}
}

// CONFIRMED → CANCELLED commits; the refund leg faults. The retry must re-enter
// through the already-cancelled state and refund the hold exactly once.
func TestLiveDB_Cancel_RefundFaultReentersMoneyLeg(t *testing.T) {
	pool := authzPool(t)
	ctx := context.Background()
	patientID, _, _, pharmacyID := seedAuthzFixture(t, ctx, pool)

	wedge := &wedgeEscrow{real: escrow.NewService(pool, ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil)), nil), failRefund: true}
	svc := newWedgeService(pool, wedge)

	escrowID := seedHeldHold(t, ctx, pool, patientID, "pharmacy-wedge-cancel", 50000)
	orderID := seedOrder(t, ctx, pool, patientID, pharmacyID, "CONFIRMED", "PICKUP",
		map[string]any{"escrow_id": escrowID})

	if _, err := svc.Cancel(ctx, patientID, orderID, "changed mind"); err == nil {
		t.Fatal("first Cancel must fail on the injected refund fault")
	}
	if got := orderState(t, ctx, pool, orderID); got != "CANCELLED" {
		t.Fatalf("state = %s after faulted refund, want CANCELLED", got)
	}
	if got := holdState(t, ctx, pool, escrowID); got != "HELD" {
		t.Fatalf("hold = %s, want still HELD", got)
	}

	// Re-entry: CANCELLED skips the transition, reruns the refund leg.
	if _, err := svc.Cancel(ctx, patientID, orderID, "changed mind"); err != nil {
		t.Fatalf("re-entry Cancel must retry the refund leg, got %v", err)
	}
	if got := orderState(t, ctx, pool, orderID); got != "REFUNDED" {
		t.Fatalf("state = %s after re-entry, want REFUNDED", got)
	}
	if got := holdState(t, ctx, pool, escrowID); got != "REFUNDED" {
		t.Fatalf("hold = %s, want REFUNDED", got)
	}
	if got := walletKobo(t, ctx, pool, patientID); got != 50000 {
		t.Fatalf("payer refunded %d, want exactly 50000 once", got)
	}

	// Third call replays safely — REFUNDED is a refund re-entry state too.
	if _, err := svc.Cancel(ctx, patientID, orderID, ""); err != nil {
		t.Fatalf("terminal replay must succeed, got %v", err)
	}
	if got := walletKobo(t, ctx, pool, patientID); got != 50000 {
		t.Fatalf("payer refunded %d after replay, want 50000 (exactly once)", got)
	}
}
