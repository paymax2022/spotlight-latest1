package paystackcheckout

// Second ledger-audit round (ADR-PR522-mobility-card-direct, "Resolved after
// ledger audit — round 2"): engine-level pins. L-a (a Book that failed on a
// deadline / cancellation proves nothing), L-d (a zero quote is a coded 4xx),
// M2 (the reconciler drives refunds of cancelled-but-still-escrowed bookings).

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"spotlight/backend/internal/transport"
)

// ── L-a ─────────────────────────────────────────────────────────────────────

func TestConfirm_BookTimedOutOrCancelled_IsTreatedLikeAFindError_NoRefund_LeftProcessing(t *testing.T) {
	for name, cause := range map[string]error{
		"deadline": fmt.Errorf("insert towing job: %w", context.DeadlineExceeded),
		"canceled": fmt.Errorf("escrow: %w", context.Canceled),
	} {
		t.Run(name, func(t *testing.T) {
			r := newRig()
			ref := paid(t, r)
			r.d.bookErr = cause
			r.d.findFound = false // Find says "no booking" — but a timed-out Book may still have committed
			if _, err := r.e.OnChargeSuccess(context.Background(), ref, ref); err == nil {
				t.Fatal("want an error (retry later)")
			}
			if len(r.gw.refundCalls) != 0 {
				t.Fatal("REFUNDED A CHARGE WHOSE BOOK ONLY TIMED OUT — the booking may have committed")
			}
			if rec := status(t, r, ref); rec.Status != StatusProcessing {
				t.Errorf("status %q, want processing (the idempotent stale-claim retry converges)", rec.Status)
			}
			// the idempotent retry converges once Book works again
			r.d.bookErr = nil
			aged(r, 3*time.Minute)
			res, err := r.e.OnChargeSuccess(context.Background(), ref, ref)
			if err != nil || res.Status != StatusConfirmed {
				t.Fatalf("retry = %+v, %v; want confirmed", res, err)
			}
			if len(r.gw.refundCalls) != 0 {
				t.Error("a refund appeared on the retry path")
			}
		})
	}
}

// ── L-d ─────────────────────────────────────────────────────────────────────

func TestInitiate_NonPositiveQuote_IsACoded4xx_NothingPersisted(t *testing.T) {
	for _, q := range []int64{0, -5} {
		r := newRig()
		r.d.quote = q
		_, err := r.initiate(t, "u1", key1, `{}`)
		ce, ok := errors.AsType[*transport.CodedError](err)
		if !ok {
			t.Fatalf("quote %d: want a *transport.CodedError (a 4xx the client can act on, not a 500), got %T %v", q, err, err)
		}
		if ce.Status < 400 || ce.Status > 499 || ce.Code == "" {
			t.Errorf("quote %d: status=%d code=%q, want a coded 4xx", q, ce.Status, ce.Code)
		}
		if len(r.st.byRef) != 0 || len(r.gw.initCalls) != 0 {
			t.Errorf("quote %d: nothing may be persisted or sent to the gateway", q)
		}
	}
}

func TestHTTP_Initiate_ZeroQuote_Answers4xxNot500(t *testing.T) {
	r := newRig()
	r.d.quote = 0
	_, err := r.initiate(t, "u1", key1, `{}`)
	ce, ok := errors.AsType[*transport.CodedError](err)
	if !ok || ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("zero quote error = %v, want coded 422", err)
	}
}

// ── M2: reconcile drives refunds of cancelled, still-escrowed bookings ───────

type sweepDomain struct {
	*fakeDomain
	calls   int32
	minAges []time.Duration
	out     CancelSweepResult
	err     error
}

func (d *sweepDomain) SweepCancelledRefunds(_ context.Context, minAge time.Duration, _ int) (CancelSweepResult, error) {
	atomic.AddInt32(&d.calls, 1)
	d.minAges = append(d.minAges, minAge)
	return d.out, d.err
}

func TestReconcile_DrivesTheCancelledButStillEscrowedSweepOfEveryDomainThatHasOne(t *testing.T) {
	ev := &events{}
	st := newFakeStore()
	st.ev = ev
	d := &sweepDomain{fakeDomain: &fakeDomain{quote: 250_000, bookedID: "ent-1", ev: ev}, out: CancelSweepResult{Completed: 2, Failed: 1}}
	e := NewEngine(&fakeGW{ev: ev}, st, &fakeLedger{ev: ev})
	e.Register(d)

	stats, err := e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if d.calls != 1 || d.minAges[0] != 5*time.Minute {
		t.Errorf("sweep calls=%d minAges=%v, want one call with the sweeper's min age (never racing a live cancel)", d.calls, d.minAges)
	}
	if stats.CancelRefundsCompleted != 2 || stats.CancelRefundsFailed != 1 {
		t.Errorf("stats %+v, want 2 completed / 1 failed", stats)
	}
}

func TestReconcile_CancelSweepError_IsCountedNotFatal_OtherStepsStillRun(t *testing.T) {
	ev := &events{}
	st := newFakeStore()
	st.ev = ev
	d := &sweepDomain{fakeDomain: &fakeDomain{quote: 250_000, bookedID: "ent-1", ev: ev}, err: errors.New("db down")}
	e := NewEngine(&fakeGW{ev: ev}, st, &fakeLedger{ev: ev})
	e.Register(d)
	stats, err := e.Reconcile(context.Background(), time.Minute, time.Hour)
	if err != nil {
		t.Fatalf("a failing domain sweep must not abort the reconcile: %v", err)
	}
	if stats.Errors != 1 {
		t.Errorf("stats %+v, want the failure counted as an error", stats)
	}
}
