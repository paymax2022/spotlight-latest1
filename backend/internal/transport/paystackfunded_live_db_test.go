package transport

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for RequestRidePaystackFunded / QuoteRide
// (backend/internal/transport/mobility_service.go), the externally-funded
// ride-hailing checkout path — the transport counterpart of
// restaurant/paystackfunded_live_db_test.go. Same fixtures shape as
// request_ride_orphan_escrow_live_db_test.go / cash_ride_live_db_test.go.
//
// What these pin:
//  1. A Tier-0 rider (fresh auth.users row, on_auth_user_created defaults
//     user_profiles.kyc_tier=0) is refused by the wallet-funded path but can
//     book via the Paystack-funded path — the tier gate never runs at all.
//  2. The rider's wallet balance is UNCHANGED by an externally-funded ride.
//  3. QuoteRide's number is exactly what RequestRidePaystackFunded accepts.
//  4. A caller that passes anything other than the exact recomputed fare is
//     refused BEFORE any escrow or trip row is written, above and below.
//  5. Offer-mode and cash payment are refused outright for the external rail.
//  6. Cancelling a Paystack-funded ride NEVER credits the rider's wallet
//     (settlement.Refund) — it goes through the injected ExternalRefunder.
//  7. adjustEscrow refuses to RAISE a Paystack-funded trip's held amount.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

func paystackRidePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB transport Paystack-checkout test")
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

// paystackRideFixture seeds a funded rider and returns the service, ledger,
// and rider id. Riders are freshly created (Tier 0 by default, via
// on_auth_user_created) unless the test bumps kyc_tier itself.
func paystackRideFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, fundKobo int64) (*Service, *ledger.Service, string) {
	t.Helper()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	svc := NewService(pool, settlementSvc).WithLedger(ledgerSvc)

	rider := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, rider, rider+"@pfride.test"); err != nil {
		t.Fatalf("seed rider: %v", err)
	}
	testsupport.CleanupUser(t, pool, rider)

	if fundKobo > 0 {
		revAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
		if err != nil {
			t.Fatalf("standing acct: %v", err)
		}
		if err := ledgerSvc.Credit(ctx, rider, "seed-fund", "pfride-fund-"+rider, revAcc.ID, fundKobo); err != nil {
			t.Fatalf("fund rider: %v", err)
		}
	}
	return svc, ledgerSvc, rider
}

// instantReq is a fixed, deterministic instant-mode ride request: identical
// pickup/dest -> zero-distance route -> SystemFare clamps to min_fare_kobo
// (150000), exactly as request_ride_orphan_escrow_live_db_test.go documents.
func instantReq(idemKey string) RequestRideRequest {
	pickup := Place{Lat: 6.50, Lng: 3.40, Address: "Same Point"}
	return RequestRideRequest{
		Pickup:         pickup,
		Dest:           pickup,
		ServiceType:    "ride_hailing",
		PricingMode:    "instant",
		PaymentMethod:  "wallet",
		IdempotencyKey: idemKey,
	}
}

func riderWalletBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool, rider string) int64 {
	t.Helper()
	var balance int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN le.type='CREDIT' THEN le.amount_kobo ELSE -le.amount_kobo END), 0)
		FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.account_id
		WHERE la.user_id = $1`, rider).Scan(&balance); err != nil {
		t.Fatalf("read balance: %v", err)
	}
	return balance
}

func TestLiveDB_RequestRidePaystackFunded_SkipsTierGate(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, rider := paystackRideFixture(t, ctx, pool, 10_000_000)
	// No kyc_tier bump — the rider is Tier 0 by default (on_auth_user_created).

	before := riderWalletBalance(t, ctx, pool, rider)

	req := instantReq("pfride-tier0-" + uuid.New().String())
	if _, err := svc.RequestRide(ctx, rider, req, req.IdempotencyKey); err == nil {
		t.Fatal("wallet-funded RequestRide must be refused for a Tier-0 rider (this feature must not relax it)")
	}

	quoted, err := svc.QuoteRide(ctx, req)
	if err != nil {
		t.Fatalf("QuoteRide: %v", err)
	}
	if quoted != 150_000 {
		t.Fatalf("quoted fare = %d, want the deterministic min fare 150000", quoted)
	}

	trip, err := svc.RequestRidePaystackFunded(ctx, rider, req, req.IdempotencyKey, quoted)
	if err != nil {
		t.Fatalf("RequestRidePaystackFunded must succeed for a Tier-0 rider, got: %v", err)
	}
	if fare, _ := trip.Trip["fareKobo"].(int64); fare != quoted {
		t.Errorf("booked fare = %v, want the quoted amount %d", trip.Trip["fareKobo"], quoted)
	}

	after := riderWalletBalance(t, ctx, pool, rider)
	if after != before {
		t.Errorf("rider wallet balance moved on an externally-funded ride: %d -> %d", before, after)
	}
}

func TestLiveDB_RequestRidePaystackFunded_AmountMismatchRejects(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, rider := paystackRideFixture(t, ctx, pool, 10_000_000)

	req := instantReq("pfride-mismatch-under-" + uuid.New().String())
	quoted, err := svc.QuoteRide(ctx, req)
	if err != nil {
		t.Fatalf("QuoteRide: %v", err)
	}

	before := riderWalletBalance(t, ctx, pool, rider)

	if _, err := svc.RequestRidePaystackFunded(ctx, rider, req, req.IdempotencyKey, quoted-1); err == nil {
		t.Fatal("underpaid amount must be refused")
	}
	var escrowed int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM settlements WHERE idempotency_key=$1`, req.IdempotencyKey).Scan(&escrowed); err != nil {
		t.Fatalf("count settlements: %v", err)
	}
	if escrowed != 0 {
		t.Fatalf("%d settlement row(s) written for a mismatched-amount request", escrowed)
	}

	req2 := instantReq("pfride-mismatch-over-" + uuid.New().String())
	if _, err := svc.RequestRidePaystackFunded(ctx, rider, req2, req2.IdempotencyKey, quoted+1); err == nil {
		t.Fatal("overpaid amount must be refused")
	}

	after := riderWalletBalance(t, ctx, pool, rider)
	if after != before {
		t.Errorf("rider wallet balance moved on rejected requests: %d -> %d", before, after)
	}
}

func TestLiveDB_RequestRidePaystackFunded_RejectsOfferMode(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, rider := paystackRideFixture(t, ctx, pool, 10_000_000)

	req := instantReq("pfride-offer-" + uuid.New().String())
	req.PricingMode = "offer"
	req.OfferKobo = 200_000
	if _, err := svc.RequestRidePaystackFunded(ctx, rider, req, req.IdempotencyKey, 200_000); err == nil {
		t.Fatal("offer-mode must be refused on the Paystack-funded rail")
	}
}

func TestLiveDB_RequestRidePaystackFunded_RejectsCashPayment(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, rider := paystackRideFixture(t, ctx, pool, 0)

	req := instantReq("pfride-cash-" + uuid.New().String())
	req.PaymentMethod = "cash"
	if _, err := svc.RequestRidePaystackFunded(ctx, rider, req, req.IdempotencyKey, 150_000); err == nil {
		t.Fatal("cash payment must be refused on the Paystack-funded rail")
	}
}

func TestLiveDB_QuoteRide_MatchesRequestRidePaystackFundedFare(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, rider := paystackRideFixture(t, ctx, pool, 10_000_000)

	req := instantReq("pfride-quotematch-" + uuid.New().String())
	quoted, err := svc.QuoteRide(ctx, req)
	if err != nil {
		t.Fatalf("QuoteRide: %v", err)
	}
	trip, err := svc.RequestRidePaystackFunded(ctx, rider, req, req.IdempotencyKey, quoted)
	if err != nil {
		t.Fatalf("RequestRidePaystackFunded: %v", err)
	}
	if fare, _ := trip.Trip["fareKobo"].(int64); fare != quoted {
		t.Errorf("booked fare = %v, quoted = %d — QuoteRide and RequestRidePaystackFunded drifted", trip.Trip["fareKobo"], quoted)
	}
}

// fakeExternalRefunder records calls instead of touching Paystack/ledger, so
// these tests can assert exactly what transport asks an ExternalRefunder to
// do, without a real gateway.
type fakeExternalRefunder struct {
	calls []struct{ tripID, settlementID, reason string }
}

func (f *fakeExternalRefunder) RefundExternalSettlement(_ context.Context, tripID, settlementID, reason string) error {
	f.calls = append(f.calls, struct{ tripID, settlementID, reason string }{tripID, settlementID, reason})
	return nil
}

// TestLiveDB_CancelRide_PaystackFundedUsesExternalRefunder is the most
// important test in this file: cancelling a Paystack-funded ride is a NORMAL,
// frequent action (unlike a rare crash window), so getting this wrong means
// EVERY cancellation of an externally-funded ride would wrongly wallet-credit
// the rider — exactly the hazard this whole feature exists to avoid.
func TestLiveDB_CancelRide_PaystackFundedUsesExternalRefunder(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, rider := paystackRideFixture(t, ctx, pool, 10_000_000)
	fake := &fakeExternalRefunder{}
	svc.SetExternalRefunder(fake)

	req := instantReq("pfride-cancel-" + uuid.New().String())
	quoted, err := svc.QuoteRide(ctx, req)
	if err != nil {
		t.Fatalf("QuoteRide: %v", err)
	}
	trip, err := svc.RequestRidePaystackFunded(ctx, rider, req, req.IdempotencyKey, quoted)
	if err != nil {
		t.Fatalf("RequestRidePaystackFunded: %v", err)
	}
	tripID, _ := trip.Trip["id"].(string)
	if tripID == "" {
		t.Fatal("booked trip has no id")
	}

	before := riderWalletBalance(t, ctx, pool, rider)

	if err := svc.CancelRide(ctx, tripID, rider, "customer_changed_mind"); err != nil {
		t.Fatalf("CancelRide: %v", err)
	}

	after := riderWalletBalance(t, ctx, pool, rider)
	if after != before {
		t.Errorf("rider wallet balance moved on cancelling a Paystack-funded ride: %d -> %d (settlement.Refund must never run for this trip)", before, after)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("ExternalRefunder called %d times, want exactly 1", len(fake.calls))
	}
	if fake.calls[0].tripID != tripID {
		t.Errorf("refunder called with tripID=%s, want %s", fake.calls[0].tripID, tripID)
	}

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, fake.calls[0].settlementID).Scan(&status); err != nil {
		t.Fatalf("read settlement status: %v", err)
	}
	// The fake refunder is a no-op stand-in for the real gateway+ledger
	// reversal, so the settlement legitimately stays 'escrowed' here — this
	// assertion exists only to confirm the row transport pointed at is real.
	if status == "" {
		t.Fatal("settlement row not found")
	}
}

// TestLiveDB_CancelRide_PaystackFundedNoRefunderWiredDoesNotWalletCredit
// proves the fail-CLOSED default: with no ExternalRefunder wired at all
// (e.g. the feature flag off), cancelling a Paystack-funded trip must NOT
// fall back to settlement.Refund — it must do nothing to the rider's wallet
// and leave the settlement for manual reconciliation instead.
func TestLiveDB_CancelRide_PaystackFundedNoRefunderWiredDoesNotWalletCredit(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, rider := paystackRideFixture(t, ctx, pool, 10_000_000)
	// Deliberately no SetExternalRefunder call.

	req := instantReq("pfride-norefunder-" + uuid.New().String())
	quoted, err := svc.QuoteRide(ctx, req)
	if err != nil {
		t.Fatalf("QuoteRide: %v", err)
	}
	trip, err := svc.RequestRidePaystackFunded(ctx, rider, req, req.IdempotencyKey, quoted)
	if err != nil {
		t.Fatalf("RequestRidePaystackFunded: %v", err)
	}
	tripID, _ := trip.Trip["id"].(string)

	before := riderWalletBalance(t, ctx, pool, rider)
	if err := svc.CancelRide(ctx, tripID, rider, "customer_changed_mind"); err != nil {
		t.Fatalf("CancelRide: %v", err)
	}
	after := riderWalletBalance(t, ctx, pool, rider)
	if after != before {
		t.Errorf("rider wallet balance moved with no ExternalRefunder wired: %d -> %d (must fail closed, never wallet-credit)", before, after)
	}
}

// TestLiveDB_AdjustEscrow_RefusesFareRaiseOnPaystackFundedTrip: a rider
// offer/counter-accept on a Paystack-funded trip must never try to escrow
// more from the wallet — there is no wallet funding behind that trip at all.
func TestLiveDB_AdjustEscrow_RefusesFareRaiseOnPaystackFundedTrip(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, rider := paystackRideFixture(t, ctx, pool, 10_000_000)

	req := instantReq("pfride-raise-" + uuid.New().String())
	quoted, err := svc.QuoteRide(ctx, req)
	if err != nil {
		t.Fatalf("QuoteRide: %v", err)
	}
	trip, err := svc.RequestRidePaystackFunded(ctx, rider, req, req.IdempotencyKey, quoted)
	if err != nil {
		t.Fatalf("RequestRidePaystackFunded: %v", err)
	}
	tripID, _ := trip.Trip["id"].(string)

	// A rider "offer" that RAISES the fare above what was already escrowed.
	if _, err := svc.RiderOffer(ctx, tripID, rider, quoted+50_000); err == nil {
		t.Fatal("raising the fare on a Paystack-funded trip must be refused")
	}

	var ce *CodedError
	if _, err := svc.RiderOffer(ctx, tripID, rider, quoted+50_000); !errors.As(err, &ce) {
		t.Fatalf("expected a *CodedError, got %T: %v", err, err)
	}
}
