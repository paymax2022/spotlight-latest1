package transport

import (
	"testing"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// manualRequiredTicket books + pays out a ticket, then cancels its schedule so the
// ticket lands in refund_status='manual_required'.
func (f *busFx) manualRequiredTicket(r busRoute, rider string) string {
	f.t.Helper()
	sched := f.schedule(r.RouteID, time.Now().Add(72*time.Hour), 10, testFare)
	tk := f.mustBook(rider, sched, 1, "mr-"+rider)
	if ok, err := f.svc.settleBusTicket(f.ctx, str(tk, "id")); err != nil || !ok {
		f.t.Fatalf("settle: %v %v", ok, err)
	}
	if _, err := f.svc.CancelProviderSchedule(f.ctx, r.OwnerID, sched, "breakdown"); err != nil {
		f.t.Fatalf("cancel schedule: %v", err)
	}
	if _, _, refund, _ := f.ticketRow(str(tk, "id")); refund != RefundManualRequired {
		f.t.Fatalf("want manual_required, got %s", refund)
	}
	return str(tk, "id")
}

func TestLiveDB_BusManualRefund_WalletRefundReversesLegsOnceAndReplays(t *testing.T) {
	f := newBusFx(t).deferred()
	admin := NewAdminService(f.svc)
	adminID := f.user(0)
	r := f.verifiedRoute()
	rider := f.user(2_000_000)
	id := f.manualRequiredTicket(r, rider)
	opPaid := f.balance(r.OwnerID)
	if f.balance(rider) != 2_000_000-testFare || opPaid <= 0 {
		t.Fatalf("precondition: rider=%d operator=%d", f.balance(rider), opPaid)
	}

	if _, err := admin.ResolveManualBusRefund(f.ctx, adminID, id, "", BusManualRefundRequest{Method: "wallet_refund", Reason: "r"}); codeOf(err) != "MISSING_IDEMPOTENCY_KEY" {
		t.Fatalf("missing key must be refused, got %v", err)
	}
	res, err := admin.ResolveManualBusRefund(f.ctx, adminID, id, "k1", BusManualRefundRequest{Method: "wallet_refund", Reason: "ops"})
	if err != nil || res.RefundStatus != RefundRefunded || res.Replayed {
		t.Fatalf("resolve: %+v %v", res, err)
	}
	if f.balance(rider) != 2_000_000 || f.balance(r.OwnerID) != 0 {
		t.Fatalf("rider must be whole and operator share reversed: rider=%d operator=%d", f.balance(rider), f.balance(r.OwnerID))
	}
	// Replay (same or new key, even another method) changes nothing.
	for _, req := range []BusManualRefundRequest{{Method: "wallet_refund", Reason: "again"}, {Method: "offline", Reason: "x", Reference: "B1"}} {
		res2, err := admin.ResolveManualBusRefund(f.ctx, adminID, id, "k2", req)
		if err != nil || !res2.Replayed || res2.RefundStatus != RefundRefunded {
			t.Fatalf("replay: %+v %v", res2, err)
		}
	}
	if f.balance(rider) != 2_000_000 {
		t.Fatalf("replay double-credited: %d", f.balance(rider))
	}
	_, payment, refund, _ := f.ticketRow(id)
	if payment != "refunded" || refund != RefundRefunded {
		t.Fatalf("ticket not finalized: %s/%s", payment, refund)
	}
}

func TestLiveDB_BusManualRefund_InsufficientOperatorStaysQueuedThenOffline(t *testing.T) {
	f := newBusFx(t).deferred()
	admin := NewAdminService(f.svc)
	adminID := f.user(0)
	r := f.verifiedRoute()
	rider := f.user(2_000_000)
	id := f.manualRequiredTicket(r, rider)

	// Operator withdraws everything.
	rev, err := f.led.GetOrCreateStandingAccount(f.ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.led.Debit(f.ctx, r.OwnerID, "drain", "drain-"+r.OwnerID, rev.ID, f.balance(r.OwnerID)); err != nil {
		t.Fatalf("drain operator: %v", err)
	}
	riderBefore := f.balance(rider)
	if _, err := admin.ResolveManualBusRefund(f.ctx, adminID, id, "k1", BusManualRefundRequest{Method: "wallet_refund", Reason: "r"}); codeOf(err) != "OPERATOR_INSUFFICIENT_FUNDS" {
		t.Fatalf("want OPERATOR_INSUFFICIENT_FUNDS, got %v", err)
	}
	if f.balance(rider) != riderBefore {
		t.Fatalf("no money may move on a refused provider leg")
	}
	if _, _, refund, _ := f.ticketRow(id); refund != RefundManualRequired {
		t.Fatalf("ticket must stay queued, got %s", refund)
	}
	// A fresh wallet claim locks out an offline resolve...
	if _, err := admin.ResolveManualBusRefund(f.ctx, adminID, id, "k2", BusManualRefundRequest{Method: "offline", Reason: "r", Reference: "BANK-9"}); codeOf(err) != "METHOD_LOCKED" {
		t.Fatalf("want METHOD_LOCKED, got %v", err)
	}
	// ...until it is stale with no leg posted.
	_, _ = f.pool.Exec(f.ctx, `UPDATE bus_tickets SET manual_refund_claimed_at=NOW()-INTERVAL '10 minutes' WHERE id=$1`, id)
	res, err := admin.ResolveManualBusRefund(f.ctx, adminID, id, "k3", BusManualRefundRequest{Method: "offline", Reason: "paid by transfer", Reference: "BANK-9"})
	if err != nil || res.RefundStatus != RefundRefunded || res.Method == nil {
		t.Fatalf("offline resolve: %+v %v", res, err)
	}
	if f.balance(rider) != riderBefore {
		t.Fatalf("offline resolve must not move ledger money")
	}

	q, err := admin.ListBusTicketsAdmin(f.ctx, BusAdminTicketFilter{Query: id})
	if err != nil || q["total"] != 1 {
		t.Fatalf("search by id: %+v %v", q, err)
	}
}

func TestLiveDB_BusManualRefund_QueueListsManualRequired(t *testing.T) {
	f := newBusFx(t).deferred()
	admin := NewAdminService(f.svc)
	r := f.verifiedRoute()
	id := f.manualRequiredTicket(r, f.user(2_000_000))
	page, err := admin.ListManualBusRefunds(f.ctx, 30, 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, tk := range page["tickets"].([]busAdminTicket) {
		if tk.ID == id {
			return
		}
	}
	t.Fatalf("manual_required ticket %s missing from queue", id)
}
