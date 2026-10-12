package cryptosvc

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

type alerts struct{ got []string }

func (a *alerts) alert(kind, msg string) { a.got = append(a.got, kind+": "+msg) }

type reconRig struct {
	*svcRig
	rec *Reconciler
	al  *alerts
}

func newReconRig(t *testing.T) *reconRig {
	t.Helper()
	r := &reconRig{svcRig: newSvcRig(t), al: &alerts{}}
	r.rec = NewReconciler(ReconcilerConfig{
		Service: r.svc, Alert: r.al.alert, Leader: alwaysLeader{},
		ProcessingAfter: 20 * time.Second, ConfirmingAfter: 2 * time.Minute, QuotedGrace: time.Minute, Batch: 50,
	})
	r.led.fund(user, 5_000_000)
	return r
}

type alwaysLeader struct{}

func (alwaysLeader) TryLead(context.Context) (func(), bool, error) { return func() {}, true, nil }

type neverLeader struct{}

func (neverLeader) TryLead(context.Context) (func(), bool, error) { return func() {}, false, nil }

// confirmed returns a swap that the provider has accepted (state processing).
func (r *reconRig) confirmed(t *testing.T, key string) SwapRecord {
	t.Helper()
	q := r.quote(t, key, 1_000_000)
	got, err := r.svc.Confirm(context.Background(), user, q.ID)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func (r *reconRig) run(t *testing.T) ReconcileResult {
	t.Helper()
	res, err := r.rec.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	return res
}

func TestReconcilerSettlesAStaleProcessingSwapTheProviderFinished(t *testing.T) {
	r := newReconRig(t)
	sw := r.confirmed(t, "k")
	_ = r.prov.CompleteSwap(sw.ProviderSwapID, cryptoprov.SwapCompleted)
	r.store.age(sw.ID, r.now, 30*time.Second)
	res := r.run(t)
	if res.Resolved != 1 || r.state(t, sw.ID) != cryptoprov.SwapStateCompleted {
		t.Fatalf("res=%+v state=%s", res, r.state(t, sw.ID))
	}
	if r.led.bal(revenueK) != 7_500 {
		t.Fatalf("fee not recognised: %d", r.led.bal(revenueK))
	}
}

func TestReconcilerLeavesAFreshProcessingSwapAlone(t *testing.T) {
	r := newReconRig(t)
	sw := r.confirmed(t, "k")
	_ = r.prov.CompleteSwap(sw.ProviderSwapID, cryptoprov.SwapCompleted)
	r.store.age(sw.ID, r.now, 5*time.Second)
	if res := r.run(t); res.Resolved != 0 || r.state(t, sw.ID) != cryptoprov.SwapStateProcessing {
		t.Fatalf("a fresh swap was touched: %+v", res)
	}
}

func TestReconcilerReleasesAHoldThatNeverReachedTheProvider(t *testing.T) {
	r := newReconRig(t)
	q := r.quote(t, "k", 1_000_000)
	ctx := context.Background()
	_, _ = r.store.TransitionSwap(ctx, q.ID, cryptoprov.SwapStateQuoted, cryptoprov.SwapStateConfirming, decimal.Zero, "")
	_ = r.svc.cfg.Settler.HoldBuy(ctx, SwapLedgerInput{SwapID: q.ID, UserID: user, Side: SideBuy, NGNKobo: 1_000_000, FeeKobo: 7_500})
	r.store.age(q.ID, r.now, 3*time.Minute)

	res := r.run(t)
	if res.Released != 1 || r.state(t, q.ID) != cryptoprov.SwapStateFailed {
		t.Fatalf("res=%+v state=%s", res, r.state(t, q.ID))
	}
	if r.led.bal(walletK) != 5_000_000 || r.led.bal(clearK) != 0 {
		t.Fatalf("wallet=%d clearing=%d: user must be whole", r.led.bal(walletK), r.led.bal(clearK))
	}
	if r.prov.confirms != 0 {
		t.Fatal("the reconciler called the provider")
	}
}

func TestReconcilerParksAnAttemptedCallWithTheHoldKept(t *testing.T) {
	r := newReconRig(t)
	q := r.quote(t, "k", 1_000_000)
	ctx := context.Background()
	_, _ = r.store.TransitionSwap(ctx, q.ID, cryptoprov.SwapStateQuoted, cryptoprov.SwapStateConfirming, decimal.Zero, "")
	_ = r.svc.cfg.Settler.HoldBuy(ctx, SwapLedgerInput{SwapID: q.ID, UserID: user, Side: SideBuy, NGNKobo: 1_000_000, FeeKobo: 7_500})
	_, _ = r.store.MarkExecuteAttempt(ctx, q.ID)
	r.store.age(q.ID, r.now, 3*time.Minute)

	res := r.run(t)
	if res.Parked != 1 || r.state(t, q.ID) != cryptoprov.SwapStateNeedsReview {
		t.Fatalf("res=%+v state=%s", res, r.state(t, q.ID))
	}
	if r.led.bal(clearK) != 1_007_500 || r.prov.confirms != 0 {
		t.Fatalf("hold released or provider called: clearing=%d confirms=%d", r.led.bal(clearK), r.prov.confirms)
	}
	if len(r.al.got) == 0 {
		t.Fatal("a parked swap with money held raised no alert")
	}
}

func TestReconcilerResolvesAConfirmingSwapThatHasAProviderID(t *testing.T) {
	r := newReconRig(t)
	sw := r.confirmed(t, "k")
	ctx := context.Background()
	// Crash simulation: provider id recorded, but the processing transition was lost.
	r.store.mu.Lock()
	r.store.swaps[sw.ID].State = cryptoprov.SwapStateConfirming
	r.store.mu.Unlock()
	_ = r.prov.CompleteSwap(sw.ProviderSwapID, cryptoprov.SwapCompleted)
	r.store.age(sw.ID, r.now, 3*time.Minute)
	_ = ctx
	if res := r.run(t); res.Resolved != 1 || r.state(t, sw.ID) != cryptoprov.SwapStateCompleted {
		t.Fatalf("res=%+v state=%s", res, r.state(t, sw.ID))
	}
}

func TestReconcilerLeavesAYoungConfirmingSwapForItsOwnConfirm(t *testing.T) {
	r := newReconRig(t)
	q := r.quote(t, "k", 1_000_000)
	_, _ = r.store.TransitionSwap(context.Background(), q.ID, cryptoprov.SwapStateQuoted, cryptoprov.SwapStateConfirming, decimal.Zero, "")
	r.store.age(q.ID, r.now, 30*time.Second)
	if res := r.run(t); res.Released+res.Parked+res.Resolved != 0 {
		t.Fatalf("touched a swap that a live confirm may still own: %+v", res)
	}
}

func TestReconcilerExpiresAQuoteNobodyConfirmed(t *testing.T) {
	r := newReconRig(t)
	q := r.quote(t, "k", 1_000_000)
	r.now = q.ExpiresAt.Add(2 * time.Minute)
	r.store.age(q.ID, r.now, 3*time.Minute)
	if res := r.run(t); res.Expired != 1 || r.state(t, q.ID) != cryptoprov.SwapStateExpired {
		t.Fatalf("res=%+v state=%s", res, r.state(t, q.ID))
	}
}

func TestReconcilerIsIdempotent(t *testing.T) {
	r := newReconRig(t)
	sw := r.confirmed(t, "k")
	_ = r.prov.CompleteSwap(sw.ProviderSwapID, cryptoprov.SwapCompleted)
	r.store.age(sw.ID, r.now, 30*time.Second)
	r.run(t)
	second := r.run(t)
	if second.Resolved != 0 {
		t.Fatalf("second pass re-did work: %+v", second)
	}
	if r.led.bal(revenueK) != 7_500 || r.led.total() != 5_000_000 {
		t.Fatalf("revenue=%d total=%d", r.led.bal(revenueK), r.led.total())
	}
}

func TestOneBadSwapDoesNotStopTheRest(t *testing.T) {
	r := newReconRig(t)
	a := r.confirmed(t, "a")
	b := r.confirmed(t, "b")
	_ = r.prov.CompleteSwap(a.ProviderSwapID, cryptoprov.SwapCompleted)
	_ = r.prov.CompleteSwap(b.ProviderSwapID, cryptoprov.SwapCompleted)
	r.store.age(a.ID, r.now, 30*time.Second)
	r.store.age(b.ID, r.now, 31*time.Second)
	r.prov.FailNext("getswap", &cryptoprov.APIError{Provider: "mock", Status: 503}) // first re-query fails
	res := r.run(t)
	if res.Errors != 1 || res.Resolved != 1 {
		t.Fatalf("res=%+v: one failure must not abort the batch", res)
	}
}

func TestOnlyTheLeaderReconciles(t *testing.T) {
	r := newReconRig(t)
	sw := r.confirmed(t, "k")
	_ = r.prov.CompleteSwap(sw.ProviderSwapID, cryptoprov.SwapCompleted)
	r.store.age(sw.ID, r.now, 30*time.Second)
	r.rec.cfg.Leader = neverLeader{}
	res := r.run(t)
	if !res.Skipped || res.Resolved != 0 || r.state(t, sw.ID) != cryptoprov.SwapStateProcessing {
		t.Fatalf("a non-leader reconciled: %+v", res)
	}
}

func TestReconcilerRefusesToRunWithoutALeaderLock(t *testing.T) {
	r := newReconRig(t)
	r.rec.cfg.Leader = nil
	if _, err := r.rec.RunOnce(context.Background()); err == nil {
		t.Fatal("ran without a leader lock: two replicas would double-process")
	}
}

func TestNegativeClearingBalanceRaisesAnAlert(t *testing.T) {
	r := newReconRig(t)
	// A sell paid out before treasury funded clearing.
	if err := r.svc.cfg.Settler.CompleteSell(context.Background(),
		SwapLedgerInput{SwapID: "sell1", UserID: user, Side: SideSell, FeeBps: 75, NGNKobo: 1_000_000}, decimal.RequireFromString("10000")); err != nil {
		t.Fatal(err)
	}
	r.rec.cfg.ClearingBalance = func(ctx context.Context) (int64, error) { return r.led.bal(clearK), nil }
	res := r.run(t)
	if !res.ClearingNegative || len(r.al.got) == 0 {
		t.Fatalf("res=%+v alerts=%v", res, r.al.got)
	}
}

func TestReconcilerSurfacesAHoldReleaseFailureInsteadOfFailingTheSwap(t *testing.T) {
	r := newReconRig(t)
	q := r.quote(t, "k", 1_000_000)
	ctx := context.Background()
	_, _ = r.store.TransitionSwap(ctx, q.ID, cryptoprov.SwapStateQuoted, cryptoprov.SwapStateConfirming, decimal.Zero, "")
	_ = r.svc.cfg.Settler.HoldBuy(ctx, SwapLedgerInput{SwapID: q.ID, UserID: user, Side: SideBuy, NGNKobo: 1_000_000, FeeKobo: 7_500})
	r.store.age(q.ID, r.now, 3*time.Minute)
	r.led.failKey = "" // release uses PostReversal; make it fail via a swapped-in error ledger
	r.svc.cfg.Settler.led = failingReversalLedger{r.led}
	res := r.run(t)
	if res.Errors != 1 || r.state(t, q.ID) != cryptoprov.SwapStateConfirming {
		t.Fatalf("res=%+v state=%s: a failed release must leave the swap confirming for the next pass", res, r.state(t, q.ID))
	}
	if r.led.bal(clearK) != 1_007_500 {
		t.Fatalf("clearing=%d", r.led.bal(clearK))
	}
}

type failingReversalLedger struct{ *fakeLedger }

func (failingReversalLedger) PostReversal(context.Context, string, string, int64, string, string) error {
	return errors.New("ledger down")
}

func TestReconcilerSkipsASwapTouchedAfterItWasQueued(t *testing.T) {
	r := newReconRig(t)
	sw := r.confirmed(t, "k")
	_ = r.prov.CompleteSwap(sw.ProviderSwapID, cryptoprov.SwapCompleted)
	r.store.age(sw.ID, r.now, 30*time.Second)
	// A webhook (or a live Confirm) writes the row between the listing and the repair.
	r.store.afterStale = func() { r.store.age(sw.ID, r.now, time.Second) }
	if res := r.run(t); res.Resolved != 0 {
		t.Fatalf("the reconciler acted on a swap that was no longer stale: %+v", res)
	}
}

// Audit: a swap the provider still reports pending must rotate, not starve newer stale swaps.
func TestAPendingSwapDoesNotStarveNewerOnes(t *testing.T) {
	r := newReconRig(t)
	r.rec.cfg.Batch = 1
	r.store.touchTo = r.now
	a := r.confirmed(t, "a") // provider keeps it pending
	b := r.confirmed(t, "b")
	_ = r.prov.CompleteSwap(b.ProviderSwapID, cryptoprov.SwapCompleted)
	r.store.age(a.ID, r.now, 10*time.Minute) // older, so it is listed first
	r.store.age(b.ID, r.now, 5*time.Minute)

	r.run(t) // pass 1 sees only A (still pending)
	if res := r.run(t); res.Resolved != 1 || r.state(t, b.ID) != cryptoprov.SwapStateCompleted {
		t.Fatalf("B starved behind A: %+v state=%s", res, r.state(t, b.ID))
	}
}

// Audit: one hung swap must not stall the whole pass.
type blockingLocker struct{ memLocker }

func (b *blockingLocker) WithSwapLock(ctx context.Context, id string, fn func(context.Context) error) error {
	if id == "confirm:"+hungID {
		<-ctx.Done() // a Confirm that never lets go
		return ctx.Err()
	}
	return b.memLocker.WithSwapLock(ctx, id, fn)
}

var hungID string

func TestAHungSwapTimesOutAndTheRestOfThePassContinues(t *testing.T) {
	r := newReconRig(t)
	r.touchAll()
	a := r.confirmed(t, "a")
	b := r.confirmed(t, "b")
	_ = r.prov.CompleteSwap(a.ProviderSwapID, cryptoprov.SwapCompleted)
	_ = r.prov.CompleteSwap(b.ProviderSwapID, cryptoprov.SwapCompleted)
	r.store.age(a.ID, r.now, 10*time.Minute)
	r.store.age(b.ID, r.now, 5*time.Minute)
	hungID = a.ID
	r.svc.cfg.Locker = &blockingLocker{}
	r.rec.cfg.HandleTimeout = 50 * time.Millisecond
	res := r.run(t)
	if res.Errors != 1 || res.Resolved != 1 || r.state(t, b.ID) != cryptoprov.SwapStateCompleted {
		t.Fatalf("res=%+v: a hung swap stalled the pass", res)
	}
}

func (r *reconRig) touchAll() { r.store.touchTo = r.now }

// The key safety property: the reconciler waits behind a live Confirm and then sees it moved on.
func TestReconcilerWaitsBehindALiveConfirmThenSkips(t *testing.T) {
	r := newReconRig(t)
	r.touchAll()
	q := r.quote(t, "k", 1_000_000)
	ctx := context.Background()
	_, _ = r.store.TransitionSwap(ctx, q.ID, cryptoprov.SwapStateQuoted, cryptoprov.SwapStateConfirming, decimal.Zero, "")
	_ = r.svc.cfg.Settler.HoldBuy(ctx, SwapLedgerInput{SwapID: q.ID, UserID: user, Side: SideBuy, NGNKobo: 1_000_000, FeeKobo: 7_500})
	r.store.age(q.ID, r.now, 5*time.Minute) // looks abandoned...

	held, release := make(chan struct{}), make(chan struct{})
	go func() { // ...but a live Confirm owns it
		_ = r.svc.cfg.Locker.WithSwapLock(ctx, "confirm:"+q.ID, func(context.Context) error {
			close(held)
			<-release
			return nil
		})
	}()
	<-held
	done := make(chan ReconcileResult, 1)
	go func() { res, _ := r.rec.RunOnce(ctx); done <- res }()
	select {
	case <-done:
		t.Fatal("the reconciler acted while a Confirm held the swap lock")
	case <-time.After(150 * time.Millisecond):
	}
	// The live Confirm finishes: it reaches the provider and bumps the row.
	_, _ = r.store.MarkExecuteAttempt(ctx, q.ID)
	_, _ = r.store.SetProviderSwapID(ctx, q.ID, "sw_live")
	r.store.age(q.ID, r.now, time.Second)
	close(release)
	res := <-done
	if res.Released != 0 || r.led.bal(clearK) != 1_007_500 {
		t.Fatalf("released a hold under a live Confirm: %+v clearing=%d", res, r.led.bal(clearK))
	}
}

func TestAPanickingAlertSinkDoesNotKillThePass(t *testing.T) {
	r := newReconRig(t)
	r.rec.cfg.Alert = func(string, string) { panic("sink exploded") }
	r.rec.cfg.ClearingBalance = func(context.Context) (int64, error) { return -5, nil }
	if _, err := r.rec.RunOnce(context.Background()); err != nil {
		t.Fatalf("a panicking alert sink aborted the pass: %v", err)
	}
}
