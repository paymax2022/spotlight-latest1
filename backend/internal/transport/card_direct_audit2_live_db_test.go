package transport

// LIVE-DB (TEST_DATABASE_URL) tests for the SECOND ledger-audit round of the
// Mobility card-direct work (ADR-PR522-mobility-card-direct, "Resolved after
// ledger audit — round 2"). Each test was written and watched failing before
// the fix:
//
//	H-A  wallet bookTowing: validate BEFORE any escrow; a post-escrow INSERT
//	     failure reverses the escrow to the wallet
//	M1   admin status patch refuses money-moving transitions on card-funded escrow
//	M2   cancel fails closed with no refunder, reports refund_status, and the
//	     sweep drives a cancelled-but-still-escrowed card refund
//	M3   movers: one open checkout per job
//	L-b  cancel reason capped; L-c re-cancel handles a disputed settlement;
//	L-d  negative route distance clamped; zero fare refused

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

// ── helpers ─────────────────────────────────────────────────────────────────

// reversingRefunder is a stand-in for the engine refunder that does what the
// real one does after the gateway accepts: reverse the escrow ledger-side.
func reversingRefunder(svc *Service) *fakeMoverRefunder {
	return &fakeMoverRefunder{reverse: func(ctx context.Context, id string) error {
		return svc.settlement.RefundExternal(ctx, id, "test")
	}}
}

func cardFundedTow(t *testing.T, ctx context.Context, svc *Service, user string) string {
	t.Helper()
	req := liveTowingReq()
	quoted, err := svc.QuoteTowingBooking(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	id, err := svc.BookTowingPaystackFunded(ctx, user, req, "towingorder:a2-"+uuid.NewString(), quoted)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func cardFundedParcel(t *testing.T, ctx context.Context, svc *Service, user string) string {
	t.Helper()
	req := parcelReq()
	quoted, err := svc.QuoteParcelBooking(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	id, err := svc.BookParcelPaystackFunded(ctx, user, req, "parcelorder:a2-"+uuid.NewString(), quoted)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func settlementStatusByID(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

func towingStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(ctx, `SELECT status FROM towing_jobs WHERE id=$1`, id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

// ── H-A ─────────────────────────────────────────────────────────────────────

func TestLiveDB_BookTowing_Wallet_RefusesUnbookableRequestBeforeAnyDebit(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited)

	bad := map[string]func(*TowingBookRequest){
		"wheel_lift":      func(r *TowingBookRequest) { r.ServiceType = "wheel_lift" },
		"heavy_duty":      func(r *TowingBookRequest) { r.ServiceType = "heavy_duty" },
		"roadside":        func(r *TowingBookRequest) { r.ServiceType = "roadside" },
		"empty pickup":    func(r *TowingBookRequest) { r.Pickup.Address = "" },
		"tow w/o dest":    func(r *TowingBookRequest) { r.Dest = nil },
		"null island":     func(r *TowingBookRequest) { r.Pickup.Lat, r.Pickup.Lng = 0, 0 },
		"out-of-range":    func(r *TowingBookRequest) { r.Pickup.Lat = 91 },
		"unknown service": func(r *TowingBookRequest) { r.ServiceType = "teleport" },
	}
	for name, mut := range bad {
		t.Run(name, func(t *testing.T) {
			req := liveTowingReq()
			mut(&req)
			key := "pftow-ha-" + uuid.NewString()
			before := riderWalletBalance(t, ctx, pool, user)
			_, err := svc.BookTowing(ctx, user, req, key)
			wantCoded(t, err, 400, "invalid_input")
			if after := riderWalletBalance(t, ctx, pool, user); after != before {
				t.Errorf("wallet moved on a request the booking cannot satisfy: %d -> %d", before, after)
			}
			if n := countSettlementsByKey(t, ctx, pool, key); n != 0 {
				t.Errorf("%d settlement(s) written for a refused request", n)
			}
			if n := countTowingByKey(t, ctx, pool, key); n != 0 {
				t.Errorf("%d job(s) written for a refused request", n)
			}
		})
	}
}

// failTowingInsertTrigger makes the INSERT of a towing job whose pickup address
// equals marker fail (a real SQL-level insert failure after the escrow posted).
func failTowingInsertTrigger(t *testing.T, ctx context.Context, pool *pgxpool.Pool, marker string) {
	t.Helper()
	fn := "t_fail_towing_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	mustExec := func(sql string) {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	mustExec(fmt.Sprintf(`CREATE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
		IF NEW.pickup_address = '%s' THEN RAISE EXCEPTION 'forced towing insert failure'; END IF; RETURN NEW; END $f$`, fn, marker))
	mustExec(fmt.Sprintf(`CREATE TRIGGER %s BEFORE INSERT ON towing_jobs FOR EACH ROW EXECUTE FUNCTION %s()`, fn, fn))
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), fmt.Sprintf(`DROP TRIGGER IF EXISTS %s ON towing_jobs`, fn))
		_, _ = pool.Exec(context.Background(), fmt.Sprintf(`DROP FUNCTION IF EXISTS %s()`, fn))
	})
}

func TestLiveDB_BookTowing_Wallet_InsertFailureAfterEscrow_ReversesEscrowToTheWallet(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited)
	marker := "FORCE-FAIL-" + uuid.NewString()
	failTowingInsertTrigger(t, ctx, pool, marker)

	req := liveTowingReq()
	req.Pickup.Address = marker
	key := "pftow-ha-ins-" + uuid.NewString()
	before := riderWalletBalance(t, ctx, pool, user)
	if _, err := svc.BookTowing(ctx, user, req, key); err == nil {
		t.Fatal("the forced insert failure must surface")
	}
	if after := riderWalletBalance(t, ctx, pool, user); after != before {
		t.Fatalf("wallet %d -> %d: the escrowed fare was left orphaned instead of refunded", before, after)
	}
	var st string
	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE idempotency_key=$1`, key).Scan(&st); err != nil {
		t.Fatal(err)
	}
	if st != "refunded" {
		t.Errorf("orphan escrow status %q, want refunded", st)
	}
	if n := countTowingByKey(t, ctx, pool, key); n != 0 {
		t.Errorf("%d job rows exist", n)
	}
}

// ── M2: refund_status + fail closed ─────────────────────────────────────────

func TestLiveDB_CancelRefundStatus_ReportsWhatActuallyHappened(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited)

	t.Run("card refund succeeds", func(t *testing.T) {
		svc.SetDomainExternalRefunder("towing", reversingRefunder(svc))
		res, err := svc.CancelTowingWithRefund(ctx, cardFundedTow(t, ctx, svc, user), user, "x")
		if err != nil || res.RefundStatus != RefundStatusRefunded {
			t.Fatalf("res=%+v err=%v, want refunded", res, err)
		}
	})
	t.Run("card refund fails after the flip: pending, retryable", func(t *testing.T) {
		fake := &fakeMoverRefunder{err: errors.New("gateway down")}
		svc.SetDomainExternalRefunder("towing", fake)
		id := cardFundedTow(t, ctx, svc, user)
		res, err := svc.CancelTowingWithRefund(ctx, id, user, "x")
		if err != nil {
			t.Fatalf("the job IS cancelled; the refund is retried: %v", err)
		}
		if res.RefundStatus != RefundStatusPending {
			t.Errorf("refund_status %q, want pending (the money is NOT back yet)", res.RefundStatus)
		}
		// a re-POST that succeeds reports refunded
		svc.SetDomainExternalRefunder("towing", reversingRefunder(svc))
		res, err = svc.CancelTowingWithRefund(ctx, id, user, "retry")
		if err != nil || res.RefundStatus != RefundStatusRefunded {
			t.Errorf("retry res=%+v err=%v, want refunded", res, err)
		}
		// and once complete a further POST still reports refunded, not an error
		res, err = svc.CancelTowingWithRefund(ctx, id, user, "again")
		if err != nil || res.RefundStatus != RefundStatusRefunded {
			t.Errorf("repeat res=%+v err=%v, want refunded", res, err)
		}
	})
	t.Run("wallet-funded", func(t *testing.T) {
		j, err := svc.BookTowing(ctx, user, liveTowingReq(), "pftow-rs-"+uuid.NewString())
		if err != nil {
			t.Fatal(err)
		}
		res, err := svc.CancelTowingWithRefund(ctx, j["id"].(string), user, "x")
		if err != nil || res.RefundStatus != RefundStatusRefunded {
			t.Errorf("res=%+v err=%v, want refunded", res, err)
		}
	})
	t.Run("parcel and mover", func(t *testing.T) {
		svc.SetDomainExternalRefunder("parcel", &fakeMoverRefunder{err: errors.New("down")})
		res, err := svc.CancelParcelWithRefund(ctx, cardFundedParcel(t, ctx, svc, user), user, "x")
		if err != nil || res.RefundStatus != RefundStatusPending {
			t.Errorf("parcel res=%+v err=%v, want pending", res, err)
		}
		svc.SetDomainExternalRefunder("movers", reversingRefunder(svc))
		res, err = svc.CancelMoverWithRefund(ctx, cardFundedMove(t, ctx, svc, pool, user), user, "x")
		if err != nil || res.RefundStatus != RefundStatusRefunded {
			t.Errorf("mover res=%+v err=%v, want refunded", res, err)
		}
	})
}

func TestLiveDB_Cancel_NoRefunderWired_IsRefusedForParcelTowingAndMovers_WalletUnaffected(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited)

	tow := cardFundedTow(t, ctx, svc, user)
	par := cardFundedParcel(t, ctx, svc, user)
	mov := cardFundedMove(t, ctx, svc, pool, user)
	// wallet-funded rows must still cancel with no refunder wired at all
	j, err := svc.BookTowing(ctx, user, liveTowingReq(), "pftow-nr2-"+uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}

	for _, fn := range []func() error{
		func() error { _, e := svc.CancelTowingWithRefund(ctx, tow, user, "x"); return e },
		func() error { _, e := svc.CancelParcelWithRefund(ctx, par, user, "x"); return e },
		func() error { _, e := svc.CancelMoverWithRefund(ctx, mov, user, "x"); return e },
	} {
		wantCoded(t, fn(), 503, "refund_unavailable")
	}
	if st := towingStatus(t, ctx, pool, tow); st != "requested" {
		t.Errorf("towing flipped to %q", st)
	}
	if _, err := svc.CancelTowingWithRefund(ctx, j["id"].(string), user, "x"); err != nil {
		t.Errorf("wallet-funded cancel must be unaffected: %v", err)
	}
}

// ── M2: the sweep ───────────────────────────────────────────────────────────

func TestLiveDB_SweepCancelledCardRefunds_DrivesStrandedRefunds_OnlyThose(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited)

	// Refund fails after the flip → cancelled but still escrowed (stranded).
	svc.SetDomainExternalRefunder("towing", &fakeMoverRefunder{err: errors.New("gateway down")})
	stranded := cardFundedTow(t, ctx, svc, user)
	if _, err := svc.CancelTowingWithRefund(ctx, stranded, user, "x"); err != nil {
		t.Fatal(err)
	}
	// Not cancelled (live card job) and a wallet-funded cancelled job: both must be left alone.
	live := cardFundedTow(t, ctx, svc, user)
	wj, err := svc.BookTowing(ctx, user, liveTowingReq(), "pftow-sw-"+uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CancelTowingWithRefund(ctx, wj["id"].(string), user, "x"); err != nil {
		t.Fatal(err)
	}

	fake := reversingRefunder(svc)
	svc.SetDomainExternalRefunder("towing", fake)

	// A cancel that just happened is not touched (it may still be in flight).
	res, err := svc.SweepCancelledCardRefunds(ctx, RefundDomainTowing, 1<<40, 100)
	if err != nil || res.Completed != 0 || len(fake.calls) != 0 {
		t.Fatalf("a fresh cancel must be left to its own retry: res=%+v calls=%d err=%v", res, len(fake.calls), err)
	}

	res, err = svc.SweepCancelledCardRefunds(ctx, RefundDomainTowing, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	var mine int
	for _, c := range fake.calls {
		switch c.entityID {
		case stranded:
			mine++
		case live, wj["id"].(string):
			t.Errorf("sweep refunded %s which is not a cancelled card-funded job", c.entityID)
		}
	}
	if mine != 1 || res.Completed < 1 {
		t.Fatalf("calls=%+v res=%+v: the stranded refund must be driven exactly once", fake.calls, res)
	}
	sid, _, sst, _ := towingSettlementRow(t, ctx, pool, stranded)
	if sst != "refunded" {
		t.Errorf("settlement %s %s, want refunded", sid, sst)
	}
	// idempotent: a second sweep finds nothing for it
	before := len(fake.calls)
	if _, err := svc.SweepCancelledCardRefunds(ctx, RefundDomainTowing, 0, 100); err != nil {
		t.Fatal(err)
	}
	for _, c := range fake.calls[before:] {
		if c.entityID == stranded {
			t.Error("a completed refund was driven again")
		}
	}
}

func TestLiveDB_SweepCancelledCardRefunds_Mover_MarksEscrowRefundedAndParcelIsCovered(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 10_000_000)

	svc.SetDomainExternalRefunder("movers", &fakeMoverRefunder{err: errors.New("down")})
	mov := cardFundedMove(t, ctx, svc, pool, user)
	if _, err := svc.CancelMoverWithRefund(ctx, mov, user, "x"); err != nil {
		t.Fatal(err)
	}
	if m := readMover(t, ctx, pool, mov); m.escrow == "refunded" {
		t.Fatalf("setup: %+v", m)
	}
	svc.SetDomainExternalRefunder("parcel", &fakeMoverRefunder{err: errors.New("down")})
	par := cardFundedParcel(t, ctx, svc, user)
	if _, err := svc.CancelParcelWithRefund(ctx, par, user, "x"); err != nil {
		t.Fatal(err)
	}

	svc.SetDomainExternalRefunder("movers", reversingRefunder(svc))
	svc.SetDomainExternalRefunder("parcel", reversingRefunder(svc))
	if _, err := svc.SweepCancelledCardRefunds(ctx, RefundDomainMovers, 0, 100); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SweepCancelledCardRefunds(ctx, RefundDomainParcel, 0, 100); err != nil {
		t.Fatal(err)
	}
	if m := readMover(t, ctx, pool, mov); m.escrow != "refunded" {
		t.Errorf("mover escrow_status %q after the sweep refunded it", m.escrow)
	}
	if _, _, st, _ := settlementRow(t, ctx, pool, par); st != "refunded" {
		t.Errorf("parcel settlement %q after the sweep", st)
	}
	if _, err := svc.SweepCancelledCardRefunds(ctx, "nope", 0, 10); err == nil {
		t.Error("an unknown domain must be an error, not a silent no-op")
	}
}

// ── L-b ─────────────────────────────────────────────────────────────────────

func TestCapCancelReason(t *testing.T) {
	long := strings.Repeat("é", 5000) // multi-byte: a byte slice would split a rune
	got := capCancelReason(long)
	if n := utf8.RuneCountInString(got); n != maxCancelReasonRunes {
		t.Errorf("capped to %d runes, want %d", n, maxCancelReasonRunes)
	}
	if !utf8.ValidString(got) {
		t.Error("truncation split a rune")
	}
	if got := capCancelReason("changed my mind"); got != "changed my mind" {
		t.Errorf("short reason altered: %q", got)
	}
	if got := capCancelReason("  padded \n\x00\x07x "); strings.ContainsAny(got, "\x00\x07\n") {
		t.Errorf("control characters survive: %q", got)
	}
}

func TestLiveDB_Cancel_ReasonIsCappedBeforeItReachesTheRefundPath(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 10_000_000)
	fake := reversingRefunder(svc)
	svc.SetDomainExternalRefunder("towing", fake)
	svc.SetDomainExternalRefunder("parcel", fake)
	svc.SetDomainExternalRefunder("movers", fake)
	huge := strings.Repeat("x", 100_000)

	if err := svc.CancelTowing(ctx, cardFundedTow(t, ctx, svc, user), user, huge); err != nil {
		t.Fatal(err)
	}
	if err := svc.CancelParcel(ctx, cardFundedParcel(t, ctx, svc, user), user, huge); err != nil {
		t.Fatal(err)
	}
	if err := svc.CancelMover(ctx, cardFundedMove(t, ctx, svc, pool, user), user, huge); err != nil {
		t.Fatal(err)
	}
	if len(fake.calls) != 3 {
		t.Fatalf("calls %d", len(fake.calls))
	}
	for _, c := range fake.calls {
		if n := utf8.RuneCountInString(c.reason); n > maxCancelReasonRunes+40 { // + the fixed "<mode>_cancelled:" prefix
			t.Errorf("a %d-rune reason reached the refund path", n)
		}
	}
}

// ── L-c ─────────────────────────────────────────────────────────────────────

func TestLiveDB_RecancelFinishesARefundForADisputedExternalSettlementToo(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 10_000_000)
	failing := &fakeMoverRefunder{err: errors.New("down")}
	for _, d := range []string{"towing", "parcel", "movers"} {
		svc.SetDomainExternalRefunder(d, failing)
	}
	tow := cardFundedTow(t, ctx, svc, user)
	par := cardFundedParcel(t, ctx, svc, user)
	mov := cardFundedMove(t, ctx, svc, pool, user)
	_, _ = svc.CancelTowingWithRefund(ctx, tow, user, "x")
	_, _ = svc.CancelParcelWithRefund(ctx, par, user, "x")
	_, _ = svc.CancelMoverWithRefund(ctx, mov, user, "x")

	for _, c := range []struct{ table, id string }{{"towing_jobs", tow}, {"parcels", par}, {"mover_jobs", mov}} {
		if _, err := pool.Exec(ctx, `UPDATE settlements SET status='disputed' WHERE id=(SELECT settlement_id FROM `+c.table+` WHERE id=$1)`, c.id); err != nil {
			t.Fatal(err)
		}
	}

	ok := &fakeMoverRefunder{}
	for _, d := range []string{"towing", "parcel", "movers"} {
		svc.SetDomainExternalRefunder(d, ok)
	}
	if err := svc.CancelTowing(ctx, tow, user, "retry"); err != nil {
		t.Fatal(err)
	}
	if err := svc.CancelParcel(ctx, par, user, "retry"); err != nil {
		t.Fatal(err)
	}
	if err := svc.CancelMover(ctx, mov, user, "retry"); err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, c := range ok.calls {
		got[c.entityID] = true
	}
	for name, id := range map[string]string{"towing": tow, "parcel": par, "mover": mov} {
		if !got[id] {
			t.Errorf("re-cancel of a DISPUTED card-funded %s did not drive the refund (stranded escrow)", name)
		}
	}
}

// ── L-d ─────────────────────────────────────────────────────────────────────

type fixedMaps struct {
	*MockMaps
	distanceM int
}

func (m *fixedMaps) Route(ctx context.Context, from, to LatLng) (RouteResult, error) {
	rr, err := m.MockMaps.Route(ctx, from, to)
	rr.DistanceM = m.distanceM
	return rr, err
}

func TestLiveDB_PriceTowing_NegativeRouteDistance_IsClampedToZero(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, _ := paystackRideFixture(t, ctx, pool, 0)
	cfg, err := svc.loadPricingConfig(ctx, "default", "towing")
	if err != nil {
		t.Fatal(err)
	}
	floor := towingFare(0, cfg)

	svc = svc.WithMaps(&fixedMaps{MockMaps: NewMockMaps(), distanceM: -50_000_000})
	got, err := svc.QuoteTowingBooking(ctx, liveTowingReq())
	if err != nil {
		t.Fatal(err)
	}
	if got != floor {
		t.Errorf("a negative route distance priced at %d, want the zero-distance fare %d (a corrupt router must never discount a charge)", got, floor)
	}
	est, err := svc.EstimateTowing(ctx, TowingEstimateRequest{Pickup: liveTowingReq().Pickup, Dest: liveTowingReq().Dest})
	if err != nil || est.DistanceM != 0 || est.FareKobo != floor {
		t.Errorf("estimate %+v err=%v, want distance 0 / fare %d", est, err, floor)
	}
}

func TestLiveDB_BookTowingPaystackFunded_ZeroFareAndZeroVerified_IsRefusedNotEscrowed(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 0)
	// A snapshot whose config prices everything at zero: fare = 0 == verified 0,
	// so the plain "fare != verified" cross-check would let it through.
	zero := []byte(`{"distanceM":0,"config":{}}`)
	key := "towingorder:zero-" + uuid.NewString()
	_, err := svc.BookTowingPaystackFundedFrozen(ctx, user, liveTowingReq(), key, 0, zero)
	wantCoded(t, err, 409, CodeAmountMismatch)
	if n := countSettlementsByKey(t, ctx, pool, key); n != 0 {
		t.Errorf("%d settlement(s) for a zero charge", n)
	}
}

// ── M1: the admin status patch ──────────────────────────────────────────────

func TestLiveDB_AdminPatch_CardFundedEscrow_RefusesMoneyMovingStatuses(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, user, testsupport.KycTierUnlimited)
	admin := NewAdminService(svc)
	adminID := uuid.NewString()

	tow := cardFundedTow(t, ctx, svc, user)
	for _, st := range []string{"cancelled", "completed", "disputed", "failed"} {
		err := admin.PatchTowingStatus(ctx, adminID, tow, ModeStatusPatchRequest{Status: st, Reason: "ops"})
		wantCoded(t, err, 409, CodeInvalidState)
		if !strings.Contains(err.Error(), "refund") {
			t.Errorf("%s: message %q must point at the cancel flow / refund runbook", st, err.Error())
		}
		if got := towingStatus(t, ctx, pool, tow); got != "requested" {
			t.Fatalf("status flipped to %q despite the refusal", got)
		}
	}
	// a non-money-moving transition is untouched
	if err := admin.PatchTowingStatus(ctx, adminID, tow, ModeStatusPatchRequest{Status: "operator_accepted", Reason: "ops"}); err != nil {
		t.Fatalf("non-money transition refused: %v", err)
	}

	// parcels and movers: same guard
	par := cardFundedParcel(t, ctx, svc, user)
	for _, st := range []string{"cancelled", "failed", "disputed", "delivered"} {
		wantCoded(t, admin.PatchParcelStatus(ctx, adminID, par, ModeStatusPatchRequest{Status: st}), 409, CodeInvalidState)
	}
	mov := cardFundedMove(t, ctx, svc, pool, user)
	for _, st := range []string{"cancelled", "disputed", "completion_confirmed"} {
		wantCoded(t, admin.PatchMoverStatus(ctx, adminID, mov, ModeStatusPatchRequest{Status: st}), 409, CodeInvalidState)
	}
	if m := readMover(t, ctx, pool, mov); m.status != "bid_accepted" {
		t.Errorf("mover flipped to %q", m.status)
	}

	// WALLET-funded behaviour is unchanged.
	j, err := svc.BookTowing(ctx, user, liveTowingReq(), "pftow-adm-"+uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	if err := admin.PatchTowingStatus(ctx, adminID, j["id"].(string), ModeStatusPatchRequest{Status: "cancelled"}); err != nil {
		t.Errorf("wallet-funded patch must still work: %v", err)
	}
}

func TestLiveDB_AdminPatch_RefundedCardSettlement_IsNotBlocked_AndTheRunbookRecoveryWorks(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, user := paystackRideFixture(t, ctx, pool, 10_000_000)
	admin := NewAdminService(svc)
	adminID := uuid.NewString()

	// Runbook: a card job got stuck "cancelled" with its refund failing → an
	// operator patches it BACK to a live status, then the customer re-POSTs cancel.
	svc.SetDomainExternalRefunder("towing", &fakeMoverRefunder{err: errors.New("down")})
	stuck := cardFundedTow(t, ctx, svc, user)
	if _, err := svc.CancelTowingWithRefund(ctx, stuck, user, "x"); err != nil {
		t.Fatal(err)
	}
	if err := admin.PatchTowingStatus(ctx, adminID, stuck, ModeStatusPatchRequest{Status: "requested", Reason: "runbook: re-open to retry the refund"}); err != nil {
		t.Fatalf("patching back must be allowed: %v", err)
	}
	svc.SetDomainExternalRefunder("towing", reversingRefunder(svc))
	res, err := svc.CancelTowingWithRefund(ctx, stuck, user, "retry")
	if err != nil || res.RefundStatus != RefundStatusRefunded {
		t.Fatalf("runbook step 2: res=%+v err=%v", res, err)
	}

	// Once the settlement is refunded the patch no longer guards anything.
	if err := admin.PatchTowingStatus(ctx, adminID, stuck, ModeStatusPatchRequest{Status: "cancelled", Reason: "tidy"}); err != nil {
		t.Errorf("a refunded settlement holds no escrow; the patch must be allowed: %v", err)
	}
}

// ── M3: one open mover checkout per job ──────────────────────────────────────

func seedMoverIntent(t *testing.T, ctx context.Context, pool *pgxpool.Pool, payer, jobID, bidID, status string) string {
	t.Helper()
	key := "mvintent-" + uuid.NewString()
	ref := "moversorder:" + key
	body := fmt.Sprintf(`{"job_id":%q,"bid_id":%q}`, jobID, bidID)
	if _, err := pool.Exec(ctx, `
		INSERT INTO transport_paystack_intents (reference, domain, payer_id, request_json, amount_kobo, idempotency_key, status)
		VALUES ($1,'movers',$2,$3::jsonb,100000,$4,$5)`, ref, payer, body, key, status); err != nil {
		t.Fatalf("seed intent: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM transport_paystack_intents WHERE reference=$1`, ref)
	})
	return ref
}

func TestLiveDB_QuoteMoverAcceptance_RefusesASecondOpenCheckoutForTheSameJob(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, customer := paystackRideFixture(t, ctx, pool, 0)
	jobID, bids, _ := seedMoverJob(t, ctx, svc, pool, customer, 4_000_000, 4_500_000)

	for _, open := range []string{"pending", "processing"} {
		ref := seedMoverIntent(t, ctx, pool, customer, jobID, bids[0], open)
		_, _, err := svc.QuoteMoverAcceptance(ctx, customer, moverReq(jobID, bids[1]))
		wantCoded(t, err, 409, "checkout_in_progress")
		ce, _ := errors.AsType[*CodedError](err)
		if ce.Details["reference"] != ref {
			t.Errorf("%s: details %v must carry the existing reference %q so the client can resume", open, ce.Details, ref)
		}
		_, _ = pool.Exec(ctx, `DELETE FROM transport_paystack_intents WHERE reference=$1`, ref)
	}

	// Terminal / refunding intents do not block a fresh checkout.
	for _, done := range []string{"confirmed", "refunded", "refunding", "order_failed", "amount_mismatch"} {
		seedMoverIntent(t, ctx, pool, customer, jobID, bids[0], done)
		if _, _, err := svc.QuoteMoverAcceptance(ctx, customer, moverReq(jobID, bids[1])); err != nil {
			t.Errorf("a %s intent must not block a new checkout: %v", done, err)
		}
		_, _ = pool.Exec(ctx, `DELETE FROM transport_paystack_intents WHERE payer_id=$1 AND domain='movers'`, customer)
	}

	// Another job of the same customer is independent.
	job2, bids2, _ := seedMoverJob(t, ctx, svc, pool, customer, 3_000_000)
	seedMoverIntent(t, ctx, pool, customer, jobID, bids[0], "pending")
	if _, _, err := svc.QuoteMoverAcceptance(ctx, customer, moverReq(job2, bids2[0])); err != nil {
		t.Errorf("an open checkout on job A blocked job B: %v", err)
	}
}
