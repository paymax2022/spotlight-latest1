package transport

// ---------------------------------------------------------------------------
// LIVE-DB regression coverage for a defect found live during Ride/Transport
// (Module 18) UAT: an offer-mode ride request inside the app's own
// [floor,ceiling] range (validateFareInRange) could still violate the DB's
// separate, absolute trips_fare_kobo_check constraint (fare_kobo >= 150000),
// which the app-level check has no knowledge of. RequestRide escrowed the
// rider's wallet BEFORE inserting the trip row, so a request that passed the
// app check but failed the DB constraint left a real 'escrowed' settlements
// row with no owning trip at all — no FSM state, no cancel path (cancel
// needs a trip id), and outside the reconciler's reach (it only re-drives
// completed trips).
//
// Repro (the seeded 'default'/'ride_hailing' pricing config, unchanged):
// base_fare_kobo=50000, min_fare_kobo=150000, fare_floor_pct=0.85. A
// zero-distance route (identical pickup/dest) clamps SystemFare to
// min_fare_kobo (150000) exactly; offerBounds' floor is
// round(150000*0.85)=127500 — in app range, but 127500 < 150000 fails the DB
// constraint outright.
//
// Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

func orphanEscrowPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping transport orphan-escrow live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// TestLiveDB_RequestRide_BelowDBFareFloorRefundsInsteadOfOrphaning locks the
// fix: an offer that passes the app's own range check but fails the DB's
// separate absolute floor must leave NO settlement row in 'escrowed' state —
// the rider's money must come back, not get stranded with no owning trip.
func TestLiveDB_RequestRide_BelowDBFareFloorRefundsInsteadOfOrphaning(t *testing.T) {
	pool := orphanEscrowPool(t)
	ctx := context.Background()

	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	svc := NewService(pool, settlementSvc).WithLedger(ledgerSvc)

	rider := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, rider, rider+"@orphanescrow.test"); err != nil {
		t.Fatalf("seed rider: %v", err)
	}
	testsupport.CleanupUser(t, pool, rider)

	revAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("resolve revenue account: %v", err)
	}
	if err := ledgerSvc.Credit(ctx, rider, "seed:orphanescrow-fixtures", "seed-fund-"+rider, revAcc.ID, 5_000_000); err != nil {
		t.Fatalf("fund rider: %v", err)
	}
	// Bump KYC tier so the checkout debit-limit gate passes for a real escrow
	// attempt — a tier-0 rider is refused before ever reaching escrow, which
	// would mask the actual defect under test (mirrors cash_ride_live_db_test.go).
	if _, err := pool.Exec(ctx, `UPDATE user_profiles SET kyc_tier=2 WHERE id=$1`, rider); err != nil {
		t.Fatalf("bump rider kyc tier: %v", err)
	}
	var balanceBefore int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN le.type='CREDIT' THEN le.amount_kobo ELSE -le.amount_kobo END), 0)
		FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.account_id
		WHERE la.user_id = $1`, rider).Scan(&balanceBefore); err != nil {
		t.Fatalf("read balance before: %v", err)
	}

	// Identical pickup/dest -> zero-distance route -> SystemFare clamps to
	// min_fare_kobo (150000). offerMin = round(150000*0.85) = 127500, which
	// is IN the app's own range but BELOW the DB's absolute floor.
	pickup := Place{Lat: 6.50, Lng: 3.40, Address: "Same Point"}
	req := RequestRideRequest{
		Pickup:        pickup,
		Dest:          pickup,
		ServiceType:   "ride_hailing",
		PricingMode:   "offer",
		OfferKobo:     127500,
		PaymentMethod: "wallet",
	}
	idem := "orphan-escrow-uat-" + uuid.New().String()
	_, err = svc.RequestRide(ctx, rider, req, idem)
	if err == nil {
		t.Fatal("RequestRide with an offer below the DB's absolute fare floor must fail (the trip row can never be durably created), got nil error")
	}

	// The critical assertion: no settlement row must be left in 'escrowed'
	// state for this request — either none was created, or it was refunded.
	var escrowedCount int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM settlements WHERE idempotency_key LIKE $1 AND status='escrowed'`, idem+"%").
		Scan(&escrowedCount); err != nil {
		t.Fatalf("count escrowed settlements: %v", err)
	}
	if escrowedCount != 0 {
		t.Fatalf("found %d orphaned 'escrowed' settlement row(s) for a failed request — the original defect", escrowedCount)
	}

	// No trip row should exist either.
	var tripCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM trips WHERE idempotency_key=$1`, idem).Scan(&tripCount); err != nil {
		t.Fatalf("count trips: %v", err)
	}
	if tripCount != 0 {
		t.Fatalf("found %d trip row(s) for a request that should have failed entirely", tripCount)
	}

	// The rider's wallet balance must be back to where it started — refunded,
	// not stranded.
	var balanceAfter int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN le.type='CREDIT' THEN le.amount_kobo ELSE -le.amount_kobo END), 0)
		FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.account_id
		WHERE la.user_id = $1`, rider).Scan(&balanceAfter); err != nil {
		t.Fatalf("read balance after: %v", err)
	}
	if balanceAfter != balanceBefore {
		t.Fatalf("rider balance = %d after the failed request, want unchanged %d (money must be refunded, not stranded)", balanceAfter, balanceBefore)
	}
}
