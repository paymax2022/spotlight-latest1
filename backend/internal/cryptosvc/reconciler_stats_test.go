package cryptosvc

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"spotlight/backend/internal/cryptoprov"
)

type errLeader struct{}

func (errLeader) TryLead(context.Context) (func(), bool, error) {
	return nil, false, errors.New("lock db down")
}

func TestSnapshotBeforeAnyRunIsEmpty(t *testing.T) {
	r := newReconRig(t)
	s := r.rec.Snapshot()
	if s.Runs != 0 || s.LedRuns != 0 || s.SkippedRuns != 0 || !s.LastRunAt.IsZero() || !s.LastLedAt.IsZero() || len(s.RecentAlerts) != 0 {
		t.Fatalf("fresh reconciler must report nothing: %+v", s)
	}
}

func TestSnapshotCountsLedPassesAndAccumulatesWork(t *testing.T) {
	r := newReconRig(t)
	sw := r.confirmed(t, "k")
	_ = r.prov.CompleteSwap(sw.ProviderSwapID, cryptoprov.SwapCompleted)
	r.store.age(sw.ID, r.now, 30*time.Second)
	res := r.run(t)
	if res.Resolved != 1 {
		t.Fatalf("setup: %+v", res)
	}
	r.run(t) // an idle second pass

	s := r.rec.Snapshot()
	if s.Runs != 2 || s.LedRuns != 2 || s.SkippedRuns != 0 || !s.LastLed {
		t.Fatalf("run counters: %+v", s)
	}
	if s.Totals.Resolved != 1 || s.Totals.Errors != 0 {
		t.Fatalf("totals must accumulate across passes: %+v", s.Totals)
	}
	if s.LastResult.Resolved != 0 {
		t.Fatalf("LastResult is the most recent pass (idle), got %+v", s.LastResult)
	}
	if s.LastRunAt.IsZero() || s.LastLedAt.IsZero() {
		t.Fatalf("timestamps not recorded: %+v", s)
	}
}

func TestSnapshotRecordsAFollowerPassAsSkipped(t *testing.T) {
	r := newReconRig(t)
	r.rec.cfg.Leader = neverLeader{}
	r.run(t)
	s := r.rec.Snapshot()
	if s.Runs != 1 || s.SkippedRuns != 1 || s.LedRuns != 0 || s.LastLed || !s.LastLedAt.IsZero() {
		t.Fatalf("a follower must count as skipped, never as led: %+v", s)
	}
}

func TestSnapshotRecordsALeaderLockFailure(t *testing.T) {
	r := newReconRig(t)
	r.rec.cfg.Leader = errLeader{}
	if _, err := r.rec.RunOnce(context.Background()); err == nil {
		t.Fatal("expected the leader error")
	}
	s := r.rec.Snapshot()
	if s.Runs != 1 || s.LastError == "" || s.LedRuns != 0 {
		t.Fatalf("a failed pass must be visible: %+v", s)
	}
	// A later healthy pass clears the last error.
	r.rec.cfg.Leader = alwaysLeader{}
	r.run(t)
	if got := r.rec.Snapshot().LastError; got != "" {
		t.Fatalf("LastError must clear after a healthy pass, got %q", got)
	}
}

func TestAlertsAreRecordedNewestFirstAndBounded(t *testing.T) {
	r := newReconRig(t)
	for i := 0; i < maxRecentAlerts+10; i++ {
		r.rec.alert("reconcile_error", fmt.Sprintf("n%d", i))
	}
	s := r.rec.Snapshot()
	if len(s.RecentAlerts) != maxRecentAlerts {
		t.Fatalf("ring must be bounded at %d, got %d", maxRecentAlerts, len(s.RecentAlerts))
	}
	if want := fmt.Sprintf("n%d", maxRecentAlerts+9); s.RecentAlerts[0].Message != want {
		t.Fatalf("newest first: got %q want %q", s.RecentAlerts[0].Message, want)
	}
	if len(r.al.got) != maxRecentAlerts+10 {
		t.Fatalf("every alert must still reach the sink: %d", len(r.al.got))
	}
}

func TestAlertsAreRecordedWithoutASinkAndSurviveAPanickingSink(t *testing.T) {
	r := newReconRig(t)
	r.rec.cfg.Alert = nil
	r.rec.alert("clearing_negative", "x")
	r.rec.cfg.Alert = func(string, string) { panic("sink bug") }
	r.rec.alert("reconcile_error", "y")
	if got := len(r.rec.Snapshot().RecentAlerts); got != 2 {
		t.Fatalf("both alerts must be recorded, got %d", got)
	}
}

func TestSnapshotIsACopy(t *testing.T) {
	r := newReconRig(t)
	r.rec.alert("a", "1")
	s := r.rec.Snapshot()
	s.RecentAlerts[0].Message = "tampered"
	if r.rec.Snapshot().RecentAlerts[0].Message != "1" {
		t.Fatal("mutating a snapshot must not change the recorder")
	}
}

func TestSnapshotIsSafeUnderConcurrentPasses(t *testing.T) {
	r := newReconRig(t)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); _, _ = r.rec.RunOnce(context.Background()) }()
		go func() { defer wg.Done(); _ = r.rec.Snapshot() }()
	}
	wg.Wait()
	if got := r.rec.Snapshot().Runs; got != 8 {
		t.Fatalf("runs = %d, want 8", got)
	}
}

func TestBacklogSummaryCoversOnlyOpenStates(t *testing.T) {
	r := newReconRig(t)
	add := func(id string, st cryptoprov.SwapState, ngn, fee int64, ago time.Duration) {
		r.store.addSwap(SwapRecord{ID: id, UserID: user, State: st, Side: SideBuy, ToCurrency: "USDT",
			NGNKobo: ngn, FeeKobo: fee, UpdatedAt: r.now.Add(-ago)})
	}
	add("p1", cryptoprov.SwapStateNeedsReview, 1_000_000, 7_500, 10*time.Minute)
	add("p2", cryptoprov.SwapStateNeedsReview, 2_000_000, 15_000, 2*time.Minute)
	add("c1", cryptoprov.SwapStateProcessing, 500_000, 3_750, time.Minute)
	add("d1", cryptoprov.SwapStateCompleted, 9_000_000, 90_000, time.Hour)
	add("f1", cryptoprov.SwapStateFailed, 9_000_000, 90_000, time.Hour)

	got, err := r.svc.Backlog(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	by := map[cryptoprov.SwapState]BacklogState{}
	for _, b := range got {
		by[b.State] = b
	}
	if _, bad := by[cryptoprov.SwapStateCompleted]; bad {
		t.Fatal("terminal states are not backlog")
	}
	if _, bad := by[cryptoprov.SwapStateFailed]; bad {
		t.Fatal("terminal states are not backlog")
	}
	nr := by[cryptoprov.SwapStateNeedsReview]
	if nr.Count != 2 || nr.HeldKobo != 1_007_500+2_015_000 || !nr.OldestUpdatedAt.Equal(r.now.Add(-10*time.Minute)) {
		t.Fatalf("needs_review rollup wrong: %+v", nr)
	}
	if pr := by[cryptoprov.SwapStateProcessing]; pr.Count != 1 || pr.HeldKobo != 503_750 {
		t.Fatalf("processing rollup wrong: %+v", pr)
	}
	// Every open state is reported, even when empty, so a dashboard can tell "zero" from "unknown".
	for _, st := range []cryptoprov.SwapState{cryptoprov.SwapStateQuoted, cryptoprov.SwapStateConfirming} {
		if b, ok := by[st]; !ok || b.Count != 0 || b.HeldKobo != 0 {
			t.Fatalf("%s must be present and zero: %+v ok=%v", st, b, ok)
		}
	}
}
