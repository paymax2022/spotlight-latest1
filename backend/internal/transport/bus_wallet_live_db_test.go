package transport

// LIVE-DB regression suite for the wallet bus path (ADR-PR559-bus-wallet-fixes).
// Skips unless TEST_DATABASE_URL is set. Fixtures: bus_wallet_fixtures_live_db_test.go.

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"spotlight/backend/internal/testsupport"
)

const testFare = int64(500_000) // ₦5,000

func (f *busFx) deferred() *busFx {
	f.svc.WithBusConfig(NewBusConfig(true, 30, 120, 15))
	return f
}

func codeOf(err error) string {
	var ce *CodedError
	if errors.As(err, &ce) {
		return ce.Code
	}
	return ""
}

func (f *busFx) mustBook(user, sched string, seat int, key string) map[string]any {
	f.t.Helper()
	tk, err := f.book(user, sched, seat, key)
	if err != nil {
		f.t.Fatalf("book seat %d: %v", seat, err)
	}
	return tk
}

func (f *busFx) cancel(ticketID, user string) (*BusCancelResult, error) {
	return f.svc.CancelBusTicket(f.ctx, ticketID, user, "changed mind")
}

type fakeRecorder struct {
	mu    sync.Mutex
	calls []string
	exact [][3]int64 // gross, revenue
}

func (r *fakeRecorder) RecordFor(_ context.Context, _, _, _ string, _ int64, _, sourceRef string, _ *string, _ string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, sourceRef)
	return nil
}
func (r *fakeRecorder) RecordExact(_ context.Context, _, _, _ string, gross, revenue int64, _, sourceRef string, _ *string, _ string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.exact = append(r.exact, [3]int64{gross, revenue, 0})
	r.calls = append(r.calls, sourceRef)
	return nil
}
func (r *fakeRecorder) count() int { r.mu.Lock(); defer r.mu.Unlock(); return len(r.calls) }

// ─── 1. cancel / refund truth ────────────────────────────────────────────────

// Flag OFF (legacy): the fare is paid to the operator at booking. A cancel must be
// REFUSED - never flip the ticket to refunded while the wallet is unchanged.
func TestLiveDB_Bus_LegacyCancelOfSettledTicketIsRefusedNotFaked(t *testing.T) {
	f := newBusFx(t)
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	tk := f.mustBook(rider, sched, 1, "legacy-"+rider)
	id := str(tk, "id")
	afterBook := f.balance(rider)

	res, err := f.cancel(id, rider)
	if err == nil || codeOf(err) != CodeRefundRequiresSupport {
		t.Fatalf("cancel of a settled ticket must be 409 %s, got res=%v err=%v", CodeRefundRequiresSupport, res, err)
	}
	status, payment, refund, sett := f.ticketRow(id)
	if status != "issued" || payment != "paid" || refund != "none" {
		t.Fatalf("ticket must be untouched: status=%s payment=%s refund=%s", status, payment, refund)
	}
	if f.settlementStatus(sett) != "settled" {
		t.Fatalf("settlement should stay settled")
	}
	if f.balance(rider) != afterBook {
		t.Fatalf("wallet changed on a refused cancel")
	}
}

// Wallet behaviour that is not a bug must not change: legacy mode still settles
// the provider on issue with the commission split, and FREEZES it on the ticket.
func TestLiveDB_Bus_LegacySettleOnIssueUnchangedAndSplitFrozen(t *testing.T) {
	f := newBusFx(t)
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	ownerBefore := f.balance(r.OwnerID)
	tk := f.mustBook(rider, sched, 2, "legacy-split-"+rider)
	id := str(tk, "id")
	if got := f.balance(rider); got != 2_000_000-testFare {
		t.Fatalf("rider balance = %d, want %d", got, 2_000_000-testFare)
	}
	if got := f.balance(r.OwnerID) - ownerBefore; got != 400_000 { // 80% of ₦5,000
		t.Fatalf("provider owner credited %d, want 400000 (80%%)", got)
	}
	var payout, mode string
	var prov, plat float64
	var settleUser string
	if err := f.pool.QueryRow(f.ctx, `SELECT payout_state, settle_mode, provider_pct, platform_pct, settle_user_id::text FROM bus_tickets WHERE id=$1`, id).
		Scan(&payout, &mode, &prov, &plat, &settleUser); err != nil {
		t.Fatal(err)
	}
	if payout != "released" || mode != "immediate" || prov != 0.8 || plat != 0.2 || settleUser != r.OwnerID {
		t.Fatalf("frozen terms wrong: payout=%s mode=%s prov=%v plat=%v settleUser=%s", payout, mode, prov, plat, settleUser)
	}
}

func TestLiveDB_Bus_TierGatePreserved(t *testing.T) {
	f := newBusFx(t)
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	testsupport.SetKycTier(t, f.ctx, f.pool, rider, 0)
	_, err := f.book(rider, sched, 1, "tier0-"+rider)
	var ce *CodedError
	if !errors.As(err, &ce) || ce.Status != 403 {
		t.Fatalf("tier-0 booking must be refused 403, got %v", err)
	}
	if f.balance(rider) != 2_000_000 || f.ticketCountForKey("tier0-"+rider) != 0 {
		t.Fatalf("a tier-gated booking must move no money and issue no ticket")
	}
}

// Flag ON: the fare stays escrowed and a cancel before the cutoff really refunds.
func TestLiveDB_Bus_DeferredCancelRefundsWalletAndRecordsNoEarning(t *testing.T) {
	f := newBusFx(t).deferred()
	rec := &fakeRecorder{}
	f.svc.SetCommissionRecorder(rec)
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	ownerBefore := f.balance(r.OwnerID)
	tk := f.mustBook(rider, sched, 1, "def-"+rider)
	id := str(tk, "id")
	if f.balance(rider) != 2_000_000-testFare {
		t.Fatalf("rider should be debited the fare into escrow")
	}
	if tk["cancellable"] != true || tk["cancelCutoffMinutes"] == nil {
		t.Fatalf("detail must advertise cancellable + cutoff: %v", tk)
	}
	_, _, _, sett := f.ticketRow(id)
	if f.settlementStatus(sett) != "escrowed" {
		t.Fatalf("deferred ticket must leave the settlement escrowed, got %s", f.settlementStatus(sett))
	}
	if f.balance(r.OwnerID) != ownerBefore {
		t.Fatalf("operator must NOT be paid at booking in deferred mode")
	}
	if rec.count() != 0 {
		t.Fatalf("no commission earning may be recorded before the fare is paid out")
	}

	res, err := f.cancel(id, rider)
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if res.RefundStatus != RefundRefunded || res.RefundedKobo != testFare || res.HTTPStatus() != 200 {
		t.Fatalf("unexpected result %+v", res)
	}
	if f.balance(rider) != 2_000_000 {
		t.Fatalf("wallet must be fully restored, got %d", f.balance(rider))
	}
	status, payment, refund, _ := f.ticketRow(id)
	if status != "cancelled" || payment != "refunded" || refund != RefundRefunded {
		t.Fatalf("ticket state wrong: %s/%s/%s", status, payment, refund)
	}
	if f.settlementStatus(sett) != "refunded" {
		t.Fatalf("settlement must be refunded")
	}
	if rec.count() != 0 {
		t.Fatalf("a refunded ticket must never have an earning row")
	}
	// Idempotent repeat: same truthful answer, no second credit.
	res2, err := f.cancel(id, rider)
	if err != nil || res2.RefundStatus != RefundRefunded {
		t.Fatalf("repeat cancel: %+v %v", res2, err)
	}
	if f.balance(rider) != 2_000_000 {
		t.Fatalf("repeat cancel double-credited the wallet: %d", f.balance(rider))
	}
}

func TestLiveDB_Bus_DeferredCancelAfterCutoffRefused(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	// Departs in 90 min: inside the default 120 min cutoff, but still bookable (>15 min lead).
	sched := f.schedule(r.RouteID, time.Now().Add(90*time.Minute), 10, testFare)
	rider := f.user(2_000_000)
	tk := f.mustBook(rider, sched, 1, "cut-"+rider)
	id := str(tk, "id")
	if tk["cancellable"] != false {
		t.Fatalf("server must report cancellable=false inside the cutoff: %v", tk["cancellable"])
	}
	_, err := f.cancel(id, rider)
	if codeOf(err) != CodeCancelWindowClosed {
		t.Fatalf("want 409 %s, got %v", CodeCancelWindowClosed, err)
	}
	status, payment, _, _ := f.ticketRow(id)
	if status != "issued" || payment != "paid" || f.balance(rider) != 2_000_000-testFare {
		t.Fatalf("refused cancel must change nothing")
	}
}

func TestLiveDB_Bus_PerScheduleCutoffIsHonoured(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(90*time.Minute), 10, testFare)
	// Schedule overrides the cutoff to the 60 min minimum: a cancel 90 min out is fine.
	if _, err := f.pool.Exec(f.ctx, `UPDATE bus_schedules SET cancel_cutoff_minutes=60 WHERE id=$1`, sched); err != nil {
		t.Fatal(err)
	}
	rider := f.user(2_000_000)
	tk := f.mustBook(rider, sched, 1, "cut60-"+rider)
	res, err := f.cancel(str(tk, "id"), rider)
	if err != nil || res.RefundStatus != RefundRefunded {
		t.Fatalf("cancel within a 60-min cutoff at T-90m must refund: %+v %v", res, err)
	}
}

// Deferred settlement: the sweeper pays the provider at departure+grace using the
// split FROZEN at booking (changing the live config afterwards must not matter),
// records the earning exactly once, and the paid-out ticket can no longer cancel.
func TestLiveDB_Bus_DeferredSweeperSettlesWithFrozenSplit(t *testing.T) {
	f := newBusFx(t).deferred()
	rec := &fakeRecorder{}
	f.svc.SetCommissionRecorder(rec)
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	ownerBefore := f.balance(r.OwnerID)
	tk := f.mustBook(rider, sched, 1, "sweep-"+rider)
	id := str(tk, "id")

	// Not due yet: nothing happens.
	if n, err := f.svc.SettleDueBusTickets(f.ctx, 500); err != nil || n != 0 {
		t.Fatalf("sweeper before departure+grace settled %d (err %v)", n, err)
	}
	// Change the live commission config AFTER booking: the frozen 80/20 must still apply.
	if _, err := f.pool.Exec(f.ctx, `UPDATE transport_commission_config SET provider_pct=0.5, platform_pct=0.5 WHERE tier='standard'`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(), `UPDATE transport_commission_config SET provider_pct=0.8, platform_pct=0.2 WHERE tier='standard'`)
	})
	// Departure 20 min ago (inside the 30 min grace) -> still not due.
	if _, err := f.pool.Exec(f.ctx, `UPDATE bus_schedules SET departure_time=NOW()-INTERVAL '20 minutes' WHERE id=$1`, sched); err != nil {
		t.Fatal(err)
	}
	if n, _ := f.svc.SettleDueBusTickets(f.ctx, 500); n != 0 {
		t.Fatalf("settled inside the grace window")
	}
	// 31 min ago -> due.
	if _, err := f.pool.Exec(f.ctx, `UPDATE bus_schedules SET departure_time=NOW()-INTERVAL '31 minutes' WHERE id=$1`, sched); err != nil {
		t.Fatal(err)
	}
	if n, err := f.svc.SettleDueBusTickets(f.ctx, 500); err != nil || n < 1 {
		t.Fatalf("sweeper should settle the due ticket: n=%d err=%v", n, err)
	}
	if got := f.balance(r.OwnerID) - ownerBefore; got != 400_000 {
		t.Fatalf("provider credited %d, want the FROZEN 80%% = 400000", got)
	}
	var payout string
	_ = f.pool.QueryRow(f.ctx, `SELECT payout_state FROM bus_tickets WHERE id=$1`, id).Scan(&payout)
	if payout != "released" || rec.count() != 1 {
		t.Fatalf("payout=%s earning rows=%d (want released/1)", payout, rec.count())
	}
	// Idempotent sweep: no double payout, no second earning.
	if n, _ := f.svc.SettleDueBusTickets(f.ctx, 500); n != 0 {
		t.Fatalf("second sweep re-settled %d", n)
	}
	if f.balance(r.OwnerID)-ownerBefore != 400_000 || rec.count() != 1 {
		t.Fatalf("double payout or double earning")
	}
	// A paid-out ticket cannot be cancelled-with-refund (and departure has passed anyway).
	if _, err := f.cancel(id, rider); err == nil {
		t.Fatalf("cancel after payout must be refused")
	}
}

// Cancel vs sweeper (operator path, so the departure rule does not apply) run
// concurrently: money must go to EXACTLY ONE side per ticket, never both.
func TestLiveDB_Bus_CancelVersusSettleNeverBothPaysAndRefunds(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 30, testFare)
	type tkt struct{ id, user string }
	var ts []tkt
	for i := 1; i <= 8; i++ {
		u := f.user(1_000_000)
		tk := f.mustBook(u, sched, i, "race-"+u)
		ts = append(ts, tkt{str(tk, "id"), u})
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE bus_schedules SET departure_time=NOW()-INTERVAL '40 minutes' WHERE id=$1`, sched); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for _, x := range ts {
		wg.Add(2)
		go func() {
			defer wg.Done()
			if tk, err := f.svc.loadBusTicket(f.ctx, x.id); err == nil {
				_, _ = f.svc.cancelBusTicketCore(f.ctx, tk, "op", "race", false)
			}
		}()
		go func() {
			defer wg.Done()
			_, _ = f.svc.settleBusTicket(f.ctx, x.id)
		}()
	}
	wg.Wait()
	// A second pass resolves anything left pending, then assert exclusivity.
	_, _ = f.svc.RetryOpenBusRefunds(f.ctx, 100)
	for _, x := range ts {
		status, payment, refund, sett := f.ticketRow(x.id)
		bal := f.balance(x.user)
		st := f.settlementStatus(sett)
		switch {
		case st == "settled" && bal == 1_000_000-testFare && payment == "paid" && refund != RefundRefunded:
		case st == "refunded" && bal == 1_000_000 && payment == "refunded" && refund == RefundRefunded && status == "cancelled":
		default:
			t.Fatalf("ticket %s inconsistent: ticket=%s/%s/%s settlement=%s balance=%d", x.id, status, payment, refund, st, bal)
		}
	}
}

// ─── 2. idempotent replay / free ticket ──────────────────────────────────────

func TestLiveDB_Bus_RetryAfterFailedSettleResumesSameTicketNoFreeRide(t *testing.T) {
	f := newBusFx(t)
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	restore := f.failSettleFor(rider)
	key := "retry-" + rider
	if _, err := f.book(rider, sched, 2, key); err == nil {
		t.Fatalf("first attempt should fail at settle")
	}
	// The ticket exists, the fare is escrowed, nothing was refunded.
	if f.ticketCountForKey(key) != 1 {
		t.Fatalf("the ticket must exist after a settle failure")
	}
	var firstID, sett string
	_ = f.pool.QueryRow(f.ctx, `SELECT id::text, settlement_id::text FROM bus_tickets WHERE idempotency_key=$1`, key).Scan(&firstID, &sett)
	if f.settlementStatus(sett) != "escrowed" || f.balance(rider) != 2_000_000-testFare {
		t.Fatalf("fare must stay escrowed after a failed settle")
	}
	restore()
	tk, err := f.book(rider, sched, 2, key)
	if err != nil {
		t.Fatalf("retry must succeed: %v", err)
	}
	if str(tk, "id") != firstID || f.ticketCountForKey(key) != 1 {
		t.Fatalf("retry must return the SAME ticket (got %s want %s)", str(tk, "id"), firstID)
	}
	if f.settlementStatus(sett) != "settled" || f.balance(rider) != 2_000_000-testFare {
		t.Fatalf("retry must finish the settle and charge exactly once: %s balance=%d", f.settlementStatus(sett), f.balance(rider))
	}
}

func TestLiveDB_Bus_ReplayIsIdempotentAndKeyReuseConflicts(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	key := "idem-" + rider
	a := f.mustBook(rider, sched, 3, key)
	b := f.mustBook(rider, sched, 3, key)
	if str(a, "id") != str(b, "id") || f.balance(rider) != 2_000_000-testFare || f.ticketCountForKey(key) != 1 {
		t.Fatalf("replay must return the same ticket and charge once")
	}
	if _, err := f.book(rider, sched, 4, key); codeOf(err) != CodeKeyConflict {
		t.Fatalf("same key, different seat must be 409 %s, got %v", CodeKeyConflict, err)
	}
	other := f.user(2_000_000)
	if _, err := f.book(other, sched, 3, key); codeOf(err) != CodeKeyConflict {
		t.Fatalf("another user's key must conflict, got %v", err)
	}
	if f.balance(other) != 2_000_000 {
		t.Fatalf("a conflicting key must not charge")
	}
}

// A key whose earlier attempt was refunded (seat taken) must not later mint a
// ticket for nothing when the seat frees up.
func TestLiveDB_Bus_ReusingARefundedAttemptKeyCannotMintFreeTicket(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	a, b := f.user(2_000_000), f.user(2_000_000)
	tkA := f.mustBook(a, sched, 5, "free-a-"+a)
	kb := "free-b-" + b
	if _, err := f.book(b, sched, 5, kb); codeOf(err) != CodeSeatTaken {
		t.Fatalf("want SEAT_TAKEN, got %v", err)
	}
	if f.balance(b) != 2_000_000 {
		t.Fatalf("losing booker must be made whole")
	}
	if _, err := f.cancel(str(tkA, "id"), a); err != nil {
		t.Fatal(err)
	}
	_, err := f.book(b, sched, 5, kb)
	if codeOf(err) != CodeKeyConflict {
		t.Fatalf("a used-up key must conflict, got %v", err)
	}
	if f.ticketCountForKey(kb) != 0 || f.balance(b) != 2_000_000 {
		t.Fatalf("no ticket and no charge expected")
	}
}

// ─── 3. SEAT_TAKEN only for a seat conflict ──────────────────────────────────

func TestLiveDB_Bus_SeatTakenOnlyForSeatConflictOtherErrorsReverseEscrow(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	a, b := f.user(2_000_000), f.user(2_000_000)
	f.mustBook(a, sched, 1, "seat-a-"+a)
	_, err := f.book(b, sched, 1, "seat-b-"+b)
	if codeOf(err) != CodeSeatTaken || f.balance(b) != 2_000_000 {
		t.Fatalf("genuine seat conflict: want SEAT_TAKEN + refund, got %v balance=%d", err, f.balance(b))
	}
	// A non-seat insert failure (induced) must NOT be masked as SEAT_TAKEN.
	for _, q := range []string{
		`CREATE OR REPLACE FUNCTION busfix_block_insert() RETURNS trigger AS $$ BEGIN IF NEW.passenger_name='boom-insert' THEN RAISE EXCEPTION 'busfix: induced insert failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`,
		`DROP TRIGGER IF EXISTS busfix_block_insert_trg ON bus_tickets`,
		`CREATE TRIGGER busfix_block_insert_trg BEFORE INSERT ON bus_tickets FOR EACH ROW EXECUTE FUNCTION busfix_block_insert()`,
	} {
		if _, err := f.pool.Exec(f.ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS busfix_block_insert_trg ON bus_tickets`)
	})
	c := f.user(2_000_000)
	_, err = f.svc.BookBusTicket(f.ctx, c, BusBookRequest{ScheduleID: sched, SeatNumber: 2, PassengerName: "boom-insert"}, "boom-"+c)
	if err == nil || codeOf(err) == CodeSeatTaken {
		t.Fatalf("a non-seat error must be a plain error, not SEAT_TAKEN: %v", err)
	}
	if f.balance(c) != 2_000_000 {
		t.Fatalf("the escrow must be reversed after a failed issue, balance=%d", f.balance(c))
	}
}

// ─── 4. cancelled seats can be re-sold ───────────────────────────────────────

func TestLiveDB_Bus_CancelledSeatCanBeRebookedButTwoActiveCannot(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	a, b, c := f.user(2_000_000), f.user(2_000_000), f.user(2_000_000)
	tkA := f.mustBook(a, sched, 4, "rb-a-"+a)
	if _, err := f.cancel(str(tkA, "id"), a); err != nil {
		t.Fatal(err)
	}
	f.mustBook(b, sched, 4, "rb-b-"+b) // the freed seat re-sells
	if _, err := f.book(c, sched, 4, "rb-c-"+c); codeOf(err) != CodeSeatTaken {
		t.Fatalf("two ACTIVE tickets on one seat must still be refused, got %v", err)
	}
	var active int
	_ = f.pool.QueryRow(f.ctx, `SELECT COUNT(*) FROM bus_tickets WHERE schedule_id=$1 AND seat_number=4 AND status NOT IN ('cancelled','refunded')`, sched).Scan(&active)
	if active != 1 {
		t.Fatalf("exactly one active ticket per seat, got %d", active)
	}
	m, err := f.svc.BusSeatMap(f.ctx, sched)
	if err != nil || m["fare_kobo"] != testFare {
		t.Fatalf("seat map must carry the server fare: %v %v", m, err)
	}
}

// ─── 5. booking guards ───────────────────────────────────────────────────────

func TestLiveDB_Bus_BookingGuards(t *testing.T) {
	f := newBusFx(t).deferred()
	rider := f.user(5_000_000)
	ok := f.verifiedRoute()

	soon := f.schedule(ok.RouteID, time.Now().Add(5*time.Minute), 10, testFare)
	if _, err := f.book(rider, soon, 1, "g1-"+rider); codeOf(err) != CodeBookingClosed {
		t.Fatalf("departure inside the min lead must be refused, got %v", err)
	}
	past := f.schedule(ok.RouteID, time.Now().Add(-1*time.Hour), 10, testFare)
	if _, err := f.book(rider, past, 1, "g2-"+rider); codeOf(err) != CodeBookingClosed {
		t.Fatalf("a past departure must be refused, got %v", err)
	}
	for _, c := range []struct{ ver, st string }{{"pending", "active"}, {"suspended", "inactive"}, {"verified", "inactive"}} {
		r := f.provider(c.ver, c.st)
		s := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
		if _, err := f.book(rider, s, 1, "g3-"+c.ver+c.st+rider); codeOf(err) != CodeProviderUnavailable {
			t.Fatalf("provider %s/%s must not be bookable, got %v", c.ver, c.st, err)
		}
	}
	cancelled := f.schedule(ok.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET status='cancelled' WHERE id=$1`, cancelled)
	if _, err := f.book(rider, cancelled, 1, "g4-"+rider); codeOf(err) != CodeInvalidState {
		t.Fatalf("cancelled schedule must be refused, got %v", err)
	}
	unapproved := f.schedule(ok.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET fare_approved=FALSE WHERE id=$1`, unapproved)
	if _, err := f.book(rider, unapproved, 1, "g5-"+rider); codeOf(err) != "FARE_NOT_APPROVED" {
		t.Fatalf("unapproved fare must be refused, got %v", err)
	}
	good := f.schedule(ok.RouteID, time.Now().Add(72*time.Hour), 3, testFare)
	if _, err := f.book(rider, good, 4, "g6-"+rider); codeOf(err) != "INVALID_SEAT" {
		t.Fatalf("seat > capacity must be refused, got %v", err)
	}
	if f.balance(rider) != 5_000_000 {
		t.Fatalf("no refused booking may move money, balance=%d", f.balance(rider))
	}
}

// ─── 6. boarding validation ──────────────────────────────────────────────────

func TestLiveDB_Bus_ValidateWindowAndStates(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(5_000_000)
	tk := f.mustBook(rider, sched, 1, "val-"+rider)
	qr := str(tk, "qrCode")

	// Days before departure: boarding not open.
	if _, err := f.svc.ValidateBusTicket(f.ctx, r.OwnerID, qr); codeOf(err) != CodeInvalidState {
		t.Fatalf("scan 72h early must be refused, got %v", err)
	}
	// Wrong operator.
	if _, err := f.svc.ValidateBusTicket(f.ctx, rider, qr); codeOf(err) != CodeForbidden {
		t.Fatalf("non-operator must be forbidden, got %v", err)
	}
	// 2h before departure: inside the window.
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET departure_time=NOW()+INTERVAL '2 hours' WHERE id=$1`, sched)
	if _, err := f.svc.ValidateBusTicket(f.ctx, r.OwnerID, qr); err != nil {
		t.Fatalf("scan inside the window must work: %v", err)
	}
	if _, err := f.svc.ValidateBusTicket(f.ctx, r.OwnerID, qr); err == nil {
		t.Fatalf("a boarded ticket must not validate twice")
	}
	// A cancelled ticket is never valid, even inside the window.
	tk2 := f.mustBook(rider, sched, 2, "val2-"+rider)
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_tickets SET payout_state='held' WHERE id=$1`, str(tk2, "id"))
	if _, err := f.svc.ValidateBusTicket(f.ctx, r.OwnerID, str(tk2, "qrCode")); err != nil {
		t.Fatalf("second ticket should validate: %v", err)
	}
	tk3 := f.mustBook(rider, sched, 3, "val3-"+rider)
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET departure_time=NOW()+INTERVAL '3 days' WHERE id=$1`, sched)
	if _, err := f.cancel(str(tk3, "id"), rider); err != nil {
		t.Fatal(err)
	}
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET departure_time=NOW()+INTERVAL '2 hours' WHERE id=$1`, sched)
	if _, err := f.svc.ValidateBusTicket(f.ctx, r.OwnerID, str(tk3, "qrCode")); err == nil {
		t.Fatalf("a cancelled/refunded ticket must never validate")
	}
	// After the window (end + grace) it is closed.
	tk4 := f.mustBook(rider, f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare), 1, "val4-"+rider)
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET departure_time=NOW()-INTERVAL '30 hours' WHERE id=$1`, str(tk4, "scheduleId"))
	if _, err := f.svc.ValidateBusTicket(f.ctx, r.OwnerID, str(tk4, "qrCode")); codeOf(err) != CodeInvalidState {
		t.Fatalf("scan after the window must be refused, got %v", err)
	}
}

// ─── 7. schedule cancel + lifecycle ──────────────────────────────────────────

func TestLiveDB_Bus_ScheduleCancelRefundsEscrowedAndFlagsPaidOutIdempotently(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	u1, u2, u3 := f.user(2_000_000), f.user(2_000_000), f.user(2_000_000)
	t1 := f.mustBook(u1, sched, 1, "sc1-"+u1)
	f.mustBook(u2, sched, 2, "sc2-"+u2)
	// u3 holds a LEGACY-style ticket whose fare was already paid out.
	t3 := f.mustBook(u3, sched, 3, "sc3-"+u3)
	if ok, err := f.svc.settleBusTicket(f.ctx, str(t3, "id")); err != nil || !ok {
		t.Fatalf("pre-settle u3: %v %v", ok, err)
	}

	stranger := f.user(0)
	if _, err := f.svc.CancelProviderSchedule(f.ctx, stranger, sched, "x"); codeOf(err) != CodeForbidden {
		t.Fatalf("non-provider must be 403, got %v", err)
	}
	other := f.verifiedRoute()
	if _, err := f.svc.CancelProviderSchedule(f.ctx, other.OwnerID, sched, "x"); codeOf(err) != CodeForbidden {
		t.Fatalf("another provider must be 403, got %v", err)
	}

	res, err := f.svc.CancelProviderSchedule(f.ctx, r.OwnerID, sched, "bus broke down")
	if err != nil {
		t.Fatalf("cancel schedule: %v", err)
	}
	if res.Refunded != 2 || res.ManualRequired != 1 || res.Pending != 0 || res.Failed != 0 || !res.Complete || res.TicketsTotal != 3 {
		t.Fatalf("unexpected summary %+v", res)
	}
	if f.balance(u1) != 2_000_000 || f.balance(u2) != 2_000_000 {
		t.Fatalf("escrowed riders must be made whole")
	}
	if f.balance(u3) != 2_000_000-testFare {
		t.Fatalf("a paid-out rider must NOT be reported/credited as refunded")
	}
	status, payment, refund, _ := f.ticketRow(str(t3, "id"))
	if status != "cancelled" || payment != "paid" || refund != RefundManualRequired {
		t.Fatalf("paid-out ticket must be manual_required, not refunded: %s/%s/%s", status, payment, refund)
	}
	// Idempotent / resumable: a second call changes nothing and reports the same truth.
	res2, err := f.svc.CancelProviderSchedule(f.ctx, r.OwnerID, sched, "again")
	if err != nil || *res2 != *res {
		t.Fatalf("repeat must be identical: %+v vs %+v (%v)", res2, res, err)
	}
	if f.balance(u1) != 2_000_000 {
		t.Fatalf("repeat double-credited")
	}
	var sstatus string
	_ = f.pool.QueryRow(f.ctx, `SELECT status FROM bus_schedules WHERE id=$1`, sched).Scan(&sstatus)
	if sstatus != "cancelled" {
		t.Fatalf("schedule must be cancelled, got %s", sstatus)
	}
	if _, err := f.book(f.user(2_000_000), sched, 5, "sc-after"); codeOf(err) != CodeInvalidState {
		t.Fatalf("a cancelled schedule cannot be booked, got %v", err)
	}
	_ = t1

	// A departed schedule cannot be cancelled.
	dep := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET status='departed' WHERE id=$1`, dep)
	if _, err := f.svc.CancelProviderSchedule(f.ctx, r.OwnerID, dep, "x"); codeOf(err) != CodeInvalidState {
		t.Fatalf("departed schedule: want 409, got %v", err)
	}
}

func TestLiveDB_Bus_LifecycleSweeperAdvancesStates(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	boarded, noshow := f.user(2_000_000), f.user(2_000_000)
	tb := f.mustBook(boarded, sched, 1, "lc1-"+boarded)
	tn := f.mustBook(noshow, sched, 2, "lc2-"+noshow)
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET departure_time=NOW()+INTERVAL '1 hour' WHERE id=$1`, sched)
	if _, err := f.svc.ValidateBusTicket(f.ctx, r.OwnerID, str(tb, "qrCode")); err != nil {
		t.Fatal(err)
	}
	// Departed.
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET departure_time=NOW()-INTERVAL '1 hour' WHERE id=$1`, sched)
	if _, err := f.svc.AdvanceBusLifecycle(f.ctx); err != nil {
		t.Fatal(err)
	}
	var st string
	_ = f.pool.QueryRow(f.ctx, `SELECT status FROM bus_schedules WHERE id=$1`, sched).Scan(&st)
	if st != "departed" {
		t.Fatalf("schedule should be departed, got %s", st)
	}
	// Still inside the boarding window: nobody is a no-show yet.
	if s, _, bs := f.ticketLifecycle(str(tn, "id")); bs != "issued" || s != "issued" {
		t.Fatalf("no-show must wait for the window to close: %s/%s", s, bs)
	}
	// Completed (end + grace passed).
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET departure_time=NOW()-INTERVAL '26 hours' WHERE id=$1`, sched)
	if _, err := f.svc.AdvanceBusLifecycle(f.ctx); err != nil {
		t.Fatal(err)
	}
	_ = f.pool.QueryRow(f.ctx, `SELECT status FROM bus_schedules WHERE id=$1`, sched).Scan(&st)
	if st != "completed" {
		t.Fatalf("schedule should be completed, got %s", st)
	}
	if s, _, bs := f.ticketLifecycle(str(tb, "id")); s != "completed" || bs != "boarded" {
		t.Fatalf("boarded ticket should be completed: %s/%s", s, bs)
	}
	if _, _, bs := f.ticketLifecycle(str(tn, "id")); bs != "no_show" {
		t.Fatalf("never-boarded ticket should be no_show, got %s", bs)
	}
	// A no-show cannot be cancelled for a refund.
	if _, err := f.cancel(str(tn, "id"), noshow); err == nil {
		t.Fatalf("a no-show must not be cancellable")
	}
	// NOTE: RateBusTrip additionally needs mode_ratings to accept mode='bus'; today the
	// DB CHECK only allows parcel/towing/mover (separate pre-existing defect, see ADR).
}

func (f *busFx) ticketLifecycle(id string) (status, payment, boarding string) {
	f.t.Helper()
	if err := f.pool.QueryRow(f.ctx, `SELECT status, payment_status, boarding_status FROM bus_tickets WHERE id=$1`, id).
		Scan(&status, &payment, &boarding); err != nil {
		f.t.Fatal(err)
	}
	return
}

// ─── event transport bookings ────────────────────────────────────────────────

func (f *busFx) eventOffer(organizer string, capacity int, fare int64) string {
	f.t.Helper()
	var id string
	if err := f.pool.QueryRow(f.ctx, `
		INSERT INTO event_transport_offers (organizer_id, type, title, capacity, fare_kobo, status)
		VALUES ($1,'shuttle','Fixture shuttle',$2,$3,'open') RETURNING id`, organizer, capacity, fare).Scan(&id); err != nil {
		f.t.Fatal(err)
	}
	f.t.Cleanup(func() {
		c := context.Background()
		_, _ = f.pool.Exec(c, `DELETE FROM event_transport_bookings WHERE offer_id=$1`, id)
		_, _ = f.pool.Exec(c, `DELETE FROM event_transport_offers WHERE id=$1`, id)
	})
	return id
}

func TestLiveDB_Event_CancelOfSettledBookingGoesToManualRefundNotFaked(t *testing.T) {
	f := newBusFx(t)
	org := f.user(0)
	offer := f.eventOffer(org, 5, 300_000)
	rider := f.user(2_000_000)
	bk, err := f.svc.BookEventTransport(f.ctx, rider, offer, EventBookRequest{Seats: 1}, "ev-"+rider)
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	id := str(bk, "id")
	after := f.balance(rider)
	res, err := f.svc.CancelEventBooking(f.ctx, id, rider, "x")
	if err != nil || res.RefundStatus != RefundManualRequired || res.RefundedKobo != 0 {
		t.Fatalf("settled booking must be cancelled with manual_required, never refunded: %+v %v", res, err)
	}
	var status, refund string
	var booked int
	_ = f.pool.QueryRow(f.ctx, `SELECT status, refund_status FROM event_transport_bookings WHERE id=$1`, id).Scan(&status, &refund)
	_ = f.pool.QueryRow(f.ctx, `SELECT booked_count FROM event_transport_offers WHERE id=$1`, offer).Scan(&booked)
	if status != "cancelled" || refund != RefundManualRequired || booked != 0 || f.balance(rider) != after {
		t.Fatalf("state wrong: %s/%s booked=%d balance=%d", status, refund, booked, f.balance(rider))
	}
	var audits int
	_ = f.pool.QueryRow(f.ctx, `SELECT COUNT(*) FROM transport_audit_log WHERE entity_id=$1 AND action='event.cancelled_manual_refund_required'`, id).Scan(&audits)
	if audits != 1 {
		t.Fatalf("ops audit event expected, got %d", audits)
	}
	// Repeat is idempotent and does not re-audit.
	if r2, err := f.svc.CancelEventBooking(f.ctx, id, rider, "x"); err != nil || r2.RefundStatus != RefundManualRequired {
		t.Fatalf("repeat: %+v %v", r2, err)
	}
}

func TestLiveDB_Event_CancelRefundsWhenFareStillEscrowed(t *testing.T) {
	f := newBusFx(t)
	org := f.user(0)
	offer := f.eventOffer(org, 5, 300_000)
	rider := f.user(2_000_000)
	restore := f.failSettleFor(rider)
	if _, err := f.svc.BookEventTransport(f.ctx, rider, offer, EventBookRequest{Seats: 2}, "ev2-"+rider); err == nil {
		t.Fatalf("settle failure expected")
	}
	restore()
	var id string
	_ = f.pool.QueryRow(f.ctx, `SELECT id::text FROM event_transport_bookings WHERE idempotency_key=$1`, "ev2-"+rider).Scan(&id)
	if id == "" || f.balance(rider) != 2_000_000-600_000 {
		t.Fatalf("booking must exist with the fare escrowed (balance %d)", f.balance(rider))
	}
	res, err := f.svc.CancelEventBooking(f.ctx, id, rider, "x")
	if err != nil || res.RefundStatus != RefundRefunded || res.RefundedKobo != 600_000 {
		t.Fatalf("escrowed event booking must refund: %+v %v", res, err)
	}
	var status, refund string
	var booked int
	_ = f.pool.QueryRow(f.ctx, `SELECT status, refund_status FROM event_transport_bookings WHERE id=$1`, id).Scan(&status, &refund)
	_ = f.pool.QueryRow(f.ctx, `SELECT booked_count FROM event_transport_offers WHERE id=$1`, offer).Scan(&booked)
	if status != "refunded" || refund != RefundRefunded || booked != 0 || f.balance(rider) != 2_000_000 {
		t.Fatalf("state after refund wrong: %s/%s booked=%d balance=%d", status, refund, booked, f.balance(rider))
	}
}
