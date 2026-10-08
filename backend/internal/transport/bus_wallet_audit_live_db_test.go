package transport

// Regression tests for the ledger-audit findings on the wallet bus fixes
// (H1, M1-M7, L1). See the "Resolved after ledger audit" table in the ADR.

import (
	"testing"
	"time"
)

// H1: the settlement is already refunded (out-of-band) while the ticket is still
// active. Cancel must CANCEL the ticket (invalidate the QR) - never report
// "refunded" while the ticket stays valid.
func TestLiveDB_Audit_H1_SettlementAlreadyRefundedStillCancelsTicket(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	tk := f.mustBook(rider, sched, 1, "h1-"+rider)
	id := str(tk, "id")
	_, _, _, sett := f.ticketRow(id)
	if err := f.svc.settlement.Refund(f.ctx, sett, "out_of_band"); err != nil {
		t.Fatal(err)
	}
	res, err := f.cancel(id, rider)
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	status, payment, refund, _ := f.ticketRow(id)
	if status != "cancelled" || payment != "refunded" || refund != RefundRefunded || res.RefundStatus != RefundRefunded {
		t.Fatalf("ticket must be cancelled+refunded, got %s/%s/%s res=%+v", status, payment, refund, res)
	}
	if f.balance(rider) != 2_000_000 {
		t.Fatalf("wallet should hold exactly one refund, got %d", f.balance(rider))
	}
	// Same through schedule cancel: must complete, not stay pending forever.
	sched2 := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	u2 := f.user(2_000_000)
	tk2 := f.mustBook(u2, sched2, 1, "h1b-"+u2)
	_, _, _, sett2 := f.ticketRow(str(tk2, "id"))
	if err := f.svc.settlement.Refund(f.ctx, sett2, "out_of_band"); err != nil {
		t.Fatal(err)
	}
	sum, err := f.svc.CancelProviderSchedule(f.ctx, r.OwnerID, sched2, "x")
	if err != nil || !sum.Complete || sum.Pending != 0 {
		t.Fatalf("schedule cancel must complete: %+v %v", sum, err)
	}
	if s2, _, _, _ := f.ticketRow(str(tk2, "id")); s2 != "cancelled" {
		t.Fatalf("ticket must be cancelled, got %s", s2)
	}
}

func TestLiveDB_Audit_H1_Event_SettlementAlreadyRefundedStillCancelsBooking(t *testing.T) {
	f := newBusFx(t)
	org := f.user(0)
	offer := f.eventOffer(org, 5, 300_000)
	rider := f.user(2_000_000)
	restore := f.failSettleFor(rider)
	_, _ = f.svc.BookEventTransport(f.ctx, rider, offer, EventBookRequest{Seats: 1}, "h1e-"+rider)
	restore()
	var id, sett string
	_ = f.pool.QueryRow(f.ctx, `SELECT id::text, settlement_id::text FROM event_transport_bookings WHERE idempotency_key=$1`, "h1e-"+rider).Scan(&id, &sett)
	if err := f.svc.settlement.Refund(f.ctx, sett, "out_of_band"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.CancelEventBooking(f.ctx, id, rider, "x"); err != nil {
		t.Fatal(err)
	}
	var status, refund string
	var booked int
	_ = f.pool.QueryRow(f.ctx, `SELECT status, refund_status FROM event_transport_bookings WHERE id=$1`, id).Scan(&status, &refund)
	_ = f.pool.QueryRow(f.ctx, `SELECT booked_count FROM event_transport_offers WHERE id=$1`, offer).Scan(&booked)
	if status != "refunded" || refund != RefundRefunded || booked != 0 {
		t.Fatalf("booking must be refunded and seats released: %s/%s booked=%d", status, refund, booked)
	}
}

// M1: a fresh 'releasing' claim must not be stolen by a second settler; a stale one may.
func TestLiveDB_Audit_M1_FreshReleasingClaimIsNotStolenStaleIs(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	tk := f.mustBook(rider, sched, 1, "m1-"+rider)
	id := str(tk, "id")
	_, _, _, sett := f.ticketRow(id)
	if _, err := f.pool.Exec(f.ctx, `UPDATE bus_tickets SET payout_state='releasing', payout_claimed_at=NOW() WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if ok, err := f.svc.settleBusTicket(f.ctx, id); ok || err != nil {
		t.Fatalf("a fresh claim must not be re-claimed: ok=%v err=%v", ok, err)
	}
	if f.settlementStatus(sett) != "escrowed" {
		t.Fatalf("settlement must still be escrowed")
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE bus_tickets SET payout_claimed_at=NOW()-INTERVAL '10 minutes' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if ok, err := f.svc.settleBusTicket(f.ctx, id); !ok || err != nil {
		t.Fatalf("a stale claim must be re-claimable: ok=%v err=%v", ok, err)
	}
}

// M1: cancelled ticket whose fare was nevertheless paid out => manual_required, never
// 'failed' forever.
func TestLiveDB_Audit_M1_RefundOfPaidOutTicketBecomesManualRequired(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	tk := f.mustBook(rider, sched, 1, "m1b-"+rider)
	id := str(tk, "id")
	if ok, err := f.svc.settleBusTicket(f.ctx, id); !ok || err != nil {
		t.Fatal(ok, err)
	}
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_tickets SET status='cancelled', refund_status='pending', cancelled_at=NOW()-INTERVAL '5 minutes' WHERE id=$1`, id)
	if _, err := f.svc.RetryOpenBusRefunds(f.ctx, 50); err != nil {
		t.Fatal(err)
	}
	_, payment, refund, _ := f.ticketRow(id)
	if refund != RefundManualRequired || payment != "paid" {
		t.Fatalf("want manual_required/paid, got %s/%s", refund, payment)
	}
	var n int
	_ = f.pool.QueryRow(f.ctx, `SELECT COUNT(*) FROM bus_tickets WHERE id=$1 AND refund_status IN ('pending','failed')`, id).Scan(&n)
	if n != 0 {
		t.Fatalf("must leave the retry queue")
	}
}

// M3: a settler must not pay out a ticket on a cancelled schedule.
func TestLiveDB_Audit_M3_SettleRefusesCancelledSchedule(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	tk := f.mustBook(rider, sched, 1, "m3-"+rider)
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET status='cancelled' WHERE id=$1`, sched)
	_, _, _, sett := f.ticketRow(str(tk, "id"))
	if ok, err := f.svc.settleBusTicket(f.ctx, str(tk, "id")); ok || err != nil {
		t.Fatalf("settle on a cancelled schedule must be a no-op: %v %v", ok, err)
	}
	if f.settlementStatus(sett) != "escrowed" {
		t.Fatalf("must stay escrowed")
	}
}

// M4: a provider cannot "cancel" a departed-by-the-clock schedule.
func TestLiveDB_Audit_M4_ProviderCannotCancelPastDeparture(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(-1*time.Hour), 10, testFare)
	if _, err := f.svc.CancelProviderSchedule(f.ctx, r.OwnerID, sched, "x"); codeOf(err) != CodeInvalidState {
		t.Fatalf("want 409 INVALID_STATE, got %v", err)
	}
	var st string
	_ = f.pool.QueryRow(f.ctx, `SELECT status FROM bus_schedules WHERE id=$1`, sched).Scan(&st)
	if st != "scheduled" {
		t.Fatalf("schedule must be untouched, got %s", st)
	}
}

// M5: the same raw key from two users must not collide on the shared settlement key.
func TestLiveDB_Audit_M5_CrossUserKeyCollisionIsIsolated(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	a, b := f.user(2_000_000), f.user(2_000_000)
	key := "shared-key-" + a
	tkA := f.mustBook(a, sched, 1, key)
	if _, err := f.book(b, sched, 2, key); codeOf(err) != CodeKeyConflict {
		t.Fatalf("B reusing A's key must conflict, got %v", err)
	}
	if f.balance(b) != 2_000_000 {
		t.Fatalf("B must not be charged")
	}
	if s, _, _, _ := f.ticketRow(str(tkA, "id")); s != "issued" {
		t.Fatalf("A's ticket must be intact")
	}
	// A settlement already bound to someone else under B's derived key is refused.
	kb := "kb-" + b
	var other string
	_ = f.pool.QueryRow(f.ctx, `SELECT id::text FROM settlements WHERE reference=$1`, "bus:"+str(tkA, "id")).Scan(&other)
	derived := "bus:" + busTicketIDForKey(b, kb)
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO settlements (reference, module_type, payer_id, total_kobo, status, idempotency_key, funding_source)
		VALUES ($1,'transport',$2,$3,'escrowed',$4,'wallet')`, "bus:"+busTicketIDForKey(b, kb), a, testFare, derived); err != nil {
		t.Fatal(err)
	}
	if _, err := f.book(b, sched, 3, kb); codeOf(err) != CodeKeyConflict {
		t.Fatalf("a settlement owned by another payer must be refused, got %v", err)
	}
}

// L1: replaying a key whose ticket was cancelled/refunded is a 409, not a 201 of a dead ticket.
func TestLiveDB_Audit_L1_ReplayOfCancelledTicketConflicts(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	key := "l1-" + rider
	tk := f.mustBook(rider, sched, 1, key)
	if _, err := f.cancel(str(tk, "id"), rider); err != nil {
		t.Fatal(err)
	}
	if _, err := f.book(rider, sched, 1, key); codeOf(err) != CodeKeyConflict {
		t.Fatalf("replay of a cancelled booking must be 409, got %v", err)
	}
}

// L1: ticket payload carries what the app needs to render a ticket.
func TestLiveDB_Audit_L1_TicketPayloadHasRouteAndOperator(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	tk := f.mustBook(rider, sched, 1, "l1p-"+rider)
	for _, k := range []string{"routeLabel", "operatorName", "originTerminal", "destTerminal", "arriveAt"} {
		if _, ok := tk[k]; !ok {
			t.Fatalf("payload missing %s: %v", k, tk)
		}
	}
	if tk["operatorName"] != "Fixture Coaches" || tk["routeLabel"] != "Lagos → Abuja" {
		t.Fatalf("wrong values: %v %v", tk["operatorName"], tk["routeLabel"])
	}
}

// L1: a nonsense arrival_estimate (before departure) must not complete a schedule early.
func TestLiveDB_Audit_L1_BadArrivalEstimateDoesNotCompleteEarly(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET status='departed', departure_time=NOW()-INTERVAL '2 hours', arrival_estimate=NOW()-INTERVAL '10 hours' WHERE id=$1`, sched)
	if _, err := f.svc.AdvanceBusLifecycle(f.ctx); err != nil {
		t.Fatal(err)
	}
	var st string
	_ = f.pool.QueryRow(f.ctx, `SELECT status FROM bus_schedules WHERE id=$1`, sched).Scan(&st)
	if st != "departed" {
		t.Fatalf("a bad arrival estimate must fall back to departure+24h; got %s", st)
	}
}

// M7: the earning records the platform cut FROZEN at booking, not the live config.
func TestLiveDB_Audit_M7_EarningUsesFrozenPlatformCut(t *testing.T) {
	f := newBusFx(t).deferred()
	rec := &fakeRecorder{}
	f.svc.SetCommissionRecorder(rec)
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	tk := f.mustBook(rider, sched, 1, "m7-"+rider)
	_, _ = f.pool.Exec(f.ctx, `UPDATE transport_commission_config SET provider_pct=0.5, platform_pct=0.5 WHERE tier='standard'`)
	t.Cleanup(func() {
		_, _ = f.pool.Exec(f.ctx, `UPDATE transport_commission_config SET provider_pct=0.8, platform_pct=0.2 WHERE tier='standard'`)
	})
	if ok, err := f.svc.settleBusTicket(f.ctx, str(tk, "id")); !ok || err != nil {
		t.Fatal(ok, err)
	}
	if len(rec.exact) != 1 || rec.exact[0][0] != testFare || rec.exact[0][1] != 100_000 {
		t.Fatalf("earning must be exact gross=%d platform=100000 (frozen 20%%), got %v", testFare, rec.exact)
	}
}

// M2: a worker whose deferred flag is OFF still drains due deferred tickets (and
// retries refunds) - the flag only controls creating new deferred tickets.
func TestLiveDB_Audit_M2_SweepDrainsDeferredEvenWithWorkerFlagOff(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	tk := f.mustBook(rider, sched, 1, "m2-"+rider)
	_, _, _, sett := f.ticketRow(str(tk, "id"))
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET departure_time=NOW()-INTERVAL '40 minutes' WHERE id=$1`, sched)
	f.svc.WithBusConfig(DefaultBusConfig()) // worker flag OFF
	settled, _, _, err := f.svc.RunBusSweep(f.ctx, false)
	if err != nil || settled < 1 || f.settlementStatus(sett) != "settled" {
		t.Fatalf("flag-off worker must still settle due deferred tickets: settled=%d err=%v st=%s", settled, err, f.settlementStatus(sett))
	}
}

// M3: the sweeper finishes active tickets stranded on a cancelled schedule.
func TestLiveDB_Audit_M3_SweeperRefundsStrandedTicketsOnCancelledSchedule(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	a, b := f.user(2_000_000), f.user(2_000_000)
	ta := f.mustBook(a, sched, 1, "m3a-"+a)
	tb := f.mustBook(b, sched, 2, "m3b-"+b)
	if ok, err := f.svc.settleBusTicket(f.ctx, str(tb, "id")); !ok || err != nil {
		t.Fatal(ok, err)
	}
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET status='cancelled' WHERE id=$1`, sched)
	if _, _, _, err := f.svc.RunBusSweep(f.ctx, false); err != nil {
		t.Fatal(err)
	}
	if _, _, ra, _ := f.ticketRow(str(ta, "id")); ra != RefundRefunded || f.balance(a) != 2_000_000 {
		t.Fatalf("escrowed stranded ticket must be refunded: %s bal=%d", ra, f.balance(a))
	}
	if _, pb, rb, _ := f.ticketRow(str(tb, "id")); rb != RefundManualRequired || pb != "paid" {
		t.Fatalf("paid-out stranded ticket must be manual_required: %s/%s", pb, rb)
	}
}

// M4: admin may override with force (audited); without it the past-departure cancel is refused.
func TestLiveDB_Audit_M4_AdminForceOverridesPastDeparture(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(-1*time.Hour), 10, testFare)
	adm := NewAdminService(f.svc)
	admin := f.user(0)
	if _, err := adm.CancelBusSchedule(f.ctx, admin, sched, "x", false); codeOf(err) != CodeInvalidState {
		t.Fatalf("no force: want 409, got %v", err)
	}
	if _, err := adm.CancelBusSchedule(f.ctx, admin, sched, "ops", true); err != nil {
		t.Fatalf("force: %v", err)
	}
	var st string
	var audits int
	_ = f.pool.QueryRow(f.ctx, `SELECT status FROM bus_schedules WHERE id=$1`, sched).Scan(&st)
	_ = f.pool.QueryRow(f.ctx, `SELECT COUNT(*) FROM transport_audit_log WHERE entity_id=$1 AND action='bus.schedule.cancelled'`, sched).Scan(&audits)
	if st != "cancelled" || audits != 1 {
		t.Fatalf("status=%s audits=%d", st, audits)
	}
}

// L1: orphan wallet escrows (no ticket) are reversed after 10 minutes; fresh ones and
// escrows owned by a ticket are left alone.
func TestLiveDB_Audit_L1_OrphanEscrowIsReversedOnlyWhenOldAndTicketless(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	orphanUser, freshUser, owned := f.user(2_000_000), f.user(2_000_000), f.user(2_000_000)
	mk := func(u string) string {
		id := busTicketIDForKey(u, "orph")
		s, err := f.svc.settlement.Escrow(f.ctx, u, "bus:"+id, "bus:"+id, "transport", testFare)
		if err != nil {
			t.Fatal(err)
		}
		return s.ID
	}
	oSett, fSett := mk(orphanUser), mk(freshUser)
	tk := f.mustBook(owned, sched, 1, "orph-owned-"+owned)
	_, _, _, ownedSett := f.ticketRow(str(tk, "id"))
	_, _ = f.pool.Exec(f.ctx, `UPDATE settlements SET escrowed_at=NOW()-INTERVAL '20 minutes' WHERE id = ANY($1::uuid[])`, []string{oSett, ownedSett})
	if _, _, _, err := f.svc.RunBusSweep(f.ctx, false); err != nil {
		t.Fatal(err)
	}
	if f.settlementStatus(oSett) != "refunded" || f.balance(orphanUser) != 2_000_000 {
		t.Fatalf("old orphan must be reversed: %s bal=%d", f.settlementStatus(oSett), f.balance(orphanUser))
	}
	if f.settlementStatus(fSett) != "escrowed" || f.settlementStatus(ownedSett) != "escrowed" {
		t.Fatalf("fresh orphan and ticket-owned escrow must be untouched")
	}
}

// L1: a disputed settlement is parked once for ops, not retried/logged forever.
func TestLiveDB_Audit_L1_DisputedSettlementIsParkedOnce(t *testing.T) {
	f := newBusFx(t).deferred()
	r := f.verifiedRoute()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	rider := f.user(2_000_000)
	tk := f.mustBook(rider, sched, 1, "disp-"+rider)
	id := str(tk, "id")
	_, _, _, sett := f.ticketRow(id)
	_, _ = f.pool.Exec(f.ctx, `UPDATE settlements SET status='disputed' WHERE id=$1`, sett)
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_schedules SET status='cancelled' WHERE id=$1`, sched)
	for i := 0; i < 3; i++ {
		if _, _, _, err := f.svc.RunBusSweep(f.ctx, false); err != nil {
			t.Fatal(err)
		}
	}
	_, _, refund, _ := f.ticketRow(id)
	var audits int
	_ = f.pool.QueryRow(f.ctx, `SELECT COUNT(*) FROM transport_audit_log WHERE entity_id=$1 AND action='bus.cancelled_manual_refund_required'`, id).Scan(&audits)
	if refund != RefundManualRequired || audits != 1 {
		t.Fatalf("want parked once: refund=%s audits=%d", refund, audits)
	}
}

// M6: event refunds pending/failed are retried by the sweep.
func TestLiveDB_Audit_M6_EventRefundRetriedBySweep(t *testing.T) {
	f := newBusFx(t)
	org := f.user(0)
	offer := f.eventOffer(org, 5, 300_000)
	rider := f.user(2_000_000)
	restore := f.failSettleFor(rider)
	_, _ = f.svc.BookEventTransport(f.ctx, rider, offer, EventBookRequest{Seats: 1}, "m6-"+rider)
	restore()
	var id string
	_ = f.pool.QueryRow(f.ctx, `SELECT id::text FROM event_transport_bookings WHERE idempotency_key=$1`, "m6-"+rider).Scan(&id)
	_, _ = f.pool.Exec(f.ctx, `UPDATE event_transport_bookings SET status='cancelled', refund_status='failed' WHERE id=$1`, id)
	if _, _, _, err := f.svc.RunBusSweep(f.ctx, false); err != nil {
		t.Fatal(err)
	}
	var st, rs string
	_ = f.pool.QueryRow(f.ctx, `SELECT status, refund_status FROM event_transport_bookings WHERE id=$1`, id).Scan(&st, &rs)
	if st != "refunded" || rs != RefundRefunded || f.balance(rider) != 2_000_000 {
		t.Fatalf("sweep must finish the refund: %s/%s bal=%d", st, rs, f.balance(rider))
	}
}
