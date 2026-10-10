package healthlab

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

// labWedgeEscrow injects a one-shot fault into the escrow resolve leg, then
// delegates to the real service via labUnwindEscrow. It is the live-DB
// stand-in for "the domain transition committed and THEN the money leg
// faulted" (ledger F2): the first call fails after the transition, the retry
// must re-enter and complete the idempotent release/refund exactly once.
type labWedgeEscrow struct {
	labUnwindEscrow
	failRelease bool
	failRefund  bool
}

func (e *labWedgeEscrow) Release(ctx context.Context, escrowID, payeeID string) error {
	if e.failRelease {
		e.failRelease = false
		return errors.New("wedge: injected release fault")
	}
	return e.labUnwindEscrow.Release(ctx, escrowID, payeeID)
}
func (e *labWedgeEscrow) Refund(ctx context.Context, escrowID string) error {
	if e.failRefund {
		e.failRefund = false
		return errors.New("wedge: injected refund fault")
	}
	return e.labUnwindEscrow.Refund(ctx, escrowID)
}

func newLabWedgeService(pool *pgxpool.Pool, e EscrowHolder) *Service {
	return NewService(pool, e, nil, nil, nil, nil, nil, nil)
}

func seedLabHeldHold(t *testing.T, ctx context.Context, pool *pgxpool.Pool, payerID, ref string, kobo int64) string {
	t.Helper()
	escrowID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO escrow_holds (id, reference, module_type, payer_id, amount_kobo, state, idempotency_key)
		VALUES ($1,$2,'health.lab',$3,$4,'HELD',$5)`,
		escrowID, ref, payerID, kobo, "labwedge-"+escrowID); err != nil {
		t.Fatalf("seed escrow hold: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM escrow_holds WHERE id=$1`, escrowID)
	})
	return escrowID
}

func labHoldState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, escrowID string) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(ctx, `SELECT state FROM escrow_holds WHERE id=$1`, escrowID).Scan(&s); err != nil {
		t.Fatalf("read hold state: %v", err)
	}
	return s
}

// labOrderState is already defined in authz_live_db_test.go.

// labWalletKobo projects the wallet balance straight off the ledger — the same
// math the wallet projection uses — so a double-posting surfaces immediately.
func labWalletKobo(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int64 {
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

func seedLabTestAndResult(t *testing.T, ctx context.Context, pool *pgxpool.Pool, labID, orderID, enteredBy string) {
	t.Helper()
	testID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_tests (id, lab_provider_id, name, price_kobo, active) VALUES ($1,$2,'Wedge Panel',150000,true)`,
		testID, labID); err != nil {
		t.Fatalf("seed lab_test: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_results (order_id, test_id, test_name, value, status, validated_by) VALUES ($1,$2,'Wedge Panel','4.2','NORMAL',$3)`,
		orderID, testID, enteredBy); err != nil {
		t.Fatalf("seed lab_result: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM lab_tests WHERE id=$1`, testID)
	})
}

// RESULT_READY → RELEASED commits; the release leg faults. The retry must not
// be refused by canReleaseFrom — it skips the transition (and the vault write /
// released_by side effects, which committed the first time) and reruns the
// idempotent release leg exactly once (ledger F2).
func TestLiveDB_LabRelease_ReleaseFaultReentersMoneyLeg(t *testing.T) {
	pool := labUnwindPool(t)
	ctx := context.Background()
	patientID, ownerID, _, _, _, labID := seedLabAuthzFixture(t, ctx, pool)

	wedge := &labWedgeEscrow{
		labUnwindEscrow: labUnwindEscrow{e: escrow.NewService(pool, ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil)), nil)},
		failRelease:     true,
	}
	svc := newLabWedgeService(pool, wedge)

	escrowID := seedLabHeldHold(t, ctx, pool, patientID, "lab-wedge-release", 150000)
	orderID := seedLabOrder(t, ctx, pool, patientID, labID, "RESULT_READY", "WALK_IN")
	if _, err := pool.Exec(ctx, `UPDATE lab_orders SET escrow_id=$2 WHERE id=$1`, orderID, escrowID); err != nil {
		t.Fatalf("bind escrow: %v", err)
	}
	seedLabTestAndResult(t, ctx, pool, labID, orderID, ownerID)

	if _, err := svc.Release(ctx, ownerID, orderID); err == nil {
		t.Fatal("first Release must fail on the injected release fault")
	}
	if got := labOrderState(t, ctx, pool, orderID); got != "RELEASED" {
		t.Fatalf("state = %s after faulted release, want RELEASED (transition committed)", got)
	}
	if got := labHoldState(t, ctx, pool, escrowID); got != "HELD" {
		t.Fatalf("hold = %s after faulted release, want still HELD", got)
	}
	if got := labWalletKobo(t, ctx, pool, ownerID); got != 0 {
		t.Fatalf("payee credited %d before retry, want 0", got)
	}

	// Re-entry: RELEASED skips the transition + vault write, reruns the leg.
	out, err := svc.Release(ctx, ownerID, orderID)
	if err != nil {
		t.Fatalf("re-entry Release must retry the money leg, got %v", err)
	}
	if out.State != StateClosed {
		t.Fatalf("state = %s after re-entry, want CLOSED", out.State)
	}
	if got := labHoldState(t, ctx, pool, escrowID); got != "RELEASED" {
		t.Fatalf("hold = %s, want RELEASED", got)
	}
	if got := labWalletKobo(t, ctx, pool, ownerID); got != 150000 {
		t.Fatalf("payee credited %d, want exactly 150000 once", got)
	}

	// CLOSED replay is safe — no second posting.
	if _, err := svc.Release(ctx, ownerID, orderID); err != nil {
		t.Fatalf("terminal replay must succeed, got %v", err)
	}
	if got := labWalletKobo(t, ctx, pool, ownerID); got != 150000 {
		t.Fatalf("payee credited %d after replay, want 150000 (exactly once)", got)
	}
}

// CREATED → CANCELLED commits; the refund leg faults. The retry must re-enter
// through the already-cancelled state and refund the hold exactly once.
func TestLiveDB_LabCancel_RefundFaultReentersMoneyLeg(t *testing.T) {
	pool := labUnwindPool(t)
	ctx := context.Background()
	patientID, _, _, _, _, labID := seedLabAuthzFixture(t, ctx, pool)

	wedge := &labWedgeEscrow{
		labUnwindEscrow: labUnwindEscrow{e: escrow.NewService(pool, ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil)), nil)},
		failRefund:      true,
	}
	svc := newLabWedgeService(pool, wedge)

	escrowID := seedLabHeldHold(t, ctx, pool, patientID, "lab-wedge-cancel", 150000)
	orderID := seedLabOrder(t, ctx, pool, patientID, labID, "CREATED", "WALK_IN")
	if _, err := pool.Exec(ctx, `UPDATE lab_orders SET escrow_id=$2 WHERE id=$1`, orderID, escrowID); err != nil {
		t.Fatalf("bind escrow: %v", err)
	}

	if _, err := svc.Cancel(ctx, patientID, orderID, "changed mind"); err == nil {
		t.Fatal("first Cancel must fail on the injected refund fault")
	}
	if got := labOrderState(t, ctx, pool, orderID); got != "CANCELLED" {
		t.Fatalf("state = %s after faulted refund, want CANCELLED", got)
	}
	if got := labHoldState(t, ctx, pool, escrowID); got != "HELD" {
		t.Fatalf("hold = %s, want still HELD", got)
	}

	// Re-entry: CANCELLED skips the transition, reruns the refund leg.
	out, err := svc.Cancel(ctx, patientID, orderID, "changed mind")
	if err != nil {
		t.Fatalf("re-entry Cancel must retry the refund leg, got %v", err)
	}
	if out.State != StateRefunded {
		t.Fatalf("state = %s after re-entry, want REFUNDED", out.State)
	}
	if got := labHoldState(t, ctx, pool, escrowID); got != "REFUNDED" {
		t.Fatalf("hold = %s, want REFUNDED", got)
	}
	if got := labWalletKobo(t, ctx, pool, patientID); got != 150000 {
		t.Fatalf("payer refunded %d, want exactly 150000 once", got)
	}

	// REFUNDED replay is safe — no second posting.
	if _, err := svc.Cancel(ctx, patientID, orderID, ""); err != nil {
		t.Fatalf("terminal replay must succeed, got %v", err)
	}
	if got := labWalletKobo(t, ctx, pool, patientID); got != 150000 {
		t.Fatalf("payer refunded %d after replay, want 150000 (exactly once)", got)
	}
}
