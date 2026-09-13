package transport

// ---------------------------------------------------------------------------
// LIVE-DB integration test for the cash-ride payment workflow: no escrow on
// request, a driver-wallet balance gate on the open-requests feed + accept,
// and a driver-wallet platform-fee debit at trip completion (no escrow to
// split for a fare the rider paid the driver directly). Skipped unless
// TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"math"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

func cashRidePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB cash-ride test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func seedCashTestRider(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@cashride.test"); err != nil {
		t.Fatalf("seed rider auth user: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

func seedCashTestDriver(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, userID+"@cashride.test"); err != nil {
		t.Fatalf("seed driver auth user: %v", err)
	}
	testsupport.CleanupUser(t, pool, userID)
	if _, err := pool.Exec(ctx, `
		INSERT INTO drivers (user_id, name, vehicle_reg, status, verification_status, current_lat, current_lng)
		VALUES ($1,'Cash Test Driver',$2,'online','approved',6.5,3.4)`,
		userID, "CASH-"+userID[:8]); err != nil {
		t.Fatalf("seed driver: %v", err)
	}
	return userID
}

// TestLiveDB_CashRideNoEscrowAndBalanceGate proves the full cash-ride redesign
// against real Postgres: requesting a cash ride never touches the rider's
// wallet; a driver whose wallet can't cover the platform fee never sees the
// request and is rejected on accept; a driver who can afford it sees it,
// accepts it, and completing the trip debits their wallet by the exact
// platform commission (crediting the standing paymax_revenue account) with no
// rider-side money movement at all.
func TestLiveDB_CashRideNoEscrowAndBalanceGate(t *testing.T) {
	pool := cashRidePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	svc := NewService(pool, settlementSvc).WithLedger(ledgerSvc)

	rider := seedCashTestRider(t, ctx, pool)
	poorDriver := seedCashTestDriver(t, ctx, pool)
	richDriver := seedCashTestDriver(t, ctx, pool)

	// Fund richDriver generously so they can always cover the platform fee;
	// leave poorDriver's wallet at zero.
	revAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("resolve revenue account: %v", err)
	}
	if err := ledgerSvc.Credit(ctx, richDriver, "seed:cashride-fixtures", "seed-fund-"+richDriver, revAcc.ID, 10_000_000); err != nil {
		t.Fatalf("fund rich driver: %v", err)
	}

	// ── Step 1: requesting a cash ride escrows NOTHING. ──────────────────────
	req := RequestRideRequest{
		Pickup:        Place{Lat: 6.50, Lng: 3.40, Address: "Pickup"},
		Dest:          Place{Lat: 6.55, Lng: 3.45, Address: "Dest"},
		ServiceType:   "ride_hailing",
		PricingMode:   "instant",
		PaymentMethod: "cash",
	}
	detail, err := svc.RequestRide(ctx, rider, req, "cash-req-"+uuid.New().String())
	if err != nil {
		t.Fatalf("RequestRide (cash): %v", err)
	}
	tripID, _ := detail.Trip["id"].(string)
	if tripID == "" {
		t.Fatal("RequestRide returned no trip id")
	}

	var settlementCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM settlements WHERE reference LIKE $1`, "trip:"+tripID+"%").Scan(&settlementCount); err != nil {
		t.Fatalf("count settlements: %v", err)
	}
	if settlementCount != 0 {
		t.Errorf("expected 0 settlement/escrow rows for a cash trip, got %d", settlementCount)
	}
	var tripSettlementID *string
	if err := pool.QueryRow(ctx, `SELECT settlement_id::text FROM trips WHERE id=$1`, tripID).Scan(&tripSettlementID); err != nil {
		t.Fatalf("read trip settlement_id: %v", err)
	}
	if tripSettlementID != nil {
		t.Errorf("expected trips.settlement_id NULL for a cash trip, got %v", *tripSettlementID)
	}

	var fareKobo int64
	if err := pool.QueryRow(ctx, `SELECT fare_kobo FROM trips WHERE id=$1`, tripID).Scan(&fareKobo); err != nil {
		t.Fatalf("read fare_kobo: %v", err)
	}
	if fareKobo <= 0 {
		t.Fatalf("expected a positive fare_kobo, got %d", fareKobo)
	}

	// ── Step 2: the poor driver never sees it, and accept is rejected. ──────
	openForPoor, err := svc.OpenRequests(ctx, poorDriver)
	if err != nil {
		t.Fatalf("OpenRequests (poor): %v", err)
	}
	for _, r := range openForPoor {
		if r["id"] == tripID {
			t.Fatal("poor driver should not see a cash request they can't afford the platform fee on")
		}
	}
	if _, err := svc.DriverAccept(ctx, tripID, poorDriver); err == nil {
		t.Fatal("expected DriverAccept to reject the poor driver")
	} else if ce, ok := err.(*CodedError); !ok || ce.Code != CodeInsufficientDriverBalance {
		t.Errorf("expected CodeInsufficientDriverBalance, got %v", err)
	}

	// ── Step 3: the rich driver sees it and can accept. ──────────────────────
	openForRich, err := svc.OpenRequests(ctx, richDriver)
	if err != nil {
		t.Fatalf("OpenRequests (rich): %v", err)
	}
	found := false
	for _, r := range openForRich {
		if r["id"] == tripID {
			found = true
		}
	}
	if !found {
		t.Fatal("rich driver should see the cash request they can afford")
	}
	if _, err := svc.DriverAccept(ctx, tripID, richDriver); err != nil {
		t.Fatalf("DriverAccept (rich): %v", err)
	}

	// ── Step 4: drive the trip to completion via the real state machine. ────
	if err := svc.DriverArrive(ctx, tripID, richDriver); err != nil {
		t.Fatalf("DriverArrive: %v", err)
	}
	var pin string
	if err := pool.QueryRow(ctx, `SELECT trip_pin FROM trips WHERE id=$1`, tripID).Scan(&pin); err != nil {
		t.Fatalf("read trip pin: %v", err)
	}
	if err := svc.VerifyPin(ctx, tripID, richDriver, pin); err != nil {
		t.Fatalf("VerifyPin: %v", err)
	}
	if err := svc.StartTrip(ctx, tripID, richDriver); err != nil {
		t.Fatalf("StartTrip: %v", err)
	}

	balanceBefore, err := ledgerSvc.GetBalance(ctx, richDriver)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}
	revenueBefore, err := ledgerSvc.GetAccountBalance(ctx, revAcc.ID)
	if err != nil {
		t.Fatalf("revenue before: %v", err)
	}

	if err := svc.CompleteTrip(ctx, tripID, richDriver); err != nil {
		t.Fatalf("CompleteTrip: %v", err)
	}

	// Standard commission split is 80/20 for the 'standard' tier — the fee the
	// driver's wallet should have been debited. Rounded the same way
	// platformFeeKobo computes it (math.Round), not truncated.
	wantFee := int64(math.Round(float64(fareKobo) * 0.20))
	if wantFee <= 0 {
		t.Fatal("test setup produced a zero expected fee — fareKobo too small")
	}

	balanceAfter, err := ledgerSvc.GetBalance(ctx, richDriver)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	revenueAfter, err := ledgerSvc.GetAccountBalance(ctx, revAcc.ID)
	if err != nil {
		t.Fatalf("revenue after: %v", err)
	}

	if got := balanceBefore - balanceAfter; got != wantFee {
		t.Errorf("driver wallet debited %d kobo, want %d kobo (20%% of fare %d)", got, wantFee, fareKobo)
	}
	if got := revenueAfter - revenueBefore; got != wantFee {
		t.Errorf("platform revenue credited %d kobo, want %d kobo", got, wantFee)
	}

	// The rider's wallet was never touched at any point in a cash ride.
	riderBalance, err := ledgerSvc.GetBalance(ctx, rider)
	if err != nil {
		t.Fatalf("rider balance: %v", err)
	}
	if riderBalance != 0 {
		t.Errorf("expected rider wallet balance 0 (never funded, never touched), got %d", riderBalance)
	}
}

// TestLiveDB_WalletRideStillEscrows is a regression check: a normal wallet-mode
// ride must still escrow the fare exactly as before this change.
func TestLiveDB_WalletRideStillEscrows(t *testing.T) {
	pool := cashRidePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	svc := NewService(pool, settlementSvc).WithLedger(ledgerSvc)

	rider := seedCashTestRider(t, ctx, pool)
	// Fund the rider so the wallet debit + tier gate can succeed.
	revAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("resolve revenue account: %v", err)
	}
	if err := ledgerSvc.Credit(ctx, rider, "seed:cashride-fixtures", "seed-fund-rider-"+rider, revAcc.ID, 10_000_000); err != nil {
		t.Fatalf("fund rider: %v", err)
	}
	// Bump KYC tier so the checkout debit-limit gate passes for a real escrow.
	if _, err := pool.Exec(ctx, `UPDATE user_profiles SET kyc_tier=2 WHERE id=$1`, rider); err != nil {
		t.Fatalf("bump rider kyc tier: %v", err)
	}

	req := RequestRideRequest{
		Pickup:        Place{Lat: 6.50, Lng: 3.40, Address: "Pickup"},
		Dest:          Place{Lat: 6.55, Lng: 3.45, Address: "Dest"},
		ServiceType:   "ride_hailing",
		PricingMode:   "instant",
		PaymentMethod: "wallet",
	}
	detail, err := svc.RequestRide(ctx, rider, req, "wallet-req-"+uuid.New().String())
	if err != nil {
		t.Fatalf("RequestRide (wallet): %v", err)
	}
	tripID, _ := detail.Trip["id"].(string)
	if tripID == "" {
		t.Fatal("RequestRide returned no trip id")
	}

	var settlementCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM settlements WHERE reference LIKE $1 AND status='escrowed'`, "trip:"+tripID+"%").Scan(&settlementCount); err != nil {
		t.Fatalf("count settlements: %v", err)
	}
	if settlementCount != 1 {
		t.Errorf("expected exactly 1 escrowed settlement row for a wallet trip, got %d", settlementCount)
	}
	var tripSettlementID *string
	if err := pool.QueryRow(ctx, `SELECT settlement_id::text FROM trips WHERE id=$1`, tripID).Scan(&tripSettlementID); err != nil {
		t.Fatalf("read trip settlement_id: %v", err)
	}
	if tripSettlementID == nil {
		t.Error("expected trips.settlement_id to be set for a wallet trip")
	}
}
