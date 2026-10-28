package tests

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hibiken/asynq"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
)

// DB-free tests for the recurring settlement processor (Task 5.2) using
// in-memory fakes for the store, ledger and lock.

type fakeStore struct {
	mu sync.Mutex
	t  map[string]*settlement.RecurringTemplate
}

func (s *fakeStore) ListDue(_ context.Context, now time.Time, limit int) ([]settlement.RecurringTemplate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []settlement.RecurringTemplate
	for _, t := range s.t {
		if t.Active && !t.NextRunAt.After(now) {
			out = append(out, *t)
		}
	}
	return out, nil
}
func (s *fakeStore) Get(_ context.Context, id string) (*settlement.RecurringTemplate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t, ok := s.t[id]; ok {
		c := *t
		return &c, nil
	}
	return nil, nil
}
func (s *fakeStore) CompleteRun(_ context.Context, id string, exp, next, _ time.Time) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t := s.t[id]
	if t == nil || !t.NextRunAt.Equal(exp) {
		return false, nil
	}
	t.NextRunAt = next
	return true, nil
}

// fakeLedger is an idempotent double-entry ledger: replaying a key is a no-op.
type fakeLedger struct {
	mu      sync.Mutex
	entries map[string]ledger.JournalEntry
	balance map[string]int64
	failOn  string // idempotency-key suffix that errors once
	calls   int
}

func newFakeLedger() *fakeLedger {
	return &fakeLedger{entries: map[string]ledger.JournalEntry{}, balance: map[string]int64{}}
}
func (l *fakeLedger) PostJournal(_ context.Context, j ledger.JournalEntry) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.calls++
	if l.failOn != "" && strings.HasSuffix(j.IdempotencyKey, l.failOn) {
		l.failOn = ""
		return errors.New("db down")
	}
	if _, ok := l.entries[j.IdempotencyKey]; ok {
		return nil // true replay
	}
	l.entries[j.IdempotencyKey] = j
	l.balance[j.DebitAccountID] -= j.AmountKobo
	l.balance[j.CreditAccountID] += j.AmountKobo
	return nil
}
func (l *fakeLedger) Posted(_ context.Context, key string) (bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	_, ok := l.entries[key]
	return ok, nil
}
func (l *fakeLedger) sum() (s int64) {
	for _, v := range l.balance {
		s += v
	}
	return
}

type fakeLocker struct {
	mu   sync.Mutex
	held map[string]string
}

func (l *fakeLocker) Acquire(_ context.Context, key string, _ time.Duration) (string, bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.held[key]; ok {
		return "", false, nil
	}
	l.held[key] = "tok"
	return "tok", true, nil
}
func (l *fakeLocker) Release(_ context.Context, key, _ string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.held, key)
	return nil
}

var runAt = time.Date(2027, 1, 31, 9, 0, 0, 0, time.UTC)

func newRig(t *testing.T) (*settlement.Processor, *fakeStore, *fakeLedger, *fakeLocker) {
	t.Helper()
	st := &fakeStore{t: map[string]*settlement.RecurringTemplate{
		"tpl1": {ID: "tpl1", Name: "monthly payout", SourceAccountID: "src", AmountKobo: 1_000_003,
			Schedule: settlement.ScheduleMonthly, AnchorDay: 31, NextRunAt: runAt, Active: true,
			Splits: []settlement.RecurringSplit{{AccountID: "a", Bps: 7000}, {AccountID: "b", Bps: 2000}, {AccountID: "c", Bps: 1000}}},
	}}
	lg, lk := newFakeLedger(), &fakeLocker{held: map[string]string{}}
	p := settlement.NewProcessor(st, lg, lk, settlement.WithClock(func() time.Time { return runAt.Add(time.Hour) }))
	return p, st, lg, lk
}

func TestRecurringSettlement_HappyPathPostsBalancedLegsAndAdvances(t *testing.T) {
	p, st, lg, lk := newRig(t)
	if err := p.RunOccurrence(context.Background(), "tpl1", runAt); err != nil {
		t.Fatal(err)
	}
	if len(lg.entries) != 3 {
		t.Fatalf("want 3 legs, got %d", len(lg.entries))
	}
	if lg.balance["src"] != -1_000_003 || lg.sum() != 0 {
		t.Fatalf("unbalanced: src=%d sum=%d", lg.balance["src"], lg.sum())
	}
	want := time.Date(2027, 2, 28, 9, 0, 0, 0, time.UTC)
	if got := st.t["tpl1"].NextRunAt; !got.Equal(want) {
		t.Fatalf("next run = %s, want %s", got, want)
	}
	if len(lk.held) != 0 {
		t.Fatal("lock not released")
	}
}

func TestRecurringSettlement_DuplicateRunDoesNotDoublePost(t *testing.T) {
	p, _, lg, _ := newRig(t)
	ctx := context.Background()
	if err := p.RunOccurrence(ctx, "tpl1", runAt); err != nil {
		t.Fatal(err)
	}
	// Same occurrence again: schedule already advanced.
	if err := p.RunOccurrence(ctx, "tpl1", runAt); !errors.Is(err, settlement.ErrNotDue) {
		t.Fatalf("want ErrNotDue, got %v", err)
	}
	if lg.balance["src"] != -1_000_003 || len(lg.entries) != 3 {
		t.Fatalf("double posted: src=%d entries=%d", lg.balance["src"], len(lg.entries))
	}
}

func TestRecurringSettlement_StaleCompletionReplayIsLedgerIdempotent(t *testing.T) {
	// Worker A posts but crashes before CompleteRun; worker B re-runs the same
	// occurrence. The ledger keys dedupe, so money moves exactly once.
	p, st, lg, _ := newRig(t)
	ctx := context.Background()
	tpl, _ := st.Get(ctx, "tpl1")
	legs, _ := settlement.ComputeRecurringLegs(*tpl)
	for i, l := range legs { // simulate A's partial work: all legs landed
		_ = lg.PostJournal(ctx, ledger.JournalEntry{
			IdempotencyKey: fmt.Sprintf("%s:leg%d", settlement.OccurrenceKey("tpl1", runAt), i),
			AmountKobo:     l.AmountKobo, DebitAccountID: "src", CreditAccountID: l.AccountID})
	}
	if err := p.RunOccurrence(ctx, "tpl1", runAt); err != nil {
		t.Fatal(err)
	}
	if lg.balance["src"] != -1_000_003 || len(lg.entries) != 3 {
		t.Fatalf("replay double-posted: src=%d entries=%d", lg.balance["src"], len(lg.entries))
	}
}

func TestRecurringSettlement_LockedReturnsErrLockedAndPostsNothing(t *testing.T) {
	p, _, lg, lk := newRig(t)
	lk.held[settlement.OccurrenceKey("tpl1", runAt)] = "other"
	if err := p.RunOccurrence(context.Background(), "tpl1", runAt); !errors.Is(err, settlement.ErrLocked) {
		t.Fatalf("want ErrLocked, got %v", err)
	}
	if len(lg.entries) != 0 {
		t.Fatal("posted while locked")
	}
}

func TestRecurringSettlement_ConcurrentWorkersPostOnce(t *testing.T) {
	p, _, lg, _ := newRig(t)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _ = p.RunOccurrence(context.Background(), "tpl1", runAt) }()
	}
	wg.Wait()
	if lg.balance["src"] != -1_000_003 || len(lg.entries) != 3 {
		t.Fatalf("concurrent double post: src=%d entries=%d", lg.balance["src"], len(lg.entries))
	}
}

func TestRecurringSettlement_MidwayFailureDoesNotAdvanceAndRetryCompletes(t *testing.T) {
	p, st, lg, _ := newRig(t)
	ctx := context.Background()
	lg.failOn = ":leg1"
	if err := p.RunOccurrence(ctx, "tpl1", runAt); err == nil {
		t.Fatal("expected failure")
	}
	if !st.t["tpl1"].NextRunAt.Equal(runAt) {
		t.Fatal("schedule advanced despite failure")
	}
	if err := p.RunOccurrence(ctx, "tpl1", runAt); err != nil {
		t.Fatal(err)
	}
	if lg.balance["src"] != -1_000_003 || len(lg.entries) != 3 || lg.sum() != 0 {
		t.Fatalf("after retry: src=%d entries=%d sum=%d", lg.balance["src"], len(lg.entries), lg.sum())
	}
}

func TestRecurringSettlement_LegsConserveTotalExactly(t *testing.T) {
	for _, amt := range []int64{1, 3, 99, 10_001, 1_000_003, 9_223_372_036_854_000_000} {
		legs, err := settlement.ComputeRecurringLegs(settlement.RecurringTemplate{
			ID: "x", SourceAccountID: "s", AmountKobo: amt, Schedule: settlement.ScheduleDaily,
			Splits: []settlement.RecurringSplit{{AccountID: "a", Bps: 3333}, {AccountID: "b", Bps: 3333}, {AccountID: "c", Bps: 3334}}})
		if err != nil {
			t.Fatal(err)
		}
		var sum int64
		for _, l := range legs {
			if l.AmountKobo <= 0 {
				t.Fatalf("non-positive leg for %d", amt)
			}
			sum += l.AmountKobo
		}
		if sum != amt {
			t.Fatalf("amount %d: legs sum %d", amt, sum)
		}
	}
}

func TestRecurringSettlement_ValidationRejectsBadTemplates(t *testing.T) {
	base := func() settlement.RecurringTemplate {
		return settlement.RecurringTemplate{ID: "x", SourceAccountID: "s", AmountKobo: 100, Schedule: settlement.ScheduleDaily,
			Splits: []settlement.RecurringSplit{{AccountID: "a", Bps: 10000}}}
	}
	cases := map[string]func(*settlement.RecurringTemplate){
		"zero amount":      func(t *settlement.RecurringTemplate) { t.AmountKobo = 0 },
		"bps not 10000":    func(t *settlement.RecurringTemplate) { t.Splits[0].Bps = 9999 },
		"dest is source":   func(t *settlement.RecurringTemplate) { t.Splits[0].AccountID = "s" },
		"unknown schedule": func(t *settlement.RecurringTemplate) { t.Schedule = "hourly" },
		"monthly no day":   func(t *settlement.RecurringTemplate) { t.Schedule = settlement.ScheduleMonthly },
		"no splits":        func(t *settlement.RecurringTemplate) { t.Splits = nil },
	}
	if err := base().Validate(); err != nil {
		t.Fatalf("base should be valid: %v", err)
	}
	for name, mut := range cases {
		tpl := base()
		mut(&tpl)
		if err := tpl.Validate(); !errors.Is(err, settlement.ErrInvalidTemplate) {
			t.Errorf("%s: want ErrInvalidTemplate, got %v", name, err)
		}
	}
}

func TestRecurringSettlement_NextRunScheduling(t *testing.T) {
	d := func(y int, m time.Month, day int) time.Time { return time.Date(y, m, day, 9, 0, 0, 0, time.UTC) }
	cases := []struct {
		name   string
		prev   time.Time
		sched  settlement.RecurringSchedule
		anchor int
		want   time.Time
	}{
		{"daily", d(2027, 1, 31), settlement.ScheduleDaily, 0, d(2027, 2, 1)},
		{"weekly", d(2027, 1, 31), settlement.ScheduleWeekly, 0, d(2027, 2, 7)},
		{"monthly clamps to Feb", d(2027, 1, 31), settlement.ScheduleMonthly, 31, d(2027, 2, 28)},
		{"monthly restores anchor after clamp", d(2027, 2, 28), settlement.ScheduleMonthly, 31, d(2027, 3, 31)},
		{"monthly leap Feb", d(2028, 1, 31), settlement.ScheduleMonthly, 31, d(2028, 2, 29)},
		{"monthly year rollover", d(2027, 12, 15), settlement.ScheduleMonthly, 15, d(2028, 1, 15)},
	}
	for _, c := range cases {
		got, err := settlement.NextRun(c.prev, c.sched, c.anchor)
		if err != nil || !got.Equal(c.want) {
			t.Errorf("%s: got %v (err %v), want %v", c.name, got, err, c.want)
		}
	}
}

func TestRecurringSettlement_ProcessDueRunsOnlyDueActive(t *testing.T) {
	p, st, lg, _ := newRig(t)
	st.t["future"] = &settlement.RecurringTemplate{ID: "future", SourceAccountID: "src", AmountKobo: 500,
		Schedule: settlement.ScheduleDaily, NextRunAt: runAt.Add(48 * time.Hour), Active: true,
		Splits: []settlement.RecurringSplit{{AccountID: "z", Bps: 10000}}}
	st.t["off"] = &settlement.RecurringTemplate{ID: "off", SourceAccountID: "src", AmountKobo: 500,
		Schedule: settlement.ScheduleDaily, NextRunAt: runAt, Active: false,
		Splits: []settlement.RecurringSplit{{AccountID: "z", Bps: 10000}}}
	n, err := p.ProcessDue(context.Background(), 50)
	if err != nil || n != 1 {
		t.Fatalf("processed %d err %v", n, err)
	}
	if lg.balance["z"] != 0 {
		t.Fatal("future/inactive template was settled")
	}
}

type recEnqueuer struct {
	ids []string
}

func (e *recEnqueuer) EnqueueContext(_ context.Context, task *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error) {
	for _, o := range opts {
		if o.Type() == asynq.TaskIDOpt {
			e.ids = append(e.ids, fmt.Sprint(o.Value()))
		}
	}
	return &asynq.TaskInfo{}, nil
}

func TestRecurringSettlement_TaskHandlers(t *testing.T) {
	p, st, lg, _ := newRig(t)
	enq := &recEnqueuer{}
	h := &settlement.TaskHandlers{Processor: p, Store: st, Enqueuer: enq}
	ctx := context.Background()

	if err := h.HandleSweep(ctx, asynq.NewTask(settlement.TypeRecurringSweep, nil)); err != nil {
		t.Fatal(err)
	}
	if len(enq.ids) != 1 || enq.ids[0] != settlement.OccurrenceKey("tpl1", runAt) {
		t.Fatalf("sweep enqueued %v", enq.ids)
	}

	task, _, err := settlement.NewRecurringRunTask("tpl1", runAt)
	if err != nil {
		t.Fatal(err)
	}
	if err := h.HandleRun(ctx, task); err != nil {
		t.Fatal(err)
	}
	if err := h.HandleRun(ctx, task); err != nil { // duplicate delivery acks cleanly
		t.Fatalf("duplicate delivery: %v", err)
	}
	if len(lg.entries) != 3 {
		t.Fatalf("entries = %d", len(lg.entries))
	}
	if err := h.HandleRun(ctx, asynq.NewTask(settlement.TypeRecurringRun, []byte("{}"))); !errors.Is(err, asynq.SkipRetry) {
		t.Fatalf("bad payload should SkipRetry, got %v", err)
	}
}
