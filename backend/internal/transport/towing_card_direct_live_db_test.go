package transport

// LIVE-DB (TEST_DATABASE_URL) integration tests for the CARD-DIRECT towing
// booking path (BookTowingPaystackFunded[Frozen] / QuoteTowingBooking[Frozen] /
// FindTowingByIdempotencyKey / CancelTowing → refundSettlement) — the towing
// counterpart of paystackfunded_parcel_live_db_test.go and
// card_direct_hardening_live_db_test.go. They pin, against real SQL:
//  1. A Tier-0 user is refused by the wallet path but books via card-direct;
//     the tier gate never runs; the wallet balance is UNCHANGED.
//  2. The escrow is a balanced external journal on funding_source='external'.
//  3. Any verified amount other than the server quote is refused BEFORE any write.
//  4. Replaying a confirm never books or escrows twice; the job id is the
//     deterministic function of the key.
//  5. Cancel of a card-funded job never credits the wallet; no refunder wired
//     ⇒ fails closed and a retry completes; wallet-funded jobs still refund
//     the wallet.
//  6. H2 (replay over a refunded/foreign/wallet settlement books nothing),
//     H5 (insert failure reverses only a provably orphaned escrow) and H8
//     (priced from the frozen inputs, never a fresh routing/config read).
//
// Nothing here edits the shared transport_pricing_config row (other packages'
// live tests run concurrently against the same DB); config drift is simulated
// with a hand-built frozen snapshot instead.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func liveTowingReq() TowingBookRequest {
	return TowingBookRequest{
		ServiceType: "flatbed",
		VehicleType: "sedan",
		IssueType:   "breakdown",
		Pickup:      Place{Lat: 6.50, Lng: 3.40, Address: "3rd Mainland Bridge"},
		Dest:        &Place{Lat: 6.60, Lng: 3.35, Address: "AutoWorks Garage, Ikeja"},
	}
}

func towingSettlementRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, jobID string) (id, funding, status string, total int64) {
	t.Helper()
	if err := pool.QueryRow(ctx, `
		SELECT s.id, s.funding_source, s.status, s.total_kobo
		FROM towing_jobs j JOIN settlements s ON s.id = j.settlement_id WHERE j.id=$1`, jobID).
		Scan(&id, &funding, &status, &total); err != nil {
		t.Fatalf("read towing settlement: %v", err)
	}
	return
}

func countTowingByKey(t *testing.T, ctx context.Context, pool *pgxpool.Pool, key string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM towing_jobs WHERE idempotency_key=$1`, key).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func countSettlementsByKey(t *testing.T, ctx context.Context, pool *pgxpool.Pool, key string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM settlements WHERE idempotency_key=$1`, key).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestLiveDB_BookTowingPaystackFunded_SkipsTierGate_BalancedExternalEscrow(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 10_000_000) // Tier 0 (default)
	req := liveTowingReq()

	if _, err := svc.BookTowing(ctx, user, req, "pftow-wallet-"+uuid.New().String()); err == nil {
		t.Fatal("wallet BookTowing must be refused for a Tier-0 user (this feature must not relax it)")
	}

	quoted, err := svc.QuoteTowingBooking(ctx, req)
	if err != nil || quoted <= 0 {
		t.Fatalf("QuoteTowingBooking = %d, %v", quoted, err)
	}
	before := riderWalletBalance(t, ctx, pool, user)
	key := "towingorder:pftow-" + uuid.New().String()
	id, err := svc.BookTowingPaystackFunded(ctx, user, req, key, quoted)
	if err != nil {
		t.Fatalf("card-direct must succeed for a Tier-0 user: %v", err)
	}
	if id != externalTowingID(key) {
		t.Errorf("job id %s is not the deterministic id %s for the key", id, externalTowingID(key))
	}
	if after := riderWalletBalance(t, ctx, pool, user); after != before {
		t.Errorf("wallet moved on a card-funded tow: %d -> %d", before, after)
	}
	_, funding, status, total := towingSettlementRow(t, ctx, pool, id)
	if funding != "external" || status != "escrowed" || total != quoted {
		t.Errorf("settlement funding=%s status=%s total=%d, want external/escrowed/%d", funding, status, total, quoted)
	}
	var fare int64
	var jStatus string
	var pin *string
	if err := pool.QueryRow(ctx, `SELECT fare_kobo, status, pin FROM towing_jobs WHERE id=$1`, id).Scan(&fare, &jStatus, &pin); err != nil {
		t.Fatal(err)
	}
	if fare != quoted || jStatus != "requested" || pin == nil || *pin == "" {
		t.Errorf("job fare=%d status=%s pin=%v", fare, jStatus, pin)
	}
	var debit, credit int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'),0), COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'),0)
		FROM ledger_entries WHERE reference = $1`, "escrow:towing:"+id).Scan(&debit, &credit); err != nil {
		t.Fatal(err)
	}
	if debit != quoted || credit != quoted {
		t.Errorf("escrow journal debit=%d credit=%d, want both %d", debit, credit, quoted)
	}
}

func TestLiveDB_BookTowingPaystackFunded_AmountMismatch_NothingWritten(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	req := liveTowingReq()
	quoted, err := svc.QuoteTowingBooking(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	for _, wrong := range []int64{quoted - 1, quoted + 1, 0, -quoted} {
		key := "towingorder:pftow-mm-" + uuid.New().String()
		_, err := svc.BookTowingPaystackFunded(ctx, user, req, key, wrong)
		var ce *CodedError
		if !errors.As(err, &ce) || ce.Code != CodeAmountMismatch || ce.Status != http.StatusConflict {
			t.Fatalf("verified=%d: want AMOUNT_MISMATCH 409, got %v", wrong, err)
		}
		if n := countTowingByKey(t, ctx, pool, key); n != 0 {
			t.Errorf("verified=%d: a job row was written", wrong)
		}
		if sn := countSettlementsByKey(t, ctx, pool, key); sn != 0 {
			t.Errorf("verified=%d: an escrow was written before the cross-check", wrong)
		}
	}
}

func TestLiveDB_BookTowingPaystackFunded_RefusesInvalidRequestOrMissingKey(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	bad := liveTowingReq()
	bad.ServiceType = "wheel_lift" // not in towing_jobs.service_type CHECK: would fail INSERT after the money moved
	if _, err := svc.QuoteTowingBooking(ctx, bad); err == nil {
		t.Error("quote must refuse a request the INSERT would reject (never charge for an unbookable job)")
	}
	good := liveTowingReq()
	quoted, _ := svc.QuoteTowingBooking(ctx, good)
	if _, err := svc.BookTowingPaystackFunded(ctx, user, bad, "towingorder:bad-"+uuid.New().String(), quoted); err == nil {
		t.Error("book must refuse an invalid request before escrowing")
	}
	if _, err := svc.BookTowingPaystackFunded(ctx, user, good, "", quoted); err == nil {
		t.Error("empty idempotency key must be refused")
	}
}

func TestLiveDB_BookTowingPaystackFunded_ReplayBooksOnce_FindScopedToUser(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	req := liveTowingReq()
	quoted, _ := svc.QuoteTowingBooking(ctx, req)
	key := "towingorder:pftow-replay-" + uuid.New().String()
	a, err := svc.BookTowingPaystackFunded(ctx, user, req, key, quoted)
	if err != nil {
		t.Fatal(err)
	}
	b, err := svc.BookTowingPaystackFunded(ctx, user, req, key, quoted)
	if err != nil || a != b {
		t.Fatalf("replay must return the same job: %s vs %s (%v)", a, b, err)
	}
	if n := countTowingByKey(t, ctx, pool, key); n != 1 {
		t.Errorf("%d jobs for one charge", n)
	}
	if sn := countSettlementsByKey(t, ctx, pool, key); sn != 1 {
		t.Errorf("%d escrows for one charge", sn)
	}
	got, found, err := svc.FindTowingByIdempotencyKey(ctx, user, key)
	if err != nil || !found || got != a {
		t.Errorf("Find = %s %v %v", got, found, err)
	}
	if _, found, _ := svc.FindTowingByIdempotencyKey(ctx, uuid.New().String(), key); found {
		t.Error("Find must be scoped to the user")
	}
}

func TestLiveDB_CancelTowing_CardFunded_UsesExternalRefunder_NeverWalletCredit(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 10_000_000)
	fake := &fakeParcelRefunder{}
	svc.SetDomainExternalRefunder("towing", fake)

	req := liveTowingReq()
	quoted, _ := svc.QuoteTowingBooking(ctx, req)
	id, err := svc.BookTowingPaystackFunded(ctx, user, req, "towingorder:pftow-cx-"+uuid.New().String(), quoted)
	if err != nil {
		t.Fatal(err)
	}
	before := riderWalletBalance(t, ctx, pool, user)
	if err := svc.CancelTowing(ctx, id, user, "changed_mind"); err != nil {
		t.Fatalf("CancelTowing: %v", err)
	}
	if after := riderWalletBalance(t, ctx, pool, user); after != before {
		t.Errorf("wallet moved cancelling a card-funded tow: %d -> %d (settlement.Refund must never run)", before, after)
	}
	sid, _, _, _ := towingSettlementRow(t, ctx, pool, id)
	if len(fake.calls) != 1 || fake.calls[0].entityID != id || fake.calls[0].settlementID != sid {
		t.Fatalf("refunder calls %+v, want exactly one for job %s / settlement %s", fake.calls, id, sid)
	}
}

func TestLiveDB_CancelTowing_CardFunded_NoRefunderFailsClosed_ThenRetryCompletes(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 10_000_000)
	// Deliberately no SetDomainExternalRefunder.
	req := liveTowingReq()
	quoted, _ := svc.QuoteTowingBooking(ctx, req)
	id, err := svc.BookTowingPaystackFunded(ctx, user, req, "towingorder:pftow-nr-"+uuid.New().String(), quoted)
	if err != nil {
		t.Fatal(err)
	}
	before := riderWalletBalance(t, ctx, pool, user)
	// M2: refused up front — the job is NOT flipped to a cancelled state whose
	// refund cannot run (it used to answer success with the money still escrowed).
	err = svc.CancelTowing(ctx, id, user, "x")
	wantCoded(t, err, 503, "refund_unavailable")
	if after := riderWalletBalance(t, ctx, pool, user); after != before {
		t.Fatalf("wallet credited with no refunder wired: %d -> %d", before, after)
	}
	if _, _, status, _ := towingSettlementRow(t, ctx, pool, id); status != "escrowed" {
		t.Fatalf("settlement is %s; must stay escrowed", status)
	}
	var jst string
	_ = pool.QueryRow(ctx, `SELECT status FROM towing_jobs WHERE id=$1`, id).Scan(&jst)
	if jst != "requested" {
		t.Fatalf("job status %q: a cancel that cannot refund must not flip the job", jst)
	}

	fake := &fakeParcelRefunder{}
	svc.SetDomainExternalRefunder("towing", fake)
	if err := svc.CancelTowing(ctx, id, user, "retry"); err != nil {
		t.Fatalf("retry cancel: %v", err)
	}
	if len(fake.calls) != 1 || fake.calls[0].entityID != id {
		t.Errorf("retry refund calls %+v", fake.calls)
	}
}

func TestLiveDB_CancelTowing_CardFunded_RefunderFailure_RetryRePosts(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	fake := &fakeParcelRefunder{err: errors.New("gateway down")}
	svc.SetDomainExternalRefunder("towing", fake)
	req := liveTowingReq()
	quoted, _ := svc.QuoteTowingBooking(ctx, req)
	id, err := svc.BookTowingPaystackFunded(ctx, user, req, "towingorder:pftow-rf-"+uuid.New().String(), quoted)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.CancelTowing(ctx, id, user, "x"); err != nil {
		t.Fatalf("first cancel flips the job even when the refund fails: %v", err)
	}
	fake.err = nil
	if err := svc.CancelTowing(ctx, id, user, "retry"); err != nil {
		t.Fatalf("re-POST must finish the refund: %v", err)
	}
	if len(fake.calls) != 2 {
		t.Errorf("refunder calls %d, want 2 (failed + retried)", len(fake.calls))
	}
}

func TestLiveDB_CancelTowing_WalletFunded_StillRefundsWallet(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited)
	fake := &fakeParcelRefunder{}
	svc.SetDomainExternalRefunder("towing", fake)

	j, err := svc.BookTowing(ctx, user, liveTowingReq(), "pftow-wal-"+uuid.New().String())
	if err != nil {
		t.Fatalf("wallet BookTowing (Tier 3): %v", err)
	}
	id, _ := j["id"].(string)
	afterBook := riderWalletBalance(t, ctx, pool, user)
	if err := svc.CancelTowing(ctx, id, user, "x"); err != nil {
		t.Fatal(err)
	}
	fare, _ := j["fareKobo"].(int64)
	if got := riderWalletBalance(t, ctx, pool, user); got != afterBook+fare {
		t.Errorf("wallet-funded cancel refund: balance %d, want %d", got, afterBook+fare)
	}
	if len(fake.calls) != 0 {
		t.Errorf("external refunder must not be consulted for a wallet-funded job: %+v", fake.calls)
	}
}

// ── H2 ──────────────────────────────────────────────────────────────────────

func TestLiveDB_BookTowingPaystackFunded_ReplayOverRefundedSettlement_BooksNothing(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	req := liveTowingReq()
	quoted, _ := svc.QuoteTowingBooking(ctx, req)
	key := "towingorder:h2-" + uuid.New().String()
	id, err := svc.BookTowingPaystackFunded(ctx, user, req, key, quoted)
	if err != nil {
		t.Fatal(err)
	}
	sid, _, _, _ := towingSettlementRow(t, ctx, pool, id)
	if _, err := pool.Exec(ctx, `DELETE FROM towing_jobs WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if err := svc.settlement.RefundExternal(ctx, sid, "test_unwind"); err != nil {
		t.Fatal(err)
	}
	if got, err := svc.BookTowingPaystackFunded(ctx, user, req, key, quoted); err == nil {
		t.Fatalf("booked job %s on a refunded escrow: the user would get a tow for money that already went back to their card", got)
	}
	if n := countTowingByKey(t, ctx, pool, key); n != 0 {
		t.Errorf("%d jobs created", n)
	}
	var st string
	_ = pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, sid).Scan(&st)
	if st != "refunded" {
		t.Errorf("settlement was revived to %q", st)
	}
}

func TestLiveDB_BookTowingPaystackFunded_ReplayOverForeignOrWalletSettlement_Refused(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	_, _, other := paystackRideFixture(t, ctx, pool, 0)
	req := liveTowingReq()
	quoted, _ := svc.QuoteTowingBooking(ctx, req)

	for name, tc := range map[string]struct{ payer, funding string }{
		"another payer's escrow": {other, "external"},
		"wallet-funded escrow":   {user, "wallet"},
	} {
		key := "towingorder:h2x-" + uuid.New().String()
		if _, err := pool.Exec(ctx, `
			INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, status, escrowed_at, idempotency_key, funding_source)
			VALUES ($1,$2,'transport',$3,$4,'escrowed',now(),$5,$6)`,
			uuid.New().String(), "towing:seed", tc.payer, quoted, key, tc.funding); err != nil {
			t.Fatalf("%s seed: %v", name, err)
		}
		if _, err := svc.BookTowingPaystackFunded(ctx, user, req, key, quoted); err == nil {
			t.Errorf("%s: a job was booked on a settlement that is not this user's external escrow", name)
		}
		if n := countTowingByKey(t, ctx, pool, key); n != 0 {
			t.Errorf("%s: %d jobs created", name, n)
		}
	}
}

// ── H5 ──────────────────────────────────────────────────────────────────────

func TestLiveDB_BookTowingPaystackFunded_InsertFailure_ReversesEscrowWhenNoJobOwnsIt(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	req := liveTowingReq()
	quoted, _ := svc.QuoteTowingBooking(ctx, req)

	// Occupy the id the NEXT booking will use with an unrelated job so its
	// INSERT hits the primary key: a real insert failure with no job under
	// (user, key).
	k1 := "towingorder:h5a-" + uuid.New().String()
	k2 := "towingorder:h5b-" + uuid.New().String()
	first, err := svc.BookTowingPaystackFunded(ctx, user, req, k1, quoted)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE towing_jobs SET id=$1 WHERE id=$2`, externalTowingID(k2), first); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.BookTowingPaystackFunded(ctx, user, req, k2, quoted); err == nil {
		t.Fatal("insert collision must surface as an error")
	}
	var st string
	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE idempotency_key=$1`, k2).Scan(&st); err != nil {
		t.Fatal(err)
	}
	if st != "refunded" {
		t.Fatalf("orphan escrow status %q, want refunded (no job owns it, so the engine's gateway refund must leave balanced books)", st)
	}
	var debit, credit int64
	_ = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'),0), COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'),0)
		FROM ledger_entries WHERE reference IN ($1,$2)`, "escrow:towing:"+externalTowingID(k2), "refund:towing:"+externalTowingID(k2)).Scan(&debit, &credit)
	if debit != credit || debit != 2*quoted {
		t.Errorf("ledger debit=%d credit=%d, want balanced at %d", debit, credit, 2*quoted)
	}
}

// ── H8 ──────────────────────────────────────────────────────────────────────

// shiftingMaps changes the distance on EVERY call; the wallet/live path would
// price differently each time. calls counts routing queries.
type shiftingMaps struct {
	*MockMaps
	calls int32
}

func (m *shiftingMaps) Route(ctx context.Context, from, to LatLng) (RouteResult, error) {
	n := atomic.AddInt32(&m.calls, 1)
	rr, err := m.MockMaps.Route(ctx, from, to)
	rr.DistanceM += int(n) * 5_000
	return rr, err
}

func TestLiveDB_BookTowingPaystackFunded_PricedFromFrozenInputs_NotARoutingReQuery(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	maps := &shiftingMaps{MockMaps: NewMockMaps()}
	svc = svc.WithMaps(maps)
	req := liveTowingReq()

	quoted, frozen, err := svc.QuoteTowingBookingFrozen(ctx, req)
	if err != nil || quoted <= 0 || len(frozen) == 0 {
		t.Fatalf("frozen quote: %d %s %v", quoted, frozen, err)
	}
	quoteCalls := atomic.LoadInt32(&maps.calls)
	if quoteCalls != 1 {
		t.Fatalf("quote routed %d times, want 1", quoteCalls)
	}
	// A fresh live quote now differs (the route moved) — the bug H8 prevents.
	if live, _ := svc.QuoteTowingBooking(ctx, req); live == quoted {
		t.Fatal("test setup: shifting maps must change the live price")
	}
	calls := atomic.LoadInt32(&maps.calls)

	key := "towingorder:h8-" + uuid.New().String()
	id, err := svc.BookTowingPaystackFundedFrozen(ctx, user, req, key, quoted, frozen)
	if err != nil {
		t.Fatalf("a correctly charged job was refused after the route moved: %v", err)
	}
	if got := atomic.LoadInt32(&maps.calls); got != calls {
		t.Errorf("Book re-queried routing (%d → %d); it must price from the frozen inputs", calls, got)
	}
	var fare int64
	_ = pool.QueryRow(ctx, `SELECT fare_kobo FROM towing_jobs WHERE id=$1`, id).Scan(&fare)
	if fare != quoted {
		t.Errorf("job fare %d != charged %d", fare, quoted)
	}
}

func TestLiveDB_BookTowingPaystackFunded_FrozenConfigWins_OverLiveConfig(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	req := liveTowingReq()

	live, frozen, err := svc.QuoteTowingBookingFrozen(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a pricing-config edit between initiate and confirm by building
	// the snapshot the quote WOULD have frozen under a different config.
	var snap towingFrozenPricing
	if err := json.Unmarshal(frozen, &snap); err != nil {
		t.Fatal(err)
	}
	snap.Config.BaseFareKobo += 100_000
	edited, _ := json.Marshal(snap)
	chargedUnderEdited := towingFare(snap.DistanceM, &snap.Config)
	if chargedUnderEdited == live {
		t.Fatal("test setup: edited config must change the price")
	}

	// charged = what the frozen (edited) snapshot says → books;
	// charged = the live price while a snapshot says otherwise → refused.
	if _, err := svc.BookTowingPaystackFundedFrozen(ctx, user, req, "towingorder:h8c-"+uuid.New().String(), live, edited); err == nil {
		t.Error("a charge that doesn't match the frozen snapshot's price must be refused")
	}
	k := "towingorder:h8d-" + uuid.New().String()
	if _, err := svc.BookTowingPaystackFundedFrozen(ctx, user, req, k, chargedUnderEdited, edited); err != nil {
		t.Errorf("a charge matching the frozen snapshot must book: %v", err)
	}
	// unreadable snapshot: error, never a silent live re-price
	if _, err := svc.BookTowingPaystackFundedFrozen(ctx, user, req, "towingorder:h8e-"+uuid.New().String(), live, json.RawMessage(`{`)); err == nil {
		t.Error("garbage frozen pricing must fail closed")
	}
}

func TestLiveDB_QuoteTowing_RoadsideWithoutDest_DoesNotRoute(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	maps := &shiftingMaps{MockMaps: NewMockMaps()}
	svc = svc.WithMaps(maps)
	req := liveTowingReq()
	req.ServiceType, req.Dest = "jumpstart", nil

	q, _, err := svc.QuoteTowingBookingFrozen(ctx, req)
	if err != nil || q <= 0 {
		t.Fatalf("roadside quote: %d %v", q, err)
	}
	id, err := svc.BookTowingPaystackFunded(ctx, user, req, "towingorder:road-"+uuid.New().String(), q)
	if err != nil {
		t.Fatalf("roadside book: %v", err)
	}
	if n := atomic.LoadInt32(&maps.calls); n != 0 {
		t.Errorf("a no-destination job must not route (%d calls)", n)
	}
	var dest *string
	_ = pool.QueryRow(ctx, `SELECT dest_address FROM towing_jobs WHERE id=$1`, id).Scan(&dest)
	if dest != nil {
		t.Errorf("dest_address = %v, want NULL", *dest)
	}
}
