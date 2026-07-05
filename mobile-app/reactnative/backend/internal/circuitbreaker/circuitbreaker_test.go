package circuitbreaker

import (
	"errors"
	"testing"
	"time"
)

var errBoom = errors.New("boom")

func TestTripsAfterFailureThreshold(t *testing.T) {
	b := New(Config{FailureThreshold: 3, OpenTimeout: time.Minute, HalfOpenMax: 1})

	calls := 0
	failing := func() error {
		calls++
		return errBoom
	}

	// Three consecutive failures should trip the breaker.
	for i := 0; i < 3; i++ {
		if err := b.Do(failing); !errors.Is(err, errBoom) {
			t.Fatalf("call %d: got %v, want errBoom", i, err)
		}
	}

	if got := b.State(); got != "open" {
		t.Fatalf("state after threshold = %q, want %q", got, "open")
	}

	// Once open, fn must not be invoked and Do must return ErrOpen.
	callsBefore := calls
	if err := b.Do(failing); !errors.Is(err, ErrOpen) {
		t.Fatalf("open-state Do = %v, want ErrOpen", err)
	}
	if calls != callsBefore {
		t.Fatalf("fn called %d times while open, want 0", calls-callsBefore)
	}
}

func TestHalfOpenTrialSuccessCloses(t *testing.T) {
	b := New(Config{FailureThreshold: 2, OpenTimeout: 20 * time.Millisecond, HalfOpenMax: 1})

	// Trip the breaker.
	for i := 0; i < 2; i++ {
		_ = b.Do(func() error { return errBoom })
	}
	if got := b.State(); got != "open" {
		t.Fatalf("state = %q, want %q", got, "open")
	}

	// Before timeout, calls fail fast.
	if err := b.Do(func() error { return nil }); !errors.Is(err, ErrOpen) {
		t.Fatalf("Do before timeout = %v, want ErrOpen", err)
	}

	// Wait out the open timeout, then a successful trial closes the breaker.
	time.Sleep(30 * time.Millisecond)

	if err := b.Do(func() error { return nil }); err != nil {
		t.Fatalf("half-open trial Do = %v, want nil", err)
	}
	if got := b.State(); got != "closed" {
		t.Fatalf("state after successful trial = %q, want %q", got, "closed")
	}
}

func TestHalfOpenTrialFailureReopens(t *testing.T) {
	b := New(Config{FailureThreshold: 1, OpenTimeout: 20 * time.Millisecond, HalfOpenMax: 1})

	_ = b.Do(func() error { return errBoom }) // trips immediately (threshold 1)
	if got := b.State(); got != "open" {
		t.Fatalf("state = %q, want %q", got, "open")
	}

	time.Sleep(30 * time.Millisecond)

	// A failing trial re-opens the breaker.
	if err := b.Do(func() error { return errBoom }); !errors.Is(err, errBoom) {
		t.Fatalf("half-open trial Do = %v, want errBoom", err)
	}
	if got := b.State(); got != "open" {
		t.Fatalf("state after failed trial = %q, want %q", got, "open")
	}
}

func TestSuccessResetsFailureCount(t *testing.T) {
	b := New(Config{FailureThreshold: 3, OpenTimeout: time.Minute, HalfOpenMax: 1})

	// Two failures, then a success should reset the counter.
	_ = b.Do(func() error { return errBoom })
	_ = b.Do(func() error { return errBoom })
	if err := b.Do(func() error { return nil }); err != nil {
		t.Fatalf("success Do = %v, want nil", err)
	}

	// Counter is reset, so it should take a full FailureThreshold (3) more
	// failures to trip; two failures must leave it closed.
	_ = b.Do(func() error { return errBoom })
	_ = b.Do(func() error { return errBoom })
	if got := b.State(); got != "closed" {
		t.Fatalf("state = %q, want %q (counter should have reset)", got, "closed")
	}

	// Defaults applied for zero config.
	d := New(Config{})
	if d.cfg.FailureThreshold != 5 || d.cfg.OpenTimeout != 30*time.Second || d.cfg.HalfOpenMax != 1 {
		t.Fatalf("defaults = %+v, want {5, 30s, 1}", d.cfg)
	}
}
