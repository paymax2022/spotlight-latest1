package transport

// CARD-DIRECT CAR HIRE (ADR-PR522-mobility-card-direct, "Partial refunds (car
// hire)"): ONE Paystack charge = fare + deposit, held as TWO external
// settlements ("carhire:<id>" keyed "<ref>:fare", "carhire:<id>:deposit" keyed
// "<ref>:deposit"). Live-DB proofs (TEST_DATABASE_URL) of:
//   - book: Tier-0 succeeds, wallet untouched, two balanced external journals,
//     amount mismatch writes nothing, replay books once, H2 per settlement,
//     deposit-failure / insert-failure compensation, frozen pricing;
//   - cancel before activation refunds BOTH settlements to the card (never the
//     wallet), fails closed with no refunder, is re-POSTable, and is refused
//     while active/extended;
//   - complete settles the fare, returns the FULL deposit to the card, is
//     re-entrant, refuses a no-driver booking, and races cancel safely;
//   - extend is refused for card bookings; the wallet rail is unchanged;
//   - the admin status patch and the reconciler sweep cover both settlements.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func liveCarHireReq() CarHireBookRequest {
	return CarHireBookRequest{
		HireType: "daily", VehicleClass: "executive",
		StartAt:       time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339),
		DurationHours: 8, Chauffeur: true, PickupAddress: "Ikeja, Lagos",
	}
}

// chRefunder is a card refunder whose success reverses the settlement
// ledger-side (what the real engine refunder does after the gateway accepts),
// and whose failures can be injected per settlement.
type chRefunder struct {
	svc   *Service
	mu    sync.Mutex
	fail  map[string]error // settlementID → error
	calls []string         // settlement ids, in order
}

func (f *chRefunder) RefundExternalSettlement(ctx context.Context, _ string, settlementID, reason string) error {
	f.mu.Lock()
	f.calls = append(f.calls, settlementID)
	err := f.fail[settlementID]
	f.mu.Unlock()
	if err != nil {
		return err
	}
	return f.svc.settlement.RefundExternal(ctx, settlementID, reason)
}

func (f *chRefunder) called() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.calls...)
}

type chSetts struct{ fareID, depID string }

func carHireSetts(t *testing.T, ctx context.Context, pool *pgxpool.Pool, bookingID string) chSetts {
	t.Helper()
	var s chSetts
	if err := pool.QueryRow(ctx, `SELECT id::text FROM settlements WHERE reference=$1`, "carhire:"+bookingID).Scan(&s.fareID); err != nil {
		t.Fatalf("fare settlement: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT id::text FROM settlements WHERE reference=$1`, "carhire:"+bookingID+":deposit").Scan(&s.depID); err != nil {
		t.Fatalf("deposit settlement: %v", err)
	}
	return s
}

func settStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

func carHireStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(ctx, `SELECT status FROM car_hire_bookings WHERE id=$1`, id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

// cardCarHire books a card-funded hire for user and returns its id, key,
// fare, deposit.
func cardCarHire(t *testing.T, ctx context.Context, svc *Service, user string) (id, key string, fare, deposit int64) {
	t.Helper()
	req := liveCarHireReq()
	total, frozen, err := svc.QuoteCarHireBookingFrozen(ctx, req)
	if err != nil || total <= 0 {
		t.Fatalf("QuoteCarHireBookingFrozen = %d, %v", total, err)
	}
	q, err := svc.QuoteCarHire(ctx, CarHireQuoteRequest{DurationHours: req.DurationHours, StartAt: req.StartAt})
	if err != nil {
		t.Fatal(err)
	}
	if q.TotalKobo != total {
		t.Fatalf("card quote %d differs from the wallet quote %d", total, q.TotalKobo)
	}
	key = "carhireorder:ch-" + uuid.NewString()
	id, err = svc.BookCarHirePaystackFundedFrozen(ctx, user, req, key, total, frozen)
	if err != nil {
		t.Fatalf("card-direct book: %v", err)
	}
	return id, key, q.FareKobo, q.DepositKobo
}

func assignCarHireDriver(t *testing.T, ctx context.Context, pool *pgxpool.Pool, bookingID string) (driverUser string) {
	t.Helper()
	du, did := seedMoverDriver(t, ctx, pool)
	if _, err := pool.Exec(ctx, `UPDATE car_hire_bookings SET driver_id=$1 WHERE id=$2`, did, bookingID); err != nil {
		t.Fatal(err)
	}
	return du
}

func setCarHireStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id, st string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `UPDATE car_hire_bookings SET status=$1 WHERE id=$2`, st, id); err != nil {
		t.Fatal(err)
	}
}

func countCarHireByKey(t *testing.T, ctx context.Context, pool *pgxpool.Pool, key string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM car_hire_bookings WHERE idempotency_key=$1`, key).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// ── pure ────────────────────────────────────────────────────────────────────

func TestCarHireQuote_RejectsNonPositiveFare_Overflow_PastStart_BadHireType(t *testing.T) {
	now := time.Now()
	good := liveCarHireReq()
	if err := validateCarHireBookRequest(good, true, now); err != nil {
		t.Fatalf("good request refused: %v", err)
	}
	mut := func(f func(*CarHireBookRequest)) CarHireBookRequest { r := good; f(&r); return r }
	cases := map[string]CarHireBookRequest{
		"bad hire_type":      mut(func(r *CarHireBookRequest) { r.HireType = "weekly" }),
		"unparseable start":  mut(func(r *CarHireBookRequest) { r.StartAt = "tomorrow" }),
		"start long past":    mut(func(r *CarHireBookRequest) { r.StartAt = now.Add(-72 * time.Hour).UTC().Format(time.RFC3339) }),
		"start far future":   mut(func(r *CarHireBookRequest) { r.StartAt = now.Add(800 * 24 * time.Hour).UTC().Format(time.RFC3339) }),
		"zero duration":      mut(func(r *CarHireBookRequest) { r.DurationHours = 0 }),
		"duration too long":  mut(func(r *CarHireBookRequest) { r.DurationHours = maxCarHireHours + 1 }),
		"negative duration":  mut(func(r *CarHireBookRequest) { r.DurationHours = -3 }),
		"huge vehicle_class": mut(func(r *CarHireBookRequest) { r.VehicleClass = strings.Repeat("x", 200) }),
		"huge pickup":        mut(func(r *CarHireBookRequest) { r.PickupAddress = strings.Repeat("x", 600) }),
	}
	for name, r := range cases {
		err := validateCarHireBookRequest(r, true, now)
		ce, ok := errors.AsType[*CodedError](err)
		if !ok || ce.Status != http.StatusBadRequest {
			t.Errorf("%s: err = %v, want a 400 CodedError", name, err)
		}
	}
	// A start a few hours in the past ("today" picked at midnight UTC) is allowed.
	today := mut(func(r *CarHireBookRequest) { r.StartAt = now.Add(-5 * time.Hour).UTC().Format(time.RFC3339) })
	if err := validateCarHireBookRequest(today, true, now); err != nil {
		t.Errorf("a same-day start was refused: %v", err)
	}
	// Non-strict (the confirm-time structural check) never refuses a past start.
	if err := validateCarHireBookRequest(cases["start long past"], false, now); err != nil {
		t.Errorf("confirm-time check must not refuse a paid booking over its date: %v", err)
	}
	// The wallet rail still gets the hire_type CHECK mirror (INSERT would fail after the escrow).
	if err := validateCarHireBookRequest(cases["bad hire_type"], false, now); err == nil {
		t.Error("hire_type must be validated on both rails")
	}

	// Totals: non-positive fare, negative deposit and overflow are refused.
	if _, _, err := carHireTotals(0, 100); err == nil {
		t.Error("a zero fare was accepted")
	}
	if _, _, err := carHireTotals(-5, 100); err == nil {
		t.Error("a negative fare was accepted")
	}
	if _, _, err := carHireTotals(100, -1); err == nil {
		t.Error("a negative deposit was accepted")
	}
	const maxI = int64(^uint64(0) >> 1)
	if _, _, err := carHireTotals(maxI, 1); err == nil {
		t.Error("fare+deposit overflow was accepted")
	}
	if f, tot, err := carHireTotals(564_000, 500_000); err != nil || f != 564_000 || tot != 1_064_000 {
		t.Errorf("totals %d %d %v", f, tot, err)
	}
}

func TestExternalCarHireID_IsDeterministicPerKey(t *testing.T) {
	a, b := externalCarHireID("carhireorder:k1-aaaaaaaa"), externalCarHireID("carhireorder:k1-aaaaaaaa")
	if a != b || a == externalCarHireID("carhireorder:k2-aaaaaaaa") {
		t.Fatalf("id not a function of the key: %s %s", a, b)
	}
	if _, err := uuid.Parse(a); err != nil {
		t.Fatal(err)
	}
}

// ── book ────────────────────────────────────────────────────────────────────

func TestLiveDB_BookCarHireCardDirect_Tier0_Succeeds_WalletUnchanged_TwoExternalSettlements_Balanced(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 10_000_000) // Tier 0 with a funded wallet

	req := liveCarHireReq()
	if _, err := svc.BookCarHire(ctx, user, req, "ch-wallet-"+uuid.NewString()); err == nil {
		t.Fatal("wallet BookCarHire must stay refused for a Tier-0 user")
	}
	before := riderWalletBalance(t, ctx, pool, user)
	id, key, fare, deposit := cardCarHire(t, ctx, svc, user)
	if id != externalCarHireID(key) {
		t.Errorf("booking id %s is not the deterministic id for the key", id)
	}
	if after := riderWalletBalance(t, ctx, pool, user); after != before {
		t.Errorf("wallet moved on a card-funded hire: %d -> %d", before, after)
	}
	s := carHireSetts(t, ctx, pool, id)
	for name, c := range map[string]struct {
		sid  string
		want int64
		key  string
	}{"fare": {s.fareID, fare, key + ":fare"}, "deposit": {s.depID, deposit, key + ":deposit"}} {
		var funding, status, ik string
		var total int64
		if err := pool.QueryRow(ctx, `SELECT funding_source, status, total_kobo, idempotency_key FROM settlements WHERE id=$1`, c.sid).Scan(&funding, &status, &total, &ik); err != nil {
			t.Fatal(err)
		}
		if funding != "external" || status != "escrowed" || total != c.want || ik != c.key {
			t.Errorf("%s settlement funding=%s status=%s total=%d key=%s, want external/escrowed/%d/%s", name, funding, status, total, ik, c.want, c.key)
		}
	}
	var bFare, bDep int64
	var bStatus string
	var bSett string
	if err := pool.QueryRow(ctx, `SELECT fare_kobo, deposit_kobo, status, settlement_id::text FROM car_hire_bookings WHERE id=$1`, id).Scan(&bFare, &bDep, &bStatus, &bSett); err != nil {
		t.Fatal(err)
	}
	if bFare != fare || bDep != deposit || bStatus != "confirmed" || bSett != s.fareID {
		t.Errorf("booking fare=%d deposit=%d status=%s settlement=%s", bFare, bDep, bStatus, bSett)
	}
	var d1, c1, d2, c2 int64
	_ = pool.QueryRow(ctx, `SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'),0), COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'),0) FROM ledger_entries WHERE reference=$1`, "escrow:carhire:"+id).Scan(&d1, &c1)
	_ = pool.QueryRow(ctx, `SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'),0), COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'),0) FROM ledger_entries WHERE reference=$1`, "escrow:carhire:"+id+":deposit").Scan(&d2, &c2)
	if d1 != fare || c1 != fare || d2 != deposit || c2 != deposit {
		t.Errorf("escrow journals fare %d/%d deposit %d/%d, want %d and %d balanced", d1, c1, d2, c2, fare, deposit)
	}
	// Detail reports the rail and an honest deposit state.
	det, err := svc.CarHireDetail(ctx, id, user)
	if err != nil {
		t.Fatal(err)
	}
	if det["fundingRail"] != "card" || det["depositStatus"] != "held" {
		t.Errorf("detail fundingRail=%v depositStatus=%v", det["fundingRail"], det["depositStatus"])
	}
}

func TestLiveDB_BookCarHireCardDirect_AmountMismatchPlusMinusOne_WritesNothing(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	req := liveCarHireReq()
	total, frozen, err := svc.QuoteCarHireBookingFrozen(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	for _, wrong := range []int64{total - 1, total + 1, 0, -total} {
		key := "carhireorder:chmm-" + uuid.NewString()
		_, err := svc.BookCarHirePaystackFundedFrozen(ctx, user, req, key, wrong, frozen)
		wantCoded(t, err, 409, CodeAmountMismatch)
		if countCarHireByKey(t, ctx, pool, key) != 0 || countSettlementsByKey(t, ctx, pool, key+":fare") != 0 || countSettlementsByKey(t, ctx, pool, key+":deposit") != 0 {
			t.Errorf("verified=%d: something was written before the cross-check", wrong)
		}
	}
	if _, err := svc.BookCarHirePaystackFundedFrozen(ctx, user, req, "", total, frozen); err == nil {
		t.Error("empty key accepted")
	}
}

func TestLiveDB_BookCarHireCardDirect_ReplayBooksOnce_FindScopedToPayer(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	req := liveCarHireReq()
	total, frozen, _ := svc.QuoteCarHireBookingFrozen(ctx, req)
	key := "carhireorder:chrp-" + uuid.NewString()
	a, err := svc.BookCarHirePaystackFundedFrozen(ctx, user, req, key, total, frozen)
	if err != nil {
		t.Fatal(err)
	}
	b, err := svc.BookCarHirePaystackFundedFrozen(ctx, user, req, key, total, frozen)
	if err != nil || a != b {
		t.Fatalf("replay: %s vs %s %v", a, b, err)
	}
	if countCarHireByKey(t, ctx, pool, key) != 1 || countSettlementsByKey(t, ctx, pool, key+":fare") != 1 || countSettlementsByKey(t, ctx, pool, key+":deposit") != 1 {
		t.Error("a replay booked or escrowed twice")
	}
	if got, found, err := svc.FindCarHireByIdempotencyKey(ctx, user, key); err != nil || !found || got != a {
		t.Errorf("Find = %s %v %v", got, found, err)
	}
	if _, found, _ := svc.FindCarHireByIdempotencyKey(ctx, uuid.NewString(), key); found {
		t.Error("Find must be scoped to the payer")
	}
}

func TestLiveDB_BookCarHireCardDirect_ReplayOverRefundedOrForeignSettlement_Refused(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	_, _, other := paystackRideFixture(t, ctx, pool, 0)
	req := liveCarHireReq()
	total, frozen, _ := svc.QuoteCarHireBookingFrozen(ctx, req)
	q, _ := svc.QuoteCarHire(ctx, CarHireQuoteRequest{DurationHours: req.DurationHours, StartAt: req.StartAt})

	seed := func(key, suffix, payer, funding, status string, amt int64) {
		if _, err := pool.Exec(ctx, `INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, status, escrowed_at, idempotency_key, funding_source)
			VALUES ($1,'carhire:seed','transport',$2,$3,$4,now(),$5,$6)`, uuid.NewString(), payer, amt, status, key+suffix, funding); err != nil {
			t.Fatal(err)
		}
	}
	type tc struct {
		name    string
		prepare func(key string)
	}
	for _, c := range []tc{
		{"refunded fare", func(k string) { seed(k, ":fare", user, "external", "refunded", q.FareKobo) }},
		{"foreign payer fare", func(k string) { seed(k, ":fare", other, "external", "escrowed", q.FareKobo) }},
		{"wallet-funded fare", func(k string) { seed(k, ":fare", user, "wallet", "escrowed", q.FareKobo) }},
		{"wrong-amount fare", func(k string) { seed(k, ":fare", user, "external", "escrowed", q.FareKobo+1) }},
		{"refunded deposit", func(k string) { seed(k, ":deposit", user, "external", "refunded", q.DepositKobo) }},
		{"foreign payer deposit", func(k string) { seed(k, ":deposit", other, "external", "escrowed", q.DepositKobo) }},
		{"wallet-funded deposit", func(k string) { seed(k, ":deposit", user, "wallet", "escrowed", q.DepositKobo) }},
	} {
		key := "carhireorder:chh2-" + uuid.NewString()
		c.prepare(key)
		if got, err := svc.BookCarHirePaystackFundedFrozen(ctx, user, req, key, total, frozen); err == nil {
			t.Errorf("%s: booked %s on a settlement that is not this user's live external escrow of this charge", c.name, got)
		}
		if countCarHireByKey(t, ctx, pool, key) != 0 {
			t.Errorf("%s: a booking row was written", c.name)
		}
	}
}

func TestLiveDB_BookCarHireCardDirect_DepositEscrowFails_FareReversedLedgerSide(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	req := liveCarHireReq()
	total, frozen, _ := svc.QuoteCarHireBookingFrozen(ctx, req)
	key := "carhireorder:chdf-" + uuid.NewString()
	// A refunded settlement squats the DEPOSIT key: the deposit leg fails the H2
	// replay check AFTER the fare was escrowed.
	if _, err := pool.Exec(ctx, `INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, status, escrowed_at, idempotency_key, funding_source)
		VALUES ($1,'carhire:squat','transport',$2,1,'refunded',now(),$3,'external')`, uuid.NewString(), user, key+":deposit"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.BookCarHirePaystackFundedFrozen(ctx, user, req, key, total, frozen); err == nil {
		t.Fatal("a deposit leg that failed must fail the booking")
	}
	if countCarHireByKey(t, ctx, pool, key) != 0 {
		t.Error("booking written")
	}
	var st string
	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE idempotency_key=$1`, key+":fare").Scan(&st); err != nil {
		t.Fatal(err)
	}
	if st != "refunded" {
		t.Fatalf("fare escrow is %q after the deposit leg failed; no booking owns it, so it must be reversed ledger-side for the engine's gateway refund", st)
	}
}

func TestLiveDB_BookCarHireCardDirect_InsertFailure_ReversesBothEscrowsWhenNoBookingOwnsThem(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	req := liveCarHireReq()
	total, frozen, _ := svc.QuoteCarHireBookingFrozen(ctx, req)
	k1 := "carhireorder:chin1-" + uuid.NewString()
	k2 := "carhireorder:chin2-" + uuid.NewString()
	first, err := svc.BookCarHirePaystackFundedFrozen(ctx, user, req, k1, total, frozen)
	if err != nil {
		t.Fatal(err)
	}
	// Occupy the id the next booking will use: its INSERT hits the primary key.
	if _, err := pool.Exec(ctx, `UPDATE car_hire_bookings SET id=$1 WHERE id=$2`, externalCarHireID(k2), first); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.BookCarHirePaystackFundedFrozen(ctx, user, req, k2, total, frozen); err == nil {
		t.Fatal("insert collision must surface as an error")
	}
	for _, sfx := range []string{":fare", ":deposit"} {
		var st string
		if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE idempotency_key=$1`, k2+sfx).Scan(&st); err != nil {
			t.Fatal(err)
		}
		if st != "refunded" {
			t.Errorf("%s escrow is %q after a failed insert with no owner, want refunded", sfx, st)
		}
	}
}

func TestLiveDB_BookCarHireCardDirect_FrozenPricing_ConfigDriftNoMismatch_GarbageRefused(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	req := liveCarHireReq() // 8 hours

	// A hand-built snapshot whose config differs from the live row.
	frozen, _ := json.Marshal(carHireFrozenPricing{
		DurationHours: 8, FareKobo: 900_000 + 8*10_000, DepositKobo: 900_000,
		Config: PricingConfig{BaseFareKobo: 900_000, PerKMKobo: 10_000, MinFareKobo: 900_000},
	})
	want := int64(900_000+8*10_000) + 900_000
	key := "carhireorder:chfz-" + uuid.NewString()
	id, err := svc.BookCarHirePaystackFundedFrozen(ctx, user, req, key, want, frozen)
	if err != nil {
		t.Fatalf("a charge priced from the frozen snapshot must book even though live pricing differs: %v", err)
	}
	var fare, dep int64
	_ = pool.QueryRow(ctx, `SELECT fare_kobo, deposit_kobo FROM car_hire_bookings WHERE id=$1`, id).Scan(&fare, &dep)
	if fare != 980_000 || dep != 900_000 {
		t.Errorf("booked fare=%d deposit=%d, want the frozen 980000/900000", fare, dep)
	}
	// An inconsistent snapshot (its stated fare does not follow from its config) is refused.
	bad, _ := json.Marshal(carHireFrozenPricing{DurationHours: 8, FareKobo: 1, DepositKobo: 1, Config: PricingConfig{BaseFareKobo: 900_000, PerKMKobo: 10_000, MinFareKobo: 900_000}})
	if _, err := svc.BookCarHirePaystackFundedFrozen(ctx, user, req, "carhireorder:chfzb-"+uuid.NewString(), want, bad); err == nil {
		t.Error("an inconsistent snapshot was accepted")
	}
	// Unreadable / zero-priced snapshots are refused, never silently re-priced or zero-booked.
	if _, err := svc.BookCarHirePaystackFundedFrozen(ctx, user, req, "carhireorder:chfzc-"+uuid.NewString(), want, json.RawMessage(`{not json`)); err == nil {
		t.Error("garbage snapshot accepted")
	}
	key0 := "carhireorder:chfz0-" + uuid.NewString()
	_, err = svc.BookCarHirePaystackFundedFrozen(ctx, user, req, key0, 0, json.RawMessage(`{"durationHours":8,"config":{}}`))
	wantCoded(t, err, 409, CodeAmountMismatch)
	if countSettlementsByKey(t, ctx, pool, key0+":fare") != 0 {
		t.Error("a zero charge escrowed")
	}
}

// ── cancel ──────────────────────────────────────────────────────────────────

func TestLiveDB_CarHireCardDirect_CancelConfirmed_RefundsFareAndDepositToCard_NeverWallet(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 10_000_000)
	fake := &chRefunder{svc: svc}
	svc.SetDomainExternalRefunder("carhire", fake)
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	s := carHireSetts(t, ctx, pool, id)
	before := riderWalletBalance(t, ctx, pool, user)

	res, err := svc.CancelCarHireWithRefund(ctx, id, user, "changed_mind")
	if err != nil || res.RefundStatus != RefundStatusRefunded {
		t.Fatalf("cancel: %+v %v", res, err)
	}
	if after := riderWalletBalance(t, ctx, pool, user); after != before {
		t.Errorf("wallet moved cancelling a card hire: %d -> %d (settlement.Refund must never run)", before, after)
	}
	if got := fake.called(); len(got) != 2 || got[0] != s.fareID || got[1] != s.depID {
		t.Errorf("refunder calls %v, want fare then deposit (%s, %s)", got, s.fareID, s.depID)
	}
	if carHireStatus(t, ctx, pool, id) != "cancelled" || settStatus(t, ctx, pool, s.fareID) != "refunded" || settStatus(t, ctx, pool, s.depID) != "refunded" {
		t.Error("booking not cancelled with both settlements refunded")
	}
	// A repeat cancel finishes nothing and refunds nothing more.
	res, err = svc.CancelCarHireWithRefund(ctx, id, user, "again")
	if err != nil || res.RefundStatus != RefundStatusRefunded {
		t.Fatalf("repeat cancel: %+v %v", res, err)
	}
	if len(fake.called()) != 2 {
		t.Errorf("repeat cancel refunded again: %v", fake.called())
	}
	det, _ := svc.CarHireDetail(ctx, id, user)
	if det["refundStatus"] != "refunded" {
		t.Errorf("detail refundStatus=%v", det["refundStatus"])
	}
}

func TestLiveDB_CarHireCardDirect_CancelNoRefunderWired_503NothingFlipped_ThenRetry(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 10_000_000)
	id, _, _, _ := cardCarHire(t, ctx, svc, user) // deliberately no refunder
	s := carHireSetts(t, ctx, pool, id)
	before := riderWalletBalance(t, ctx, pool, user)
	_, err := svc.CancelCarHireWithRefund(ctx, id, user, "x")
	wantCoded(t, err, 503, "refund_unavailable")
	if carHireStatus(t, ctx, pool, id) != "confirmed" || settStatus(t, ctx, pool, s.fareID) != "escrowed" || settStatus(t, ctx, pool, s.depID) != "escrowed" {
		t.Fatal("a cancel that cannot refund must change nothing")
	}
	if after := riderWalletBalance(t, ctx, pool, user); after != before {
		t.Fatalf("wallet credited with no refunder wired: %d -> %d", before, after)
	}
	fake := &chRefunder{svc: svc}
	svc.SetDomainExternalRefunder("carhire", fake)
	if err := svc.CancelCarHire(ctx, id, user, "retry"); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if len(fake.called()) != 2 {
		t.Errorf("calls %v", fake.called())
	}
}

func TestLiveDB_CarHireCardDirect_CancelRetryAfterDepositRefundFailed_FinishesWithoutDoubleRefund(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	s := carHireSetts(t, ctx, pool, id)
	fake := &chRefunder{svc: svc, fail: map[string]error{s.depID: errors.New("gateway down")}}
	svc.SetDomainExternalRefunder("carhire", fake)

	res, err := svc.CancelCarHireWithRefund(ctx, id, user, "x")
	if err != nil {
		t.Fatalf("the booking IS cancelled even when a refund fails: %v", err)
	}
	if res.RefundStatus != RefundStatusPending {
		t.Errorf("refund_status %q, want pending: the customer must not be told the money is back", res.RefundStatus)
	}
	if carHireStatus(t, ctx, pool, id) != "cancelled" || settStatus(t, ctx, pool, s.fareID) != "refunded" || settStatus(t, ctx, pool, s.depID) != "escrowed" {
		t.Fatal("expected cancelled booking, refunded fare, escrowed deposit")
	}
	det, _ := svc.CarHireDetail(ctx, id, user)
	if det["refundStatus"] != "pending" || det["depositStatus"] != "returning" {
		t.Errorf("detail refundStatus=%v depositStatus=%v", det["refundStatus"], det["depositStatus"])
	}
	delete(fake.fail, s.depID)
	res, err = svc.CancelCarHireWithRefund(ctx, id, user, "retry")
	if err != nil || res.RefundStatus != RefundStatusRefunded {
		t.Fatalf("re-POST: %+v %v", res, err)
	}
	calls := fake.called()
	fareCalls := 0
	for _, c := range calls {
		if c == s.fareID {
			fareCalls++
		}
	}
	if fareCalls != 1 {
		t.Errorf("fare refunded %d times (%v): a finished piece must not be refunded again", fareCalls, calls)
	}
	if settStatus(t, ctx, pool, s.depID) != "refunded" {
		t.Error("deposit still escrowed")
	}
}

func TestLiveDB_CarHireCardDirect_CancelWhileActiveOrExtended_Refused409_NothingChanges(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	fake := &chRefunder{svc: svc}
	svc.SetDomainExternalRefunder("carhire", fake)
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	s := carHireSetts(t, ctx, pool, id)
	assignCarHireDriver(t, ctx, pool, id)
	if err := svc.ActivateCarHire(ctx, id, user); err != nil {
		t.Fatal(err)
	}
	for _, st := range []string{"active", "extended"} {
		setCarHireStatus(t, ctx, pool, id, st)
		_, err := svc.CancelCarHireWithRefund(ctx, id, user, "x")
		wantCoded(t, err, 409, "CARD_HIRE_ACTIVE_USE_RETURN")
		if carHireStatus(t, ctx, pool, id) != st || settStatus(t, ctx, pool, s.fareID) != "escrowed" || settStatus(t, ctx, pool, s.depID) != "escrowed" {
			t.Fatalf("%s: a refused cancel changed state", st)
		}
	}
	if len(fake.called()) != 0 {
		t.Errorf("refunder consulted: %v", fake.called())
	}
}

func TestLiveDB_CarHire_WalletFunded_CancelStillRefundsWallet_EvenWhenActive(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited)
	fake := &chRefunder{svc: svc}
	svc.SetDomainExternalRefunder("carhire", fake)
	carHireWalletBalanceAfterBook(t, ctx, svc, pool, user)
	if len(fake.called()) != 0 {
		t.Errorf("the card refunder was consulted for a wallet-funded hire: %v", fake.called())
	}
}

// carHireWalletBalanceAfterBook books on the wallet, activates, cancels and
// asserts the wallet-rail behaviour that must NOT change: full refund to the
// wallet even from active, the external refunder never consulted.
func carHireWalletBalanceAfterBook(t *testing.T, ctx context.Context, svc *Service, pool *pgxpool.Pool, user string) int64 {
	t.Helper()
	before := riderWalletBalance(t, ctx, pool, user)
	b, err := svc.BookCarHire(ctx, user, liveCarHireReq(), "ch-wal-"+uuid.NewString())
	if err != nil {
		t.Fatalf("wallet BookCarHire (Tier 3): %v", err)
	}
	id := b["id"].(string)
	if b["fundingRail"] != "wallet" || b["depositStatus"] != "held" {
		t.Errorf("wallet detail fundingRail=%v depositStatus=%v", b["fundingRail"], b["depositStatus"])
	}
	afterBook := riderWalletBalance(t, ctx, pool, user)
	if err := svc.ActivateCarHire(ctx, id, user); err != nil {
		t.Fatal(err)
	}
	res, err := svc.CancelCarHireWithRefund(ctx, id, user, "x")
	if err != nil || res.RefundStatus != RefundStatusRefunded {
		t.Fatalf("wallet cancel from active (historical behaviour): %+v %v", res, err)
	}
	if got := riderWalletBalance(t, ctx, pool, user); got != before {
		t.Errorf("wallet after cancel = %d, want the pre-book %d (book moved it to %d)", got, before, afterBook)
	}
	return before
}

// ── complete ────────────────────────────────────────────────────────────────

func TestLiveDB_CarHireCardDirect_CompleteSettlesFare_RefundsFullDepositToCard(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 10_000_000)
	fake := &chRefunder{svc: svc}
	svc.SetDomainExternalRefunder("carhire", fake)
	id, _, fare, _ := cardCarHire(t, ctx, svc, user)
	s := carHireSetts(t, ctx, pool, id)
	driverUser := assignCarHireDriver(t, ctx, pool, id)
	if err := svc.ActivateCarHire(ctx, id, user); err != nil {
		t.Fatal(err)
	}
	before := riderWalletBalance(t, ctx, pool, user)

	res, err := svc.CompleteCarHireWithRefund(ctx, id, user)
	if err != nil || res.DepositRefundStatus != RefundStatusRefunded {
		t.Fatalf("complete: %+v %v", res, err)
	}
	if after := riderWalletBalance(t, ctx, pool, user); after != before {
		t.Errorf("renter wallet moved on a card hire completion: %d -> %d", before, after)
	}
	if got := fake.called(); len(got) != 1 || got[0] != s.depID {
		t.Errorf("refunder calls %v, want exactly the DEPOSIT settlement %s", got, s.depID)
	}
	if settStatus(t, ctx, pool, s.fareID) != "settled" || settStatus(t, ctx, pool, s.depID) != "refunded" || carHireStatus(t, ctx, pool, id) != "completed" {
		t.Errorf("fare=%s deposit=%s booking=%s", settStatus(t, ctx, pool, s.fareID), settStatus(t, ctx, pool, s.depID), carHireStatus(t, ctx, pool, id))
	}
	if got := riderWalletBalance(t, ctx, pool, driverUser); got <= 0 || got > fare {
		t.Errorf("driver credited %d of a %d fare", got, fare)
	}
	// Re-POST of complete on the completed card booking is a safe no-op.
	res, err = svc.CompleteCarHireWithRefund(ctx, id, user)
	if err != nil || res.DepositRefundStatus != RefundStatusRefunded {
		t.Fatalf("re-POST: %+v %v", res, err)
	}
	if len(fake.called()) != 1 {
		t.Errorf("re-POST refunded again: %v", fake.called())
	}
	det, _ := svc.CarHireDetail(ctx, id, user)
	if det["depositStatus"] != "returned" {
		t.Errorf("depositStatus=%v", det["depositStatus"])
	}
}

func TestLiveDB_CarHireCardDirect_CompleteRetryAfterDepositFailure_FinishesRefund(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	s := carHireSetts(t, ctx, pool, id)
	assignCarHireDriver(t, ctx, pool, id)
	if err := svc.ActivateCarHire(ctx, id, user); err != nil {
		t.Fatal(err)
	}
	fake := &chRefunder{svc: svc, fail: map[string]error{s.depID: errors.New("gateway down")}}
	svc.SetDomainExternalRefunder("carhire", fake)

	res, err := svc.CompleteCarHireWithRefund(ctx, id, user)
	if err != nil {
		t.Fatalf("the hire IS completed; the deposit refund is reported, not returned as an error: %v", err)
	}
	if res.DepositRefundStatus != RefundStatusPending {
		t.Errorf("deposit_refund_status %q, want pending (never claim the deposit is back)", res.DepositRefundStatus)
	}
	if carHireStatus(t, ctx, pool, id) != "completed" || settStatus(t, ctx, pool, s.fareID) != "settled" || settStatus(t, ctx, pool, s.depID) != "escrowed" {
		t.Fatal("expected completed booking, settled fare, escrowed deposit")
	}
	det, _ := svc.CarHireDetail(ctx, id, user)
	if det["depositStatus"] != "returning" {
		t.Errorf("depositStatus=%v, want returning", det["depositStatus"])
	}
	delete(fake.fail, s.depID)
	res, err = svc.CompleteCarHireWithRefund(ctx, id, user)
	if err != nil || res.DepositRefundStatus != RefundStatusRefunded {
		t.Fatalf("re-POST: %+v %v", res, err)
	}
	if settStatus(t, ctx, pool, s.depID) != "refunded" || settStatus(t, ctx, pool, s.fareID) != "settled" {
		t.Error("deposit not refunded / fare disturbed")
	}
}

func TestLiveDB_CarHireCardDirect_CompleteNoDriver_Refused409_NothingChanges(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	fake := &chRefunder{svc: svc}
	svc.SetDomainExternalRefunder("carhire", fake)
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	s := carHireSetts(t, ctx, pool, id)
	setCarHireStatus(t, ctx, pool, id, "active") // (ActivateCarHire itself refuses a driverless card booking)
	_, err := svc.CompleteCarHireWithRefund(ctx, id, user)
	wantCoded(t, err, 409, "CARD_HIRE_NO_DRIVER")
	if carHireStatus(t, ctx, pool, id) != "active" || settStatus(t, ctx, pool, s.fareID) != "escrowed" || settStatus(t, ctx, pool, s.depID) != "escrowed" || len(fake.called()) != 0 {
		t.Fatal("a refused completion changed state")
	}
}

func TestLiveDB_CarHireCardDirect_ConcurrentCompleteAndCancel_ExactlyOneMoneyOutcome(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	fake := &chRefunder{svc: svc}
	svc.SetDomainExternalRefunder("carhire", fake)
	for i := 0; i < 6; i++ {
		id, _, _, _ := cardCarHire(t, ctx, svc, user)
		s := carHireSetts(t, ctx, pool, id)
		assignCarHireDriver(t, ctx, pool, id)
		var wg sync.WaitGroup
		wg.Add(2)
		// A: the renter starts the hire and ends it; B: the renter cancels. Activation and
		// cancel both CAS from 'confirmed' — exactly one wins.
		go func() {
			defer wg.Done()
			if svc.ActivateCarHire(ctx, id, user) == nil {
				_, _ = svc.CompleteCarHireWithRefund(ctx, id, user)
			}
		}()
		go func() { defer wg.Done(); _, _ = svc.CancelCarHireWithRefund(ctx, id, user, "race") }()
		wg.Wait()
		// converge any stranded half through the same retry paths
		_, _ = svc.CompleteCarHireWithRefund(ctx, id, user)
		_, _ = svc.CancelCarHireWithRefund(ctx, id, user, "race-retry")

		status := carHireStatus(t, ctx, pool, id)
		fareSt, depSt := settStatus(t, ctx, pool, s.fareID), settStatus(t, ctx, pool, s.depID)
		switch status {
		case "completed":
			if fareSt != "settled" || depSt != "refunded" {
				t.Fatalf("iter %d: completed but fare=%s deposit=%s", i, fareSt, depSt)
			}
		case "cancelled":
			if fareSt != "refunded" || depSt != "refunded" {
				t.Fatalf("iter %d: cancelled but fare=%s deposit=%s", i, fareSt, depSt)
			}
		default:
			t.Fatalf("iter %d: status %s", i, status)
		}
	}
}

// ── extend ──────────────────────────────────────────────────────────────────

func TestLiveDB_CarHireCardDirect_ExtendRefused_NoWalletDebit(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited) // even a funded Tier-3 wallet must not be debited
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	assignCarHireDriver(t, ctx, pool, id)
	if err := svc.ActivateCarHire(ctx, id, user); err != nil {
		t.Fatal(err)
	}
	before := riderWalletBalance(t, ctx, pool, user)
	_, err := svc.ExtendCarHire(ctx, id, user, 2, "ch-ext-"+uuid.NewString())
	wantCoded(t, err, 409, "EXTENSION_NOT_AVAILABLE_FOR_CARD")
	if after := riderWalletBalance(t, ctx, pool, user); after != before {
		t.Fatalf("wallet debited by a refused extension: %d -> %d", before, after)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM settlements WHERE reference LIKE $1`, "carhire:"+id+":ext:%").Scan(&n)
	if n != 0 || carHireStatus(t, ctx, pool, id) != "active" {
		t.Errorf("extension settlements=%d status=%s", n, carHireStatus(t, ctx, pool, id))
	}
}

// ── wallet rail unchanged ───────────────────────────────────────────────────

func TestLiveDB_WalletCarHire_Unchanged_BookExtendCompleteCancel(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited)
	fake := &chRefunder{svc: svc}
	svc.SetDomainExternalRefunder("carhire", fake)
	driverUser := ""

	// cancel from active still refunds the wallet in full (historical behaviour)
	carHireWalletBalanceAfterBook(t, ctx, svc, pool, user)

	// book → extend (wallet) → complete: driver paid, deposit back to the WALLET
	b, err := svc.BookCarHire(ctx, user, liveCarHireReq(), "ch-wal2-"+uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	id := b["id"].(string)
	driverUser = assignCarHireDriver(t, ctx, pool, id)
	if err := svc.ActivateCarHire(ctx, id, user); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ExtendCarHire(ctx, id, user, 2, "ch-wext-"+uuid.NewString()); err != nil {
		t.Fatalf("wallet extend: %v", err)
	}
	beforeComplete := riderWalletBalance(t, ctx, pool, user)
	var dep int64
	_ = pool.QueryRow(ctx, `SELECT deposit_kobo FROM car_hire_bookings WHERE id=$1`, id).Scan(&dep)
	if err := svc.CompleteCarHire(ctx, id, user); err != nil {
		t.Fatalf("wallet complete: %v", err)
	}
	if got := riderWalletBalance(t, ctx, pool, user); got != beforeComplete+dep {
		t.Errorf("deposit back to the wallet: balance %d, want %d", got, beforeComplete+dep)
	}
	if riderWalletBalance(t, ctx, pool, driverUser) <= 0 {
		t.Error("driver not paid on a wallet completion")
	}
	if len(fake.called()) != 0 {
		t.Errorf("the card refunder was consulted for a wallet-funded hire: %v", fake.called())
	}
	// A wallet hire's status is still a 409 on a re-POST of complete (historical).
	wantCoded(t, svc.CompleteCarHire(ctx, id, user), 409, CodeInvalidState)
}

func TestLiveDB_WalletBookCarHire_RejectsReservedPrefixAndBadHireType(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited)
	for _, k := range []string{"carhireorder:abc12345", "CARHIREORDER:abc12345", "parcelorder:abc12345"} {
		_, err := svc.BookCarHire(ctx, user, liveCarHireReq(), k)
		wantCoded(t, err, 400, "INVALID_IDEMPOTENCY_KEY")
		// body-key fallback too
		r := liveCarHireReq()
		r.IdempotencyKey = k
		_, err = svc.BookCarHire(ctx, user, r, "")
		wantCoded(t, err, 400, "INVALID_IDEMPOTENCY_KEY")
	}
	before := riderWalletBalance(t, ctx, pool, user)
	bad := liveCarHireReq()
	bad.HireType = "weekly" // would fail the car_hire_bookings CHECK AFTER the wallet escrow
	if _, err := svc.BookCarHire(ctx, user, bad, "ch-bad-"+uuid.NewString()); err == nil {
		t.Fatal("bad hire_type accepted")
	}
	if after := riderWalletBalance(t, ctx, pool, user); after != before {
		t.Errorf("wallet debited for an unbookable hire: %d -> %d", before, after)
	}
}

// ── admin guard ─────────────────────────────────────────────────────────────

func TestLiveDB_AdminPatchCarHire_CardEscrowed_RefusesMoneyMovingStatuses_BothSettlements(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	admin := NewAdminService(svc)
	adminID := uuid.NewString()
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	s := carHireSetts(t, ctx, pool, id)

	for _, st := range []string{"cancelled", "completed", "disputed", "failed"} {
		err := admin.PatchCarHireStatus(ctx, adminID, id, ModeStatusPatchRequest{Status: st, Reason: "ops"})
		wantCoded(t, err, 409, CodeInvalidState)
		if !strings.Contains(err.Error(), "refund") {
			t.Errorf("%s: message %q must point at the cancel flow / runbook", st, err.Error())
		}
		if carHireStatus(t, ctx, pool, id) != "confirmed" {
			t.Fatalf("status flipped to %q despite the refusal", carHireStatus(t, ctx, pool, id))
		}
	}
	// Only the DEPOSIT held (fare already refunded) is still enough to refuse.
	if err := svc.settlement.RefundExternal(ctx, s.fareID, "test"); err != nil {
		t.Fatal(err)
	}
	wantCoded(t, admin.PatchCarHireStatus(ctx, adminID, id, ModeStatusPatchRequest{Status: "cancelled"}), 409, CodeInvalidState)
	// Non-money transitions are untouched.
	if err := admin.PatchCarHireStatus(ctx, adminID, id, ModeStatusPatchRequest{Status: "active", Reason: "ops"}); err != nil {
		t.Errorf("non-money transition refused: %v", err)
	}
	// Once nothing external is escrowed the patch is allowed again.
	if err := svc.settlement.RefundExternal(ctx, s.depID, "test"); err != nil {
		t.Fatal(err)
	}
	if err := admin.PatchCarHireStatus(ctx, adminID, id, ModeStatusPatchRequest{Status: "cancelled", Reason: "tidy"}); err != nil {
		t.Errorf("patch after both settlements refunded: %v", err)
	}
	// WALLET-funded behaviour unchanged.
	svc2, _, user2 := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user2, testsupport.KycTierUnlimited)
	wb, err := svc2.BookCarHire(ctx, user2, liveCarHireReq(), "ch-adm-"+uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	if err := NewAdminService(svc2).PatchCarHireStatus(ctx, adminID, wb["id"].(string), ModeStatusPatchRequest{Status: "cancelled"}); err != nil {
		t.Errorf("wallet-funded patch must still work: %v", err)
	}
}

// ── reconcile hook ──────────────────────────────────────────────────────────

func TestLiveDB_SweepCarHire_CancelledAndCompleted_FinishesStrandedCardRefunds_OnlyThose(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited)

	// (a) cancelled card booking whose refunds both failed
	idA, _, _, _ := cardCarHire(t, ctx, svc, user)
	sA := carHireSetts(t, ctx, pool, idA)
	failAll := &chRefunder{svc: svc, fail: map[string]error{sA.fareID: errors.New("down"), sA.depID: errors.New("down")}}
	svc.SetDomainExternalRefunder("carhire", failAll)
	if res, err := svc.CancelCarHireWithRefund(ctx, idA, user, "x"); err != nil || res.RefundStatus != RefundStatusPending {
		t.Fatalf("cancel A: %+v %v", res, err)
	}
	// (b) completed card booking whose deposit refund failed
	idB, _, _, _ := cardCarHire(t, ctx, svc, user)
	sB := carHireSetts(t, ctx, pool, idB)
	assignCarHireDriver(t, ctx, pool, idB)
	if err := svc.ActivateCarHire(ctx, idB, user); err != nil {
		t.Fatal(err)
	}
	failAll.fail[sB.depID] = errors.New("down")
	if res, err := svc.CompleteCarHireWithRefund(ctx, idB, user); err != nil || res.DepositRefundStatus != RefundStatusPending {
		t.Fatalf("complete B: %+v %v", res, err)
	}
	// (c) a healthy confirmed card booking and a wallet booking must be untouched
	idC, _, _, _ := cardCarHire(t, ctx, svc, user)
	sC := carHireSetts(t, ctx, pool, idC)
	wb, err := svc.BookCarHire(ctx, user, liveCarHireReq(), "ch-sw-"+uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	wid := wb["id"].(string)
	_, _ = pool.Exec(ctx, `UPDATE car_hire_bookings SET status='cancelled' WHERE id=$1`, wid) // stranded WALLET row: not the sweep's business

	good := &chRefunder{svc: svc}
	svc.SetDomainExternalRefunder("carhire", good)
	if res, err := svc.SweepCancelledCardRefunds(ctx, RefundDomainCarHire, 1<<40, 100); err != nil || res.Completed != 0 {
		t.Fatalf("minAge guard: %+v %v (a refund still in flight must not be raced)", res, err)
	}
	res, err := svc.SweepCancelledCardRefunds(ctx, RefundDomainCarHire, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if res.Completed < 2 {
		t.Errorf("sweep result %+v, want at least the 2 stranded card bookings", res)
	}
	if settStatus(t, ctx, pool, sA.fareID) != "refunded" || settStatus(t, ctx, pool, sA.depID) != "refunded" {
		t.Error("cancelled booking's refunds not finished by the sweep")
	}
	if settStatus(t, ctx, pool, sB.depID) != "refunded" || settStatus(t, ctx, pool, sB.fareID) != "settled" {
		t.Errorf("completed booking: fare=%s deposit=%s", settStatus(t, ctx, pool, sB.fareID), settStatus(t, ctx, pool, sB.depID))
	}
	if settStatus(t, ctx, pool, sC.fareID) != "escrowed" || settStatus(t, ctx, pool, sC.depID) != "escrowed" {
		t.Error("the sweep touched a live confirmed booking")
	}
	for _, c := range good.called() {
		if c == sC.fareID || c == sC.depID {
			t.Errorf("sweep refunded the live booking's settlement %s", c)
		}
	}
	// idempotent: a second sweep refunds nothing more
	n := len(good.called())
	if _, err := svc.SweepCancelledCardRefunds(ctx, RefundDomainCarHire, 0, 100); err != nil {
		t.Fatal(err)
	}
	if len(good.called()) != n {
		t.Errorf("second sweep called the refunder again: %v", good.called()[n:])
	}
}

// ── third ledger audit ──────────────────────────────────────────────────────

// seedPieceRow files an intent + a piece-refund row for a settlement, as the engine
// does when it starts refunding that settlement to the card.
func seedPieceRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, payer, bookingID, settlementID, pieceStatus string) {
	t.Helper()
	ref := "carhireorder:piece-" + uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO public.transport_paystack_intents
		(reference, domain, payer_id, request_json, amount_kobo, idempotency_key, status, entity_id)
		VALUES ($1,'carhire',$2,'{}',1064000,$3,'confirmed',$4)`, ref, payer, ref[len("carhireorder:"):], bookingID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM public.transport_paystack_intent_refunds WHERE reference=$1`, ref)
		_, _ = pool.Exec(c, `DELETE FROM public.transport_paystack_intents WHERE reference=$1`, ref)
	})
	if _, err := pool.Exec(ctx, `INSERT INTO public.transport_paystack_intent_refunds
		(reference, refund_key, settlement_id, amount_kobo, status, claim_gen) VALUES ($1,$2,$2,100,$3,1)`, ref, settlementID, pieceStatus); err != nil {
		t.Fatal(err)
	}
}

func TestLiveDB_CarHireCardDirect_Activate_NoDriver_Refused409_WalletUnaffected(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited)
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	wantCoded(t, svc.ActivateCarHire(ctx, id, user), 409, "CARD_HIRE_NO_DRIVER")
	if carHireStatus(t, ctx, pool, id) != "confirmed" {
		t.Fatal("a refused activation changed the status")
	}
	assignCarHireDriver(t, ctx, pool, id)
	if err := svc.ActivateCarHire(ctx, id, user); err != nil {
		t.Fatalf("with a driver the card hire activates: %v", err)
	}
	// wallet bookings keep activating without a driver (historical)
	wb, err := svc.BookCarHire(ctx, user, liveCarHireReq(), "ch-act-"+uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ActivateCarHire(ctx, wb["id"].(string), user); err != nil {
		t.Errorf("wallet activation changed: %v", err)
	}
}

func TestLiveDB_CarHireCardDirect_CompleteFromConfirmed_Refused409(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	fake := &chRefunder{svc: svc}
	svc.SetDomainExternalRefunder("carhire", fake)
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	s := carHireSetts(t, ctx, pool, id)
	assignCarHireDriver(t, ctx, pool, id)
	_, err := svc.CompleteCarHireWithRefund(ctx, id, user)
	wantCoded(t, err, 409, CodeInvalidState)
	if carHireStatus(t, ctx, pool, id) != "confirmed" || settStatus(t, ctx, pool, s.fareID) != "escrowed" || len(fake.called()) != 0 {
		t.Fatal("a refused completion changed state: a hire that never started must be cancelled, not completed")
	}
}

func TestLiveDB_CarHireCardDirect_CancelAfterStartAt_Refused409_CardHireStarted(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	fake := &chRefunder{svc: svc}
	svc.SetDomainExternalRefunder("carhire", fake)
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	s := carHireSetts(t, ctx, pool, id)
	if _, err := pool.Exec(ctx, `UPDATE car_hire_bookings SET start_at = now() - interval '1 hour' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	_, err := svc.CancelCarHireWithRefund(ctx, id, user, "x")
	wantCoded(t, err, 409, "CARD_HIRE_STARTED")
	if !strings.Contains(strings.ToLower(err.Error()), "support") {
		t.Errorf("message %q must point at support", err.Error())
	}
	if carHireStatus(t, ctx, pool, id) != "confirmed" || settStatus(t, ctx, pool, s.fareID) != "escrowed" || len(fake.called()) != 0 {
		t.Fatal("a refused cancel changed state")
	}
	// Before start_at it still works.
	if _, err := pool.Exec(ctx, `UPDATE car_hire_bookings SET start_at = now() + interval '1 hour' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CancelCarHireWithRefund(ctx, id, user, "x"); err != nil {
		t.Fatalf("cancel before start_at: %v", err)
	}
}

func TestLiveDB_SweepCarHire_CompletedWithFareStillEscrowed_FinishesTheFarePayout(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	svc.SetDomainExternalRefunder("carhire", &chRefunder{svc: svc})
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	s := carHireSetts(t, ctx, pool, id)
	assignCarHireDriver(t, ctx, pool, id)
	// The state a crashed completion leaves: status flipped, deposit already back on
	// the card, FARE still escrowed (the Settle never ran).
	setCarHireStatus(t, ctx, pool, id, "completed")
	if err := svc.settlement.RefundExternal(ctx, s.depID, "test"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SweepCancelledCardRefunds(ctx, RefundDomainCarHire, 0, 100); err != nil {
		t.Fatal(err)
	}
	if got := settStatus(t, ctx, pool, s.fareID); got != "settled" {
		t.Fatalf("fare is %q: the sweeper must also finish a completed booking whose FARE is still escrowed (money held for nobody)", got)
	}
}

func TestLiveDB_CarHireCardDirect_Complete_RefusesToSettleAFareThatHasAPieceRow(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	fake := &chRefunder{svc: svc}
	svc.SetDomainExternalRefunder("carhire", fake)
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	s := carHireSetts(t, ctx, pool, id)
	assignCarHireDriver(t, ctx, pool, id)
	if err := svc.ActivateCarHire(ctx, id, user); err != nil {
		t.Fatal(err)
	}
	// The engine has begun refunding the FARE to the card (a gateway refund may be in flight).
	seedPieceRow(t, ctx, pool, user, id, s.fareID, "refunding")
	_, err := svc.CompleteCarHireWithRefund(ctx, id, user)
	if err == nil {
		t.Fatal("completing must report that the fare payout was refused")
	}
	if got := settStatus(t, ctx, pool, s.fareID); got != "escrowed" {
		t.Fatalf("fare is %q: Settle must never run on a settlement the card-refund engine is refunding (the customer would be paid back AND the driver paid)", got)
	}
}

func TestLiveDB_CarHireCardDirect_DisputedFare_IsNotRefundedByCustomerCancelOrSweep(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	fake := &chRefunder{svc: svc}
	svc.SetDomainExternalRefunder("carhire", fake)
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	s := carHireSetts(t, ctx, pool, id)
	if _, err := pool.Exec(ctx, `UPDATE settlements SET status='disputed' WHERE id=$1`, s.fareID); err != nil {
		t.Fatal(err)
	}
	res, err := svc.CancelCarHireWithRefund(ctx, id, user, "x")
	if err != nil {
		t.Fatal(err)
	}
	if res.RefundStatus != RefundStatusPending {
		t.Errorf("refund_status %q: a disputed fare is NOT refunded, so the customer is not told the money is back", res.RefundStatus)
	}
	if settStatus(t, ctx, pool, s.fareID) != "disputed" || settStatus(t, ctx, pool, s.depID) != "refunded" {
		t.Errorf("fare=%s deposit=%s: a disputed settlement is for admin paths only", settStatus(t, ctx, pool, s.fareID), settStatus(t, ctx, pool, s.depID))
	}
	if _, err := svc.SweepCancelledCardRefunds(ctx, RefundDomainCarHire, 0, 100); err != nil {
		t.Fatal(err)
	}
	for _, c := range fake.called() {
		if c == s.fareID {
			t.Fatalf("the customer cancel / sweeper refunded a DISPUTED fare")
		}
	}
	if _, err := svc.CancelCarHireWithRefund(ctx, id, user, "again"); err != nil {
		t.Fatal(err)
	}
	if settStatus(t, ctx, pool, s.fareID) != "disputed" {
		t.Error("re-POSTed cancel refunded a disputed fare")
	}
}

func TestLiveDB_ExtendCarHire_RejectsReservedPrefixKey(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited)
	b, err := svc.BookCarHire(ctx, user, liveCarHireReq(), "ch-ext-rp-"+uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	id := b["id"].(string)
	if err := svc.ActivateCarHire(ctx, id, user); err != nil {
		t.Fatal(err)
	}
	before := riderWalletBalance(t, ctx, pool, user)
	for _, k := range []string{"carhireorder:abcdefgh", "PARCELORDER:abcdefgh"} {
		_, err := svc.ExtendCarHire(ctx, id, user, 2, k)
		wantCoded(t, err, 400, "INVALID_IDEMPOTENCY_KEY")
	}
	if after := riderWalletBalance(t, ctx, pool, user); after != before {
		t.Errorf("wallet moved: %d -> %d", before, after)
	}
}

func TestLiveDB_CarHireCardDirect_RefundLegsLeaveAnAuditTrail(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	svc.SetDomainExternalRefunder("carhire", &chRefunder{svc: svc})
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	if _, err := svc.CancelCarHireWithRefund(ctx, id, user, "x"); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM transport_audit_log WHERE action='carhire.refund_leg' AND entity_id=$1`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Errorf("%d refund-leg audit events for a two-leg card refund, want 2", n)
	}
}

// ── M4: admin patch ─────────────────────────────────────────────────────────

func TestLiveDB_AdminPatchCarHire_CardFunded_RefusesAnyPatchOutOfCancelledOrCompleted(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	svc.SetDomainExternalRefunder("carhire", &chRefunder{svc: svc})
	admin := NewAdminService(svc)
	adminID := uuid.NewString()

	// cancelled card booking, both settlements refunded (the patch used to be allowed now)
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	if _, err := svc.CancelCarHireWithRefund(ctx, id, user, "x"); err != nil {
		t.Fatal(err)
	}
	for _, to := range []string{"confirmed", "active", "extended", "quoted"} {
		wantCoded(t, admin.PatchCarHireStatus(ctx, adminID, id, ModeStatusPatchRequest{Status: to, Reason: "ops"}), 409, CodeInvalidState)
	}
	if carHireStatus(t, ctx, pool, id) != "cancelled" {
		t.Fatal("a cancelled card booking was reopened by an admin patch (it could then be re-activated/completed over refunded money)")
	}
	// completed card booking: same
	id2, _, _, _ := cardCarHire(t, ctx, svc, user)
	setCarHireStatus(t, ctx, pool, id2, "completed")
	wantCoded(t, admin.PatchCarHireStatus(ctx, adminID, id2, ModeStatusPatchRequest{Status: "active", Reason: "ops"}), 409, CodeInvalidState)

	// WALLET-funded booking: re-opening stays allowed (historical)
	svc2, _, user2 := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user2, testsupport.KycTierUnlimited)
	wb, err := svc2.BookCarHire(ctx, user2, liveCarHireReq(), "ch-admr-"+uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	wid := wb["id"].(string)
	setCarHireStatus(t, ctx, pool, wid, "cancelled")
	if err := NewAdminService(svc2).PatchCarHireStatus(ctx, adminID, wid, ModeStatusPatchRequest{Status: "confirmed"}); err != nil {
		t.Errorf("wallet-funded patch must still work: %v", err)
	}
}

func TestLiveDB_AdminPatchCarHire_RefusesMoneyMovingPatchWhileAPieceRefundIsInFlight(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	admin := NewAdminService(svc)
	id, _, _, _ := cardCarHire(t, ctx, svc, user)
	s := carHireSetts(t, ctx, pool, id)
	// Both settlements are (as far as the settlement table knows) refunded, but a piece
	// refund of the deposit is still 'refunding' at the gateway.
	if err := svc.settlement.RefundExternal(ctx, s.fareID, "t"); err != nil {
		t.Fatal(err)
	}
	if err := svc.settlement.RefundExternal(ctx, s.depID, "t"); err != nil {
		t.Fatal(err)
	}
	seedPieceRow(t, ctx, pool, user, id, s.depID, "refunding")
	wantCoded(t, admin.PatchCarHireStatus(ctx, uuid.NewString(), id, ModeStatusPatchRequest{Status: "cancelled"}), 409, CodeInvalidState)
}

func TestLiveDB_AdminPatch_IsACompareAndSwap_ARacingWriterIsNotOverwritten(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited)
	admin := NewAdminService(svc)
	b, err := svc.BookCarHire(ctx, user, liveCarHireReq(), "ch-cas-"+uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	id := b["id"].(string) // confirmed, wallet-funded
	// A customer action holds the row and moves it on while the admin patch is waiting.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var st string
	if err := tx.QueryRow(ctx, `SELECT status FROM car_hire_bookings WHERE id=$1 FOR UPDATE`, id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		done <- admin.PatchCarHireStatus(ctx, uuid.NewString(), id, ModeStatusPatchRequest{Status: "quoted", Reason: "ops"})
	}()
	time.Sleep(400 * time.Millisecond) // the patch has read 'confirmed' and is blocked on the UPDATE
	if _, err := tx.Exec(ctx, `UPDATE car_hire_bookings SET status='active' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	wantCoded(t, <-done, 409, CodeInvalidState)
	if got := carHireStatus(t, ctx, pool, id); got != "active" {
		t.Fatalf("status %q: the admin patch overwrote a concurrent change (its UPDATE must be WHERE status=<the status it read>)", got)
	}
}
