package paystackcheckout

// H1 — stale-claim takeover must be FENCED. A confirmer that stalls past
// staleClaimAfter (slow Book, GC pause, partitioned from the DB) loses its claim
// to a successor; when it wakes it must not be able to overwrite the
// successor's state or a terminal state, and must not issue a second gateway
// refund. Pure here (fenced fake store); the same contract is proven in SQL by
// TestLiveDB_PGStore_FenceStopsStaleOwner.

import (
	"context"
	"errors"
	"testing"
	"time"

	"spotlight/backend/internal/provider"
)

func TestFence_StaleOwnerCannotOverwriteSuccessorsConfirmation(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	base := time.Now()
	r.st.now = func() time.Time { return base }

	var once bool
	r.d.bookedID = "ent-A"
	r.d.bookHook = func(context.Context) {
		if once {
			return
		}
		once = true
		// Owner A is now "stalled" inside Book. Time passes beyond the stale
		// window and owner B (a webhook retry) takes over and finishes first.
		r.st.now = func() time.Time { return base.Add(staleClaimAfter + time.Second) }
		r.d.mu.Lock()
		r.d.bookedID = "ent-B"
		r.d.mu.Unlock()
		if res, err := r.e.OnChargeSuccess(context.Background(), ref, ref); err != nil || res.Status != StatusConfirmed {
			t.Errorf("successor B should confirm: %+v %v", res, err)
		}
	}
	res, err := r.e.OnChargeSuccess(context.Background(), ref, ref)
	if err != nil {
		t.Fatalf("owner A: %v", err)
	}
	rec, _ := r.st.Get(context.Background(), ref)
	if rec.EntityID == nil || *rec.EntityID != "ent-B" {
		t.Fatalf("stale owner A overwrote the successor's confirmation: entity=%v", rec.EntityID)
	}
	if res.EntityID == nil || *res.EntityID != "ent-B" {
		t.Errorf("stale owner A must report the CURRENT state (ent-B), got %+v", res)
	}
}

func TestFence_StaleOwnerCannotRefundAfterSuccessorAlreadyRefunded(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	base := time.Now()
	r.st.now = func() time.Time { return base }

	var once bool
	r.d.bookErr = errors.New("insert failed") // A: Book fails, Find says "no booking" → A heads for a refund
	r.d.bookHook = func(context.Context) {
		if once {
			return
		}
		once = true
		r.st.now = func() time.Time { return base.Add(staleClaimAfter + time.Second) }
		// Successor B sees the charge as under-collected and refunds it.
		r.gw.mu.Lock()
		r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: 100_000, Currency: "NGN"}
		r.gw.mu.Unlock()
		_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	}
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)

	if n := len(r.gw.refundCalls); n != 1 {
		t.Fatalf("customer refunded %d times, want exactly 1 (the successor's); the stale owner must not refund again", n)
	}
	rec, _ := r.st.Get(context.Background(), ref)
	if rec.Status != StatusRefunded {
		t.Errorf("status %q: a stale owner overwrote a terminal state", rec.Status)
	}
}

func TestFence_BookRunsUnderBoundedContext(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	before := time.Now()
	if _, err := r.e.OnChargeSuccess(context.Background(), ref, ref); err != nil {
		t.Fatal(err)
	}
	if len(r.d.bookCtxDL) != 1 {
		t.Fatalf("Book ran without a deadline: a hung Book would outlive its claim and race its successor")
	}
	if left := r.d.bookCtxDL[0].Sub(before); left > staleClaimAfter/2+time.Second {
		t.Errorf("Book deadline %s away, want <= staleClaimAfter/2 (%s)", left, staleClaimAfter/2)
	}
}

func TestFence_RefundRunsUnderBoundedContext(t *testing.T) {
	r := newRig()
	ref := paid(t, r)
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: 1, Currency: "NGN"}
	var dl time.Time
	var ok bool
	r.gw.onRefund = func(string) {} // the ctx is observed through a ctx-aware hook below
	r.e.gateway = ctxProbeGW{r.gw, func(ctx context.Context) { dl, ok = ctx.Deadline() }}
	before := time.Now()
	_, _ = r.e.OnChargeSuccess(context.Background(), ref, ref)
	if !ok || dl.Sub(before) > staleClaimAfter/2+time.Second {
		t.Errorf("gateway refund ctx deadline ok=%v in %s, want <= %s", ok, dl.Sub(before), staleClaimAfter/2)
	}
}

type ctxProbeGW struct {
	*fakeGW
	probe func(context.Context)
}

func (g ctxProbeGW) RefundPayment(ctx context.Context, ref string, amt int64) (*provider.RefundResult, error) {
	g.probe(ctx)
	return g.fakeGW.RefundPayment(ctx, ref, amt)
}
