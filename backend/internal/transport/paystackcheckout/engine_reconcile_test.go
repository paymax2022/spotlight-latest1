package paystackcheckout

// H7 — nothing may be stranded. A webhook that never arrived, a confirmer that
// crashed mid-claim, or a refund that never completed is driven to a terminal
// state by the reconciliation sweeper, using only gateway-verified facts.

import (
	"context"
	"errors"
	"testing"
	"time"

	"spotlight/backend/internal/provider"
)

func aged(r *rig, d time.Duration) {
	r.st.now = func() time.Time { return time.Now().Add(d) }
}

func TestReconcile_PendingPaidChargeWithNoWebhook_IsConfirmed(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	aged(r, 10*time.Minute)
	st, err := r.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if rec := status(t, r, ref); rec.Status != StatusConfirmed {
		t.Fatalf("status %q: a paid, un-webhooked charge must be confirmed by the sweep", rec.Status)
	}
	if r.d.books != 1 || st.Confirmed != 1 {
		t.Errorf("books=%d stats=%+v", r.d.books, st)
	}
}

func TestReconcile_LeavesFreshAndUnpaidAlone(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	// fresh: younger than minAge → untouched (the webhook/poll is still racing)
	if _, err := r.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if r.d.books != 0 || status(t, r, ref).Status != StatusPending {
		t.Fatal("a fresh intent must not be swept")
	}
	// old but never paid (abandoned checkout): stays pending, nothing booked/refunded
	aged(r, time.Hour)
	r.gw.verify = &provider.PaymentStatus{Status: "abandoned", AmountKobo: 250_000}
	if _, err := r.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if r.d.books != 0 || len(r.gw.refundCalls) != 0 || status(t, r, ref).Status != StatusPending {
		t.Errorf("an unpaid checkout must stay pending: %s books=%d refunds=%d", status(t, r, ref).Status, r.d.books, len(r.gw.refundCalls))
	}
}

func TestReconcile_StaleProcessingClaim_IsDriven(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.d.bookErr, r.d.findErr = errors.New("db down"), errors.New("db down")
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref) // leaves 'processing'
	r.d.bookErr, r.d.findErr = nil, nil
	aged(r, 10*time.Minute)
	if _, err := r.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if rec := status(t, r, ref); rec.Status != StatusConfirmed {
		t.Fatalf("stale processing claim not driven: %q", rec.Status)
	}
}

func TestReconcile_StrandedAmountMismatch_RefundsTheCollectedAmount(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	underpaid(r)
	r.gw.refundErr = errors.New("paystack 500") // first attempt definitively fails → amount_mismatch, no refund
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	if rec := status(t, r, ref); rec.Status != StatusAmountMismatch || rec.RefundReference != nil {
		t.Fatalf("setup: %q %v", rec.Status, rec.RefundReference)
	}
	r.gw.refundErr = nil
	aged(r, 10*time.Minute)
	if _, err := r.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	rec := status(t, r, ref)
	if rec.Status != StatusRefunded || rec.RefundReference == nil {
		t.Fatalf("stranded mismatch not refunded: %q", rec.Status)
	}
	if last := r.gw.refundCalls[len(r.gw.refundCalls)-1]; last != 100_000 {
		t.Errorf("retry refunded %d, want the COLLECTED amount 100000 (not the frozen quote)", last)
	}
	if r.d.books != 0 {
		t.Error("a mismatched charge must never be booked by the sweep")
	}
}

func TestReconcile_StrandedOrderFailed_ReversesLedgerThenRefunds(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.d.bookErr = errors.New("insert failed")
	r.gw.refundErr = errors.New("paystack 500")
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	if rec := status(t, r, ref); rec.Status != StatusOrderFailed {
		t.Fatalf("setup: %q", rec.Status)
	}
	r.gw.refundErr = nil
	aged(r, 10*time.Minute)
	if _, err := r.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if rec := status(t, r, ref); rec.Status != StatusRefunded {
		t.Fatalf("stranded order_failed not refunded: %q", rec.Status)
	}
	if len(r.lg.byKey) < 2 {
		t.Errorf("the ledger unwind must be (re)asserted on the retry too: %v", r.lg.byKey)
	}
}

func TestReconcile_OrderFailedButABookingNowExists_IsNotRefunded(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.d.bookErr = errors.New("insert failed")
	r.gw.refundErr = errors.New("paystack 500")
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	// a booking for this charge turns out to exist: refunding would give a free service
	r.d.mu.Lock()
	r.d.booked, r.d.bookedID = true, "ent-late"
	r.d.mu.Unlock()
	r.gw.refundErr = nil
	calls := len(r.gw.refundCalls)
	aged(r, 10*time.Minute)
	_, _ = r.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour)
	if len(r.gw.refundCalls) != calls {
		t.Fatal("REFUNDED A CHARGE THAT BACKS A REAL BOOKING")
	}
	if rec := status(t, r, ref); rec.Status != StatusOrderFailed {
		t.Errorf("left for manual review as order_failed, got %q", rec.Status)
	}
}

func TestReconcile_AlreadyRefundedAndConfirmed_AreNotTouched(t *testing.T) {
	r := newRig()
	ref := confirmed(t, r)
	aged(r, 30*24*time.Hour)
	calls := len(r.gw.refundCalls)
	if _, err := r.e.Reconcile(context.Background(), time.Minute, 0); err != nil {
		t.Fatal(err)
	}
	if status(t, r, ref).Status != StatusConfirmed || len(r.gw.refundCalls) != calls || r.d.books != 1 {
		t.Error("confirmed intents are terminal for the sweeper")
	}
}

func TestReconcile_ConcurrentSweepers_RefundOnce(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	underpaid(r)
	r.gw.refundErr = errors.New("paystack 500")
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	r.gw.refundErr = nil
	aged(r, 10*time.Minute)
	done := make(chan struct{})
	for i := 0; i < 4; i++ {
		go func() { _, _ = r.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour); done <- struct{}{} }()
	}
	for i := 0; i < 4; i++ {
		<-done
	}
	// 1 from the failed first attempt + exactly 1 successful retry
	if n := len(r.gw.refundCalls); n != 2 {
		t.Errorf("gateway refund calls = %d, want 2 (1 failed + 1 retry): concurrent sweepers double-refunded", n)
	}
}
