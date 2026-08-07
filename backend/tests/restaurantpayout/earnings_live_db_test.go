package restaurantpayout_test

// ---------------------------------------------------------------------------
// LIVE-DB test for the merchant earnings read (slice 4): GetMerchantEarnings
// summarizes a restaurant owner's food-delivery earnings — pending (settled
// provider shares not yet paid out) vs paid-out (net of PAID runs). It must be
// owner-scoped and move a settlement's amount from `pending` to `paid` after a
// payout run is processed.
//
// Reuses the payout test's seed helpers. Skips unless TEST_DATABASE_URL/
// DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"spotlight/backend/internal/restaurant"
)

func TestLiveDB_MerchantEarnings(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveRestaurantService(pool, newLiveLedgerService(pool))

	owner := seedUser(t, ctx, pool)
	customer := seedUser(t, ctx, pool)
	stranger := seedUser(t, ctx, pool)
	restID := seedRestaurant(t, ctx, pool, owner)

	const total, fee, provider int64 = 500000, 50000, 400000
	orderID := seedDeliveredOrder(t, ctx, pool, restID, customer, total)
	seedSettledSettlement(t, ctx, pool, orderID, customer, total, fee, provider)

	// Before any payout: the provider share is PENDING, nothing paid out.
	e, err := svc.GetMerchantEarnings(ctx, owner)
	if err != nil {
		t.Fatalf("earnings (pending): %v", err)
	}
	if e.PendingKobo != provider {
		t.Fatalf("pending = %d, want %d (provider share)", e.PendingKobo, provider)
	}
	if e.PaidOutKobo != 0 {
		t.Fatalf("paid-out = %d, want 0 before any run", e.PaidOutKobo)
	}

	// A stranger sees none of the owner's earnings.
	se, err := svc.GetMerchantEarnings(ctx, stranger)
	if err != nil {
		t.Fatalf("earnings (stranger): %v", err)
	}
	if se.PendingKobo != 0 || se.PaidOutKobo != 0 || len(se.Runs) != 0 {
		t.Fatalf("stranger leaked earnings: %+v", se)
	}

	// Build + process a payout run: the amount moves pending → paid.
	run, err := svc.BuildRun(ctx, "2026-08-earnings", restaurant.PayoutProviderRestaurant, owner)
	if err != nil {
		t.Fatalf("BuildRun: %v", err)
	}
	if _, err := svc.ProcessRun(ctx, run.ID, "earnings-idem-"+run.ID); err != nil {
		t.Fatalf("ProcessRun: %v", err)
	}

	e2, err := svc.GetMerchantEarnings(ctx, owner)
	if err != nil {
		t.Fatalf("earnings (paid): %v", err)
	}
	if e2.PaidOutKobo != provider {
		t.Fatalf("paid-out = %d, want %d after run", e2.PaidOutKobo, provider)
	}
	if e2.PendingKobo != 0 {
		t.Fatalf("pending = %d, want 0 after the settlement was disbursed", e2.PendingKobo)
	}
	foundPaid := false
	for _, r := range e2.Runs {
		if r.ID == run.ID && r.Status == "paid" && r.NetKobo == provider {
			foundPaid = true
		}
	}
	if !foundPaid {
		t.Fatalf("paid run %s not reflected in earnings runs: %+v", run.ID, e2.Runs)
	}
}
