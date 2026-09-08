package healthpharmacy_test

// LIVE-DB tests for the pharmacy owner's earnings.
//
// A pharmacy is paid by escrow RELEASE on completion — Service.Complete calls
// escrow.Release, which credits the owner the FULL held amount (commission is
// recorded separately in the profit registry, not deducted from that credit).
// So the money is real and already in their wallet, but there was no
// business-level view of it: a pharmacist saw undifferentiated wallet credits
// with no attribution to orders, and no idea how much was still held.
//
// The numbers come from escrow_holds — the money table — rather than being
// inferred from order workflow states. An order can reach a "finished-looking"
// state by a path that never released funds (cancelled, refunded), and money
// shown to a merchant must not be a guess about a lifecycle.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// seedEarnings adds an order with an escrow hold in the given state.
func seedEarnings(t *testing.T, ctx context.Context, f inboxFixture, pharmacyID, orderState, escrowState string, kobo int64) string {
	t.Helper()
	orderID := uuid.New().String()
	escrowID := uuid.New().String()
	if _, err := f.pool.Exec(ctx,
		`INSERT INTO escrow_holds (id, reference, module_type, payer_id, amount_kobo, state, idempotency_key)
		 VALUES ($1,$2,'health_pharmacy',$3,$4,$5,$6)`,
		escrowID, "pharmacy:"+orderID, f.patient, kobo, escrowState, "idem-"+escrowID); err != nil {
		t.Fatalf("seed escrow: %v", err)
	}
	if _, err := f.pool.Exec(ctx,
		`INSERT INTO pharmacy_orders (id, patient_id, pharmacy_provider_id, state, fulfilment_method,
		     total_kobo, escrow_id, idempotency_key)
		 VALUES ($1,$2,$3,$4,'PICKUP',$5,$6,$7)`,
		orderID, f.patient, pharmacyID, orderState, kobo, escrowID, "idem-"+orderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		f.pool.Exec(bg, `DELETE FROM pharmacy_orders WHERE id=$1`, orderID)
		f.pool.Exec(bg, `DELETE FROM escrow_holds WHERE id=$1`, escrowID)
	})
	return orderID
}

func TestLiveDB_EarningsSeparatesReleasedFromHeld(t *testing.T) {
	pool := ownerOrdersPool(t)
	// t.Cleanup runs AFTER the test function returns, so `defer pool.Close()`
	// would shut the pool BEFORE newInboxFixture's row cleanups fire — and those
	// Execs ignore their errors, so the fixtures survive silently as APPROVED
	// pharmacies that DiscoverPharmacies serves to customers.
	// Registered first, so LIFO makes it run last.
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	seedEarnings(t, ctx, f, f.pharmacy, "CLOSED", "RELEASED", 300_000)
	seedEarnings(t, ctx, f, f.pharmacy, "COLLECTED", "RELEASED", 200_000)
	seedEarnings(t, ctx, f, f.pharmacy, "CONFIRMED", "HELD", 150_000)

	e, err := f.svc.EarningsForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("EarningsForOwner: %v", err)
	}

	// Paid: the full held amount reaches the pharmacy on release.
	if e.ReleasedKobo != 500_000 {
		t.Errorf("released = %d, want 500000", e.ReleasedKobo)
	}
	// Still in escrow — the pharmacist's lever on it is completing the order.
	if e.HeldKobo != 150_000 {
		t.Errorf("held = %d, want 150000", e.HeldKobo)
	}
	if e.OrdersPaid != 2 {
		t.Errorf("orders paid = %d, want 2", e.OrdersPaid)
	}
}

func TestLiveDB_EarningsExcludesRefundedMoney(t *testing.T) {
	pool := ownerOrdersPool(t)
	// t.Cleanup runs AFTER the test function returns, so `defer pool.Close()`
	// would shut the pool BEFORE newInboxFixture's row cleanups fire — and those
	// Execs ignore their errors, so the fixtures survive silently as APPROVED
	// pharmacies that DiscoverPharmacies serves to customers.
	// Registered first, so LIFO makes it run last.
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	seedEarnings(t, ctx, f, f.pharmacy, "CLOSED", "RELEASED", 300_000)
	// A refunded order went back to the patient. Counting it as earnings would
	// show a pharmacist money they do not have.
	seedEarnings(t, ctx, f, f.pharmacy, "REFUNDED", "REFUNDED", 900_000)

	e, err := f.svc.EarningsForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("EarningsForOwner: %v", err)
	}
	if e.ReleasedKobo != 300_000 {
		t.Errorf("released = %d, want 300000 — a refund is not earnings", e.ReleasedKobo)
	}
	if e.HeldKobo != 0 {
		t.Errorf("held = %d, want 0 — a refunded hold is not still held", e.HeldKobo)
	}
}

func TestLiveDB_EarningsAreScopedToTheOwner(t *testing.T) {
	pool := ownerOrdersPool(t)
	// t.Cleanup runs AFTER the test function returns, so `defer pool.Close()`
	// would shut the pool BEFORE newInboxFixture's row cleanups fire — and those
	// Execs ignore their errors, so the fixtures survive silently as APPROVED
	// pharmacies that DiscoverPharmacies serves to customers.
	// Registered first, so LIFO makes it run last.
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	seedEarnings(t, ctx, f, f.pharmacy, "CLOSED", "RELEASED", 300_000)
	// A rival pharmacy's takings must never appear in this owner's figures.
	seedEarnings(t, ctx, f, f.rival, "CLOSED", "RELEASED", 800_000)

	e, err := f.svc.EarningsForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("EarningsForOwner: %v", err)
	}
	if e.ReleasedKobo != 300_000 {
		t.Errorf("released = %d, want 300000 — another pharmacy's earnings leaked", e.ReleasedKobo)
	}

	// And someone who owns no pharmacy earns nothing, rather than everything.
	none, err := f.svc.EarningsForOwner(ctx, f.patient)
	if err != nil {
		t.Fatalf("EarningsForOwner(non-owner): %v", err)
	}
	if none.ReleasedKobo != 0 || none.HeldKobo != 0 {
		t.Errorf("non-owner saw released=%d held=%d, want 0/0", none.ReleasedKobo, none.HeldKobo)
	}
}

func TestLiveDB_EarningsAreZeroNotNullForANewPharmacy(t *testing.T) {
	pool := ownerOrdersPool(t)
	// t.Cleanup runs AFTER the test function returns, so `defer pool.Close()`
	// would shut the pool BEFORE newInboxFixture's row cleanups fire — and those
	// Execs ignore their errors, so the fixtures survive silently as APPROVED
	// pharmacies that DiscoverPharmacies serves to customers.
	// Registered first, so LIFO makes it run last.
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	// The fixture's own order has no escrow, so this owner has taken nothing yet.
	e, err := f.svc.EarningsForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("EarningsForOwner: %v", err)
	}
	if e.ReleasedKobo != 0 || e.HeldKobo != 0 || e.OrdersPaid != 0 {
		t.Errorf("new pharmacy shows released=%d held=%d paid=%d, want zeros",
			e.ReleasedKobo, e.HeldKobo, e.OrdersPaid)
	}
}
