package healthpharmacy

// LIVE-DB regression coverage for the order-actor authorization gaps fixed in
// this change:
//
//   - Complete previously let ANY authenticated actor release escrow on any
//     IN_DELIVERY/READY_FOR_PICKUP order with a non-empty 6-digit OTP. The
//     order-party gate (patient or verified pharmacy owner) now runs before
//     the state/proof checks and long before escrow.Release, and denies with
//     the uniform ErrOrderNotFound (foreign ≡ missing — no oracle).
//   - Confirm previously let any user confirm a foreign non-Rx order. It is
//     now gated to the fulfilling pharmacy's owner (the patient cannot
//     self-confirm — for an Rx-pending order that would bypass HL-3 review).
//   - CreateOrder's idempotency replay was unscoped: replaying another
//     patient's key returned THEIR order (escrow id, totals). The lookup is
//     now owner-scoped and a foreign key is refused BEFORE escrow.Hold —
//     which also closes a victim-hold-unwind where escrow.Hold's bare-key
//     dedup would hand failAfterHold the other payer's hold to refund.
//
// Skips unless TEST_DATABASE_URL is set (same gate as the other *_live_db tests).

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func authzPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping pharmacy authz live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// authzEscrow records money-rail calls so the tests can prove a denied actor
// never reaches escrow (and a legitimate one does).
type authzEscrow struct {
	holds    []string // "payer|idemKey"
	released []string // "escrowID|payee"
	refunded []string
}

type authzHoldRef struct{ id string }

func (h authzHoldRef) HoldID() string { return h.id }

func (e *authzEscrow) Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (HoldRef, error) {
	e.holds = append(e.holds, payerID+"|"+idemKey)
	return authzHoldRef{id: uuid.New().String()}, nil
}

func (e *authzEscrow) Release(ctx context.Context, escrowID, payeeID string) error {
	e.released = append(e.released, escrowID+"|"+payeeID)
	return nil
}

func (e *authzEscrow) Refund(ctx context.Context, escrowID string) error {
	e.refunded = append(e.refunded, escrowID)
	return nil
}

// RefundIf mirrors the real contract loosely — the fake has no hold row to
// lock or guard against, so it just records the refund.
func (e *authzEscrow) RefundIf(ctx context.Context, escrowID string, guard func(context.Context, pgx.Tx) error) error {
	return e.Refund(ctx, escrowID)
}

// seedAuthzFixture creates a patient, a pharmacy provider owned by ownerID,
// and a foreign bystander user. Returns the ids; cleanup is registered.
func seedAuthzFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (patientID, ownerID, foreignID, pharmacyID string) {
	t.Helper()
	patientID, ownerID, foreignID, pharmacyID = uuid.New().String(), uuid.New().String(), uuid.New().String(), uuid.New().String()
	for _, u := range []string{patientID, ownerID, foreignID} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user %s: %v", u, err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		 VALUES ($1,$2,'PHARMACY','pharmacy','Authz Test Pharmacy','APPROVED')`, pharmacyID, ownerID); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM pharmacy_delivery_proofs WHERE order_id IN (SELECT id FROM pharmacy_orders WHERE pharmacy_provider_id=$1)`, pharmacyID)
		_, _ = pool.Exec(bg, `DELETE FROM pharmacy_orders WHERE pharmacy_provider_id=$1`, pharmacyID)
		_, _ = pool.Exec(bg, `DELETE FROM health_providers WHERE id=$1`, pharmacyID)
	})
	return patientID, ownerID, foreignID, pharmacyID
}

func seedOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, patientID, pharmacyID, state, method string, extra map[string]any) string {
	t.Helper()
	orderID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO pharmacy_orders (id, patient_id, pharmacy_provider_id, state, fulfilment_method, total_kobo, idempotency_key, created_at)
		 VALUES ($1,$2,$3,$4,$5,50000,$6,now())`,
		orderID, patientID, pharmacyID, state, method, "authz-"+orderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	if v, ok := extra["pickup_code"]; ok {
		if _, err := pool.Exec(ctx, `UPDATE pharmacy_orders SET pickup_code=$2 WHERE id=$1`, orderID, v); err != nil {
			t.Fatalf("set pickup_code: %v", err)
		}
	}
	if v, ok := extra["delivery_ref"]; ok {
		if _, err := pool.Exec(ctx, `UPDATE pharmacy_orders SET delivery_ref=$2 WHERE id=$1`, orderID, v); err != nil {
			t.Fatalf("set delivery_ref: %v", err)
		}
	}
	if v, ok := extra["escrow_id"]; ok {
		if _, err := pool.Exec(ctx, `UPDATE pharmacy_orders SET escrow_id=$2 WHERE id=$1`, orderID, v); err != nil {
			t.Fatalf("set escrow_id: %v", err)
		}
	}
	return orderID
}

func orderState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID string) string {
	t.Helper()
	var state string
	if err := pool.QueryRow(ctx, `SELECT state FROM pharmacy_orders WHERE id=$1`, orderID).Scan(&state); err != nil {
		t.Fatalf("read order state: %v", err)
	}
	return state
}

// A foreign actor must not be able to complete another user's order and
// release its escrow — denied with the uniform not-found sentinel, no state
// change, no proof row, no escrow release. The legitimate owner/patient
// completion still works end to end.
func TestLiveDB_Complete_ActorGate(t *testing.T) {
	pool := authzPool(t)
	ctx := context.Background()
	patientID, ownerID, foreignID, pharmacyID := seedAuthzFixture(t, ctx, pool)

	esc := &authzEscrow{}
	svc := NewService(pool, esc, nil, nil, nil, nil, nil, nil)

	escrowID := uuid.New().String()
	orderID := seedOrder(t, ctx, pool, patientID, pharmacyID, "IN_DELIVERY", "DELIVERY",
		map[string]any{"delivery_ref": "ref-1", "escrow_id": escrowID, "pickup_code": "123456"})

	// Foreign actor: uniform denial, nothing else happens.
	if _, err := svc.Complete(ctx, foreignID, orderID, "123456"); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("foreign Complete must fail ErrOrderNotFound, got %v", err)
	}
	if got := orderState(t, ctx, pool, orderID); got != "IN_DELIVERY" {
		t.Fatalf("state = %s after refused Complete, want IN_DELIVERY", got)
	}
	if len(esc.released) != 0 {
		t.Fatalf("foreign Complete released escrow: %v", esc.released)
	}
	var proofs int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM pharmacy_delivery_proofs WHERE order_id=$1`, orderID).Scan(&proofs); err != nil {
		t.Fatalf("count proofs: %v", err)
	}
	if proofs != 0 {
		t.Fatalf("refused Complete must not record a proof, got %d", proofs)
	}

	// Even an order party cannot complete delivery with a wrong confirmation
	// code — the OTP is checked against the code minted at dispatch.
	if _, err := svc.Complete(ctx, ownerID, orderID, "000000"); err == nil {
		t.Fatal("Complete with a wrong delivery code must be refused")
	}
	if got := orderState(t, ctx, pool, orderID); got != "IN_DELIVERY" {
		t.Fatalf("state = %s after wrong-code Complete, want IN_DELIVERY", got)
	}
	if len(esc.released) != 0 {
		t.Fatalf("wrong-code Complete released escrow: %v", esc.released)
	}

	// The pharmacy owner completes delivery on the courier's confirmation —
	// escrow releases to the owner.
	out, err := svc.Complete(ctx, ownerID, orderID, "123456")
	if err != nil {
		t.Fatalf("owner Complete with valid OTP must succeed: %v", err)
	}
	if out.State != StateClosed {
		t.Fatalf("state = %s, want CLOSED after completion", out.State)
	}
	if len(esc.released) != 1 || esc.released[0] != escrowID+"|"+ownerID {
		t.Fatalf("escrow release = %v, want [%s|%s]", esc.released, escrowID, ownerID)
	}
}

// The patient completes their own PICKUP order with the counter code; the
// pickup code alone does NOT authorize a foreign actor.
func TestLiveDB_Complete_PickupPatientOnly(t *testing.T) {
	pool := authzPool(t)
	ctx := context.Background()
	patientID, _, foreignID, pharmacyID := seedAuthzFixture(t, ctx, pool)

	esc := &authzEscrow{}
	svc := NewService(pool, esc, nil, nil, nil, nil, nil, nil)

	orderID := seedOrder(t, ctx, pool, patientID, pharmacyID, "READY_FOR_PICKUP", "PICKUP",
		map[string]any{"pickup_code": "654321", "escrow_id": uuid.New().String()})

	// A foreign actor holding the real pickup code is still not an order party.
	if _, err := svc.Complete(ctx, foreignID, orderID, "654321"); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("foreign Complete with correct code must fail ErrOrderNotFound, got %v", err)
	}
	if len(esc.released) != 0 {
		t.Fatalf("foreign Complete released escrow: %v", esc.released)
	}

	out, err := svc.Complete(ctx, patientID, orderID, "654321")
	if err != nil {
		t.Fatalf("patient Complete with the pickup code must succeed: %v", err)
	}
	if out.State != StateClosed {
		t.Fatalf("state = %s, want CLOSED", out.State)
	}
	if len(esc.released) != 1 {
		t.Fatalf("escrow release = %v, want exactly one release", esc.released)
	}
}

// Confirm is the pharmacy's acceptance — foreign users AND the patient are
// refused with the uniform sentinel; only the owner confirms.
func TestLiveDB_Confirm_OwnerOnly(t *testing.T) {
	pool := authzPool(t)
	ctx := context.Background()
	patientID, ownerID, foreignID, pharmacyID := seedAuthzFixture(t, ctx, pool)

	svc := NewService(pool, &authzEscrow{}, nil, nil, nil, nil, nil, nil)
	orderID := seedOrder(t, ctx, pool, patientID, pharmacyID, "CREATED", "PICKUP", nil)

	if _, err := svc.Confirm(ctx, foreignID, orderID); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("foreign Confirm must fail ErrOrderNotFound, got %v", err)
	}
	if _, err := svc.Confirm(ctx, patientID, orderID); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("patient self-Confirm must fail ErrOrderNotFound, got %v", err)
	}
	if got := orderState(t, ctx, pool, orderID); got != "CREATED" {
		t.Fatalf("state = %s after refused Confirms, want CREATED", got)
	}

	out, err := svc.Confirm(ctx, ownerID, orderID)
	if err != nil {
		t.Fatalf("owner Confirm must succeed: %v", err)
	}
	if out.State != StateConfirmed {
		t.Fatalf("state = %s, want CONFIRMED", out.State)
	}
}

// Idempotency replay is owner-scoped: the same patient gets their original
// order back; a different patient replaying the key is refused BEFORE the
// money leg — no hold attempted, no order row written, and nothing returned.
func TestLiveDB_CreateOrder_IdemReplayOwnerScoped(t *testing.T) {
	pool := authzPool(t)
	ctx := context.Background()
	patientID, _, foreignID, pharmacyID := seedAuthzFixture(t, ctx, pool)

	esc := &authzEscrow{}
	svc := NewService(pool, esc, nil, nil, nil, nil, nil, nil)

	victimOrderID := seedOrder(t, ctx, pool, patientID, pharmacyID, "CREATED", "PICKUP", nil)
	var victimKey string
	if err := pool.QueryRow(ctx, `SELECT idempotency_key FROM pharmacy_orders WHERE id=$1`, victimOrderID).Scan(&victimKey); err != nil {
		t.Fatalf("read victim idem key: %v", err)
	}

	in := CreateOrderInput{
		PharmacyProviderID: pharmacyID,
		FulfilmentMethod:   FulfilPickup,
		IdempotencyKey:     victimKey,
		Lines:              []OrderLineInput{{ProductID: uuid.New().String(), Quantity: 1}},
	}

	// Owner replay returns the original order — no new hold, no new row.
	got, err := svc.CreateOrder(ctx, patientID, in)
	if err != nil {
		t.Fatalf("owner replay must return the original order: %v", err)
	}
	if got.ID != victimOrderID {
		t.Fatalf("owner replay returned order %s, want original %s", got.ID, victimOrderID)
	}
	if len(esc.holds) != 0 {
		t.Fatalf("owner replay must not re-hold: %v", esc.holds)
	}

	// Foreign replay is refused — and must never reach escrow.Hold (the rail
	// dedups on the bare key and would attach/refund the victim's hold).
	if _, err := svc.CreateOrder(ctx, foreignID, in); !errors.Is(err, ErrIdemConflict) {
		t.Fatalf("foreign replay must fail ErrIdemConflict, got %v", err)
	}
	if len(esc.holds) != 0 {
		t.Fatalf("foreign replay must not reach the money leg: holds=%v", esc.holds)
	}
	if len(esc.refunded) != 0 {
		t.Fatalf("foreign replay must not refund the victim's hold: refunded=%v", esc.refunded)
	}
	var foreignOrders int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM pharmacy_orders WHERE patient_id=$1`, foreignID).Scan(&foreignOrders); err != nil {
		t.Fatalf("count foreign orders: %v", err)
	}
	if foreignOrders != 0 {
		t.Fatalf("foreign replay wrote %d order rows, want 0", foreignOrders)
	}
}
