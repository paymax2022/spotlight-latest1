package navigation

import (
	"context"
	"testing"
	"time"
)

type fakePurger struct {
	calls  int
	cutoff time.Time
	batch  int
	n      int64
}

func (f *fakePurger) PurgeOlderThan(_ context.Context, cutoff time.Time, batch int) (int64, error) {
	f.calls++
	f.cutoff = cutoff
	f.batch = batch
	return f.n, nil
}

func TestPurgeOnce_CutoffIs90DaysBeforeNow(t *testing.T) {
	now := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	f := &fakePurger{n: 42}
	got, err := purgeOnce(context.Background(), f, now)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got != 42 {
		t.Fatalf("deleted = %d, want 42", got)
	}
	if f.calls != 1 {
		t.Fatalf("calls = %d, want 1", f.calls)
	}
	if want := now.Add(-90 * 24 * time.Hour); !f.cutoff.Equal(want) {
		t.Fatalf("cutoff = %v, want %v", f.cutoff, want)
	}
	if f.batch != 10000 {
		t.Fatalf("batch = %d, want 10000", f.batch)
	}
}
