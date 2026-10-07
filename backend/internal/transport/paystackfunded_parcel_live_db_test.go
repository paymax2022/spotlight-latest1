package transport

// LIVE-DB integration tests for the CARD-DIRECT parcel booking path
// (BookParcelPaystackFunded / QuoteParcelBooking / refundSettlement) — the
// parcel counterpart of paystackfunded_live_db_test.go. Gated on
// TEST_DATABASE_URL like every live-DB suite here. What these pin:
//  1. A Tier-0 sender is refused by the wallet path but books via card-direct;
//     the tier gate never runs; the wallet balance is UNCHANGED.
//  2. The escrow is a balanced external journal (DR provider-clearing / CR
//     escrow) on a settlement with funding_source='external'.
//  3. The charged amount QuoteParcelBooking returns is exactly what the
//     booking accepts; any other verified amount is refused BEFORE any write.
//  4. Replaying a confirm never books or escrows twice.
//  5. Cancelling a card-funded parcel NEVER credits the sender's wallet — it
//     goes through the domain's external refunder; with none wired it fails
//     closed; a later retry (after wiring) completes the refund.
//  6. Wallet-funded parcels still refund to the wallet (regression guard).

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func parcelReq() ParcelBookRequest {
	return ParcelBookRequest{
		Pickup:            Place{Lat: 6.50, Lng: 3.40, Address: "A, Lagos"},
		Dropoff:           Place{Lat: 6.60, Lng: 3.35, Address: "B, Lagos"},
		ReceiverName:      "Ada",
		ReceiverPhone:     "+2348000000000",
		Size:              "small",
		Speed:             "standard",
		ProhibitedAck:     true,
		DeclaredValueKobo: 0,
	}
}

// fakeParcelRefunder records calls like fakeExternalRefunder, keyed by entity.
type fakeParcelRefunder struct {
	calls []struct{ entityID, settlementID, reason string }
	err   error
}

func (f *fakeParcelRefunder) RefundExternalSettlement(_ context.Context, entityID, settlementID, reason string) error {
	f.calls = append(f.calls, struct{ entityID, settlementID, reason string }{entityID, settlementID, reason})
	return f.err
}

func settlementRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, parcelID string) (id, funding, status string, total int64) {
	t.Helper()
	if err := pool.QueryRow(ctx, `
		SELECT s.id, s.funding_source, s.status, s.total_kobo
		FROM parcels p JOIN settlements s ON s.id = p.settlement_id WHERE p.id=$1`, parcelID).
		Scan(&id, &funding, &status, &total); err != nil {
		t.Fatalf("read parcel settlement: %v", err)
	}
	return
}

func countParcelsByKey(t *testing.T, ctx context.Context, pool *pgxpool.Pool, key string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM parcels WHERE idempotency_key=$1`, key).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestLiveDB_BookParcelPaystackFunded_SkipsTierGate_BalancedExternalEscrow(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, sender := paystackRideFixture(t, ctx, pool, 10_000_000) // Tier 0 (default)
	req := parcelReq()

	if _, err := svc.BookParcel(ctx, sender, req, "pfparcel-wallet-"+uuid.New().String()); err == nil {
		t.Fatal("wallet BookParcel must be refused for a Tier-0 sender (this feature must not relax it)")
	}

	quoted, err := svc.QuoteParcelBooking(ctx, req)
	if err != nil || quoted <= 0 {
		t.Fatalf("QuoteParcelBooking = %d, %v", quoted, err)
	}
	before := riderWalletBalance(t, ctx, pool, sender)
	key := "parcelorder:pfparcel-" + uuid.New().String()
	id, err := svc.BookParcelPaystackFunded(ctx, sender, req, key, quoted)
	if err != nil {
		t.Fatalf("card-direct must succeed for a Tier-0 sender: %v", err)
	}
	if after := riderWalletBalance(t, ctx, pool, sender); after != before {
		t.Errorf("sender wallet moved on a card-funded parcel: %d -> %d", before, after)
	}

	sid, funding, status, total := settlementRow(t, ctx, pool, id)
	if funding != "external" || status != "escrowed" || total != quoted {
		t.Errorf("settlement funding=%s status=%s total=%d, want external/escrowed/%d", funding, status, total, quoted)
	}
	var fare int64
	var pStatus string
	if err := pool.QueryRow(ctx, `SELECT fare_kobo, status FROM parcels WHERE id=$1`, id).Scan(&fare, &pStatus); err != nil {
		t.Fatal(err)
	}
	if fare != quoted || pStatus != "created" {
		t.Errorf("parcel fare=%d status=%s", fare, pStatus)
	}
	// Balanced journal: the escrow legs for this parcel net to zero.
	var debit, credit int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'),0), COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'),0)
		FROM ledger_entries WHERE reference = $1`, "escrow:parcel:"+id).Scan(&debit, &credit); err != nil {
		t.Fatal(err)
	}
	if debit != quoted || credit != quoted {
		t.Errorf("escrow journal debit=%d credit=%d, want both %d", debit, credit, quoted)
	}
	_ = sid
}

func TestLiveDB_BookParcelPaystackFunded_AmountMismatch_NothingWritten(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, sender := paystackRideFixture(t, ctx, pool, 0)
	req := parcelReq()
	quoted, err := svc.QuoteParcelBooking(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	for _, wrong := range []int64{quoted - 1, quoted + 1, 0, -quoted} {
		key := "parcelorder:pfparcel-mm-" + uuid.New().String()
		_, err := svc.BookParcelPaystackFunded(ctx, sender, req, key, wrong)
		var ce *CodedError
		if !errors.As(err, &ce) || ce.Code != CodeAmountMismatch || ce.Status != http.StatusConflict {
			t.Fatalf("verified=%d: want AMOUNT_MISMATCH 409, got %v", wrong, err)
		}
		if n := countParcelsByKey(t, ctx, pool, key); n != 0 {
			t.Errorf("verified=%d: a parcel row was written", wrong)
		}
		var sn int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM settlements WHERE idempotency_key=$1`, key).Scan(&sn)
		if sn != 0 {
			t.Errorf("verified=%d: an escrow was written before the cross-check", wrong)
		}
	}
}

func TestLiveDB_BookParcelPaystackFunded_RefusesWithoutAckOrKey(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, sender := paystackRideFixture(t, ctx, pool, 0)
	req := parcelReq()
	req.ProhibitedAck = false
	if _, err := svc.QuoteParcelBooking(ctx, req); err == nil {
		t.Error("quote must refuse a missing prohibited-items acknowledgement (never charge for an unbookable parcel)")
	}
	if _, err := svc.BookParcelPaystackFunded(ctx, sender, parcelReq(), "", 1); err == nil {
		t.Error("empty idempotency key must be refused")
	}
}

func TestLiveDB_BookParcelPaystackFunded_ReplayBooksOnce(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, sender := paystackRideFixture(t, ctx, pool, 0)
	req := parcelReq()
	quoted, _ := svc.QuoteParcelBooking(ctx, req)
	key := "parcelorder:pfparcel-replay-" + uuid.New().String()
	a, err := svc.BookParcelPaystackFunded(ctx, sender, req, key, quoted)
	if err != nil {
		t.Fatal(err)
	}
	b, err := svc.BookParcelPaystackFunded(ctx, sender, req, key, quoted)
	if err != nil || a != b {
		t.Fatalf("replay must return the same parcel: %s vs %s (%v)", a, b, err)
	}
	if n := countParcelsByKey(t, ctx, pool, key); n != 1 {
		t.Errorf("%d parcels for one charge", n)
	}
	var sn int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM settlements WHERE idempotency_key=$1`, key).Scan(&sn)
	if sn != 1 {
		t.Errorf("%d escrows for one charge", sn)
	}
	got, found, err := svc.FindParcelByIdempotencyKey(ctx, sender, key)
	if err != nil || !found || got != a {
		t.Errorf("Find = %s %v %v", got, found, err)
	}
	if _, found, _ := svc.FindParcelByIdempotencyKey(ctx, uuid.New().String(), key); found {
		t.Error("Find must be scoped to the sender")
	}
}

func TestLiveDB_CancelParcel_CardFunded_UsesExternalRefunder_NeverWalletCredit(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, sender := paystackRideFixture(t, ctx, pool, 10_000_000)
	fake := &fakeParcelRefunder{}
	svc.SetDomainExternalRefunder("parcel", fake)

	req := parcelReq()
	quoted, _ := svc.QuoteParcelBooking(ctx, req)
	id, err := svc.BookParcelPaystackFunded(ctx, sender, req, "parcelorder:pfparcel-cx-"+uuid.New().String(), quoted)
	if err != nil {
		t.Fatal(err)
	}
	before := riderWalletBalance(t, ctx, pool, sender)
	if err := svc.CancelParcel(ctx, id, sender, "changed_mind"); err != nil {
		t.Fatalf("CancelParcel: %v", err)
	}
	if after := riderWalletBalance(t, ctx, pool, sender); after != before {
		t.Errorf("wallet moved cancelling a card-funded parcel: %d -> %d (settlement.Refund must never run)", before, after)
	}
	if len(fake.calls) != 1 || fake.calls[0].entityID != id {
		t.Fatalf("refunder calls %+v, want exactly one for parcel %s", fake.calls, id)
	}
	sid, _, _, _ := settlementRow(t, ctx, pool, id)
	if fake.calls[0].settlementID != sid {
		t.Errorf("refunder got settlement %s, want %s", fake.calls[0].settlementID, sid)
	}
}

func TestLiveDB_CancelParcel_CardFunded_NoRefunderFailsClosed_ThenRetryCompletes(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, sender := paystackRideFixture(t, ctx, pool, 10_000_000)
	// Deliberately no SetDomainExternalRefunder.
	req := parcelReq()
	quoted, _ := svc.QuoteParcelBooking(ctx, req)
	id, err := svc.BookParcelPaystackFunded(ctx, sender, req, "parcelorder:pfparcel-nr-"+uuid.New().String(), quoted)
	if err != nil {
		t.Fatal(err)
	}
	before := riderWalletBalance(t, ctx, pool, sender)
	// M2: with no refunder wired the cancel is REFUSED up front (the parcel is
	// not flipped to a state whose refund cannot run) — it used to answer
	// success while the money stayed escrowed.
	err = svc.CancelParcel(ctx, id, sender, "x")
	wantCoded(t, err, 503, "refund_unavailable")
	if after := riderWalletBalance(t, ctx, pool, sender); after != before {
		t.Fatalf("wallet credited with no refunder wired: %d -> %d", before, after)
	}
	var pst string
	_ = pool.QueryRow(ctx, `SELECT status FROM parcels WHERE id=$1`, id).Scan(&pst)
	if pst != "created" {
		t.Fatalf("parcel status %q: a cancel that cannot refund must not flip the parcel", pst)
	}
	_, _, status, _ := settlementRow(t, ctx, pool, id)
	if status != "escrowed" {
		t.Fatalf("settlement is %s; must stay escrowed", status)
	}

	// Ops wires the refunder / flips the flag; the customer's retry completes.
	fake := &fakeParcelRefunder{}
	svc.SetDomainExternalRefunder("parcel", fake)
	if err := svc.CancelParcel(ctx, id, sender, "retry"); err != nil {
		t.Fatalf("retry cancel: %v", err)
	}
	if len(fake.calls) != 1 || fake.calls[0].entityID != id {
		t.Errorf("retry refund calls %+v", fake.calls)
	}
}

func TestLiveDB_CancelParcel_WalletFunded_StillRefundsWallet(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, sender := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, sender, testsupport.KycTierUnlimited)
	fake := &fakeParcelRefunder{}
	svc.SetDomainExternalRefunder("parcel", fake)

	p, err := svc.BookParcel(ctx, sender, parcelReq(), "pfparcel-wal-"+uuid.New().String())
	if err != nil {
		t.Fatalf("wallet BookParcel (Tier 3): %v", err)
	}
	id, _ := p["id"].(string)
	afterBook := riderWalletBalance(t, ctx, pool, sender)
	if err := svc.CancelParcel(ctx, id, sender, "x"); err != nil {
		t.Fatal(err)
	}
	fare, _ := p["fareKobo"].(int64)
	if got := riderWalletBalance(t, ctx, pool, sender); got != afterBook+fare {
		t.Errorf("wallet-funded cancel refund: balance %d, want %d", got, afterBook+fare)
	}
	if len(fake.calls) != 0 {
		t.Errorf("external refunder must not be consulted for a wallet-funded parcel: %+v", fake.calls)
	}
}
