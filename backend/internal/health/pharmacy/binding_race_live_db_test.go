package healthpharmacy_test

// LIVE-DB regression for the ledger re-audit's residual (F1): the post-hold
// compensation path used to probe bound-ness with a pool-side EXISTS and then
// call a bare escrow.Refund — a TOCTOU, because escrow_id carries no FK and
// the binding insert took no lock on the hold row. The window: a concurrent
// create (the "winner") dedups onto the SAME hold, locks it FOR UPDATE inside
// its binding transaction and inserts the bound pharmacy_orders row while a
// failing attempt (the "loser") still sees the hold unbound. The loser's
// refund could then commit AFTER the winner's binding, reversing a live
// order's payment.
//
// The fix is two halves that serialize on the escrow_holds row lock:
//   - binding half  — CreateOrder's tx does SELECT ... FOR UPDATE on the hold
//     and requires HELD before inserting the bound row;
//   - resolution half — failAfterHold calls escrow.RefundIf, whose guard
//     re-checks payer + NOT EXISTS(bound order) inside the refund tx after the
//     same FOR UPDATE and the FSM check.
//
// This test drives the residual deterministically: a raw winner transaction
// locks the hold and inserts the bound order row UNCOMMITTED, the loser's
// CreateOrder (same idempotency key, same patient) adopts the deduped hold and
// blocks inside its own binding tx on the winner's lock, the winner commits,
// and the loser's insert then dies on an INJECTED NON-UNIQUE failure (an
// invalid search_event_id uuid — an insert error that is NOT the unique-key
// convergence). failAfterHold must leave the winner's hold HELD — before the
// fix, this exact shape refunded it.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/ledger"
	healthpharmacy "spotlight/backend/internal/health/pharmacy"

	goredis "github.com/redis/go-redis/v9"
)

func TestLiveDB_CreateOrder_LoserCompensationCannotRefundBoundHold(t *testing.T) {
	pool := stockDispatchPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	patientID, pharmacyID, productID := seedStockFixture(t, ctx, pool, 0)
	fundWallet(t, ctx, led, patientID, 5_000_000)

	realEscrow := escrow.NewService(pool, led, nil)
	svc := healthpharmacy.NewService(pool, newTestEscrowAdapter(pool, led), nil, nil, nil, testProviderGate{pharmacyID: pharmacyID}, nil, nil)

	key := "idem-bind-" + uuid.New().String()

	// The shared hold — escrow.Hold dedups on the bare idempotency key, so the
	// loser below adopts THIS hold rather than minting its own.
	hold, err := realEscrow.Hold(ctx, patientID, "pharmacy:bind-race", "health.pharmacy", key, 100000)
	if err != nil {
		t.Fatalf("place shared hold: %v", err)
	}

	// Winner's binding transaction — mirror what the winner's own CreateOrder
	// does: lock the hold FOR UPDATE, require HELD, insert the bound row; then
	// HOLD THE TX OPEN so the loser's probe window exists.
	wtx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin winner tx: %v", err)
	}
	defer func() { _ = wtx.Rollback(context.Background()) }()
	var holdState string
	if err := wtx.QueryRow(ctx, `SELECT state FROM escrow_holds WHERE id=$1 FOR UPDATE`, hold.ID).Scan(&holdState); err != nil {
		t.Fatalf("winner lock hold: %v", err)
	}
	if holdState != "HELD" {
		t.Fatalf("precondition: hold state = %s, want HELD", holdState)
	}
	winnerOrderID := uuid.New().String()
	if _, err := wtx.Exec(ctx, `
		INSERT INTO pharmacy_orders
			(id, patient_id, pharmacy_provider_id, state, fulfilment_method, total_kobo, escrow_id, idempotency_key)
		VALUES ($1,$2,$3,'CREATED','PICKUP',100000,$4,$5)`,
		winnerOrderID, patientID, pharmacyID, hold.ID, key); err != nil {
		t.Fatalf("winner bind order: %v", err)
	}

	// Loser: same patient + same idempotency key. getByIdem sees nothing
	// committed (winner uncommitted) → Hold dedups onto the shared hold → its
	// binding tx blocks on the winner's FOR UPDATE inside
	// lockEscrowForBinding. The marked SearchEventID makes the loser's own
	// insert fail NON-uniquely (invalid uuid input — an insert error distinct
	// from the unique-key convergence).
	errCh := make(chan error, 1)
	badUUID := "INJFAIL-not-a-uuid"
	go func() {
		_, err := svc.CreateOrder(ctx, patientID, healthpharmacy.CreateOrderInput{
			PharmacyProviderID: pharmacyID,
			FulfilmentMethod:   "PICKUP",
			IdempotencyKey:     key,
			SearchEventID:      &badUUID,
			Lines:              []healthpharmacy.OrderLineInput{{ProductID: productID, Quantity: 1}},
		})
		errCh <- err
	}()

	// Let the loser reach the blocked FOR UPDATE, then commit the winner —
	// the exact interleave the audit flagged: the loser's post-hold failure is
	// resolved while a bound order exists but the loser's earlier (pre-fix)
	// pool-side probe could have already passed.
	time.Sleep(400 * time.Millisecond)
	if err := wtx.Commit(ctx); err != nil {
		t.Fatalf("winner commit: %v", err)
	}

	select {
	case err := <-errCh:
		if !errors.Is(err, healthpharmacy.ErrIdemConflict) {
			t.Fatalf("loser must converge to ErrIdemConflict, got %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("loser CreateOrder did not return — possible deadlock between binding lock and RefundIf")
	}

	// THE assertion: the winner's hold is still HELD — the loser's guarded
	// refund saw the committed bound row and vetoed. A REFUNDED state here is
	// the old bug: committed order pointing at money already returned.
	var st string
	if err := pool.QueryRow(ctx, `SELECT state FROM escrow_holds WHERE id=$1`, hold.ID).Scan(&st); err != nil {
		t.Fatalf("read hold state: %v", err)
	}
	if st != "HELD" {
		t.Fatalf("winner's hold state = %s, want HELD — loser refunded a bound hold", st)
	}

	var orderCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM pharmacy_orders WHERE idempotency_key=$1`, key).Scan(&orderCount); err != nil {
		t.Fatalf("count orders: %v", err)
	}
	if orderCount != 1 {
		t.Fatalf("orders under key = %d, want exactly the winner's 1", orderCount)
	}
}

// TestLiveDB_CreateOrder_UnboundHoldStillRefunded is the other half of the
// invariant: a post-hold failure with NO committed winner must still refund —
// the guard must never strand the patient's money in escrow.
func TestLiveDB_CreateOrder_UnboundHoldStillRefunded(t *testing.T) {
	pool := stockDispatchPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	patientID, pharmacyID, productID := seedStockFixture(t, ctx, pool, 0)
	fundWallet(t, ctx, led, patientID, 5_000_000)

	svc := healthpharmacy.NewService(pool, newTestEscrowAdapter(pool, led), nil, nil, nil, testProviderGate{pharmacyID: pharmacyID}, nil, nil)

	key := "idem-unbound-" + uuid.New().String()
	badUUID := "INJFAIL-not-a-uuid"
	_, err := svc.CreateOrder(ctx, patientID, healthpharmacy.CreateOrderInput{
		PharmacyProviderID: pharmacyID,
		FulfilmentMethod:   "PICKUP",
		IdempotencyKey:     key,
		SearchEventID:      &badUUID,
		Lines:              []healthpharmacy.OrderLineInput{{ProductID: productID, Quantity: 1}},
	})
	if err == nil {
		t.Fatal("injected insert failure must surface an error")
	}
	if errors.Is(err, healthpharmacy.ErrIdemConflict) {
		t.Fatalf("no winner exists — ErrIdemConflict is wrong here: %v", err)
	}

	var st string
	if err := pool.QueryRow(ctx, `SELECT state FROM escrow_holds WHERE idempotency_key=$1`, key).Scan(&st); err != nil {
		t.Fatalf("read hold state: %v", err)
	}
	if st != "REFUNDED" {
		t.Fatalf("unbound hold state = %s, want REFUNDED — compensation stranded the patient's money", st)
	}
}
