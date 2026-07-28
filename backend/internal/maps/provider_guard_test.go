package maps

import (
	"testing"
	"time"
)

// provider_guard_test.go — pure breaker state machine + budget gate (§10, MS-6).

func TestAllowDecisionBudget(t *testing.T) {
	now := time.Date(2026, 6, 27, 12, 0, 0, 0, time.UTC)
	day := budgetDayKey(now)

	// Under cap, closed breaker → allow.
	h := providerHealth{circuit: circuitClosed, budgetUsed: 99, budgetDay: day}
	if !allowDecision(h, 100, now) {
		t.Fatal("under budget cap should allow")
	}
	// At cap → deny.
	h.budgetUsed = 100
	if allowDecision(h, 100, now) {
		t.Fatal("at budget cap should deny")
	}
	// Over cap → deny.
	h.budgetUsed = 250
	if allowDecision(h, 100, now) {
		t.Fatal("over budget cap should deny")
	}
	// Cap of 0 = uncapped → allow regardless.
	if !allowDecision(h, 0, now) {
		t.Fatal("zero cap means uncapped, should allow")
	}
	// Stale budget day → effective used resets to 0 → allow.
	h.budgetUsed = 9999
	h.budgetDay = "2026-06-26"
	if !allowDecision(h, 100, now) {
		t.Fatal("previous day's budget should not count toward today")
	}
}

func TestAllowDecisionCircuit(t *testing.T) {
	now := time.Date(2026, 6, 27, 12, 0, 0, 0, time.UTC)

	// Open breaker, cooldown not elapsed → deny.
	open := providerHealth{circuit: circuitOpen, openedAt: now.Add(-breakerCooldown / 2)}
	if allowDecision(open, 0, now) {
		t.Fatal("open breaker within cooldown should deny")
	}
	// Open breaker, cooldown elapsed → allow (probe).
	open.openedAt = now.Add(-breakerCooldown - time.Second)
	if !allowDecision(open, 0, now) {
		t.Fatal("open breaker after cooldown should allow a probe")
	}
	// Closed / half_open → allow.
	if !allowDecision(providerHealth{circuit: circuitClosed}, 0, now) {
		t.Fatal("closed breaker should allow")
	}
	if !allowDecision(providerHealth{circuit: circuitHalfOpen}, 0, now) {
		t.Fatal("half_open breaker should allow a probe")
	}
}

func TestNextCircuitState(t *testing.T) {
	now := time.Date(2026, 6, 27, 12, 0, 0, 0, time.UTC)

	t.Run("closed stays closed when healthy", func(t *testing.T) {
		s, _ := nextCircuitState(circuitClosed, true, 0.0, 100, 50, now)
		if s != circuitClosed {
			t.Fatalf("got %q want closed", s)
		}
	})
	t.Run("closed trips open on high error rate", func(t *testing.T) {
		s, opened := nextCircuitState(circuitClosed, false, breakerErrorRate+0.1, 100, breakerMinSamples, now)
		if s != circuitOpen {
			t.Fatalf("got %q want open", s)
		}
		if !opened.Equal(now) {
			t.Fatalf("expected opened_at = now, got %v", opened)
		}
	})
	t.Run("closed does not trip below sample floor", func(t *testing.T) {
		s, _ := nextCircuitState(circuitClosed, false, 1.0, 100, breakerMinSamples-1, now)
		if s != circuitClosed {
			t.Fatalf("got %q want closed (too few samples)", s)
		}
	})
	t.Run("closed trips open on high latency", func(t *testing.T) {
		s, _ := nextCircuitState(circuitClosed, true, 0.0, breakerLatencyMs+1, breakerMinSamples, now)
		if s != circuitOpen {
			t.Fatalf("got %q want open", s)
		}
	})
	t.Run("half_open recovers to closed on success", func(t *testing.T) {
		s, _ := nextCircuitState(circuitHalfOpen, true, 0.9, 100, 50, now)
		if s != circuitClosed {
			t.Fatalf("got %q want closed", s)
		}
	})
	t.Run("half_open re-opens on failed probe", func(t *testing.T) {
		s, opened := nextCircuitState(circuitHalfOpen, false, 0.1, 100, 50, now)
		if s != circuitOpen {
			t.Fatalf("got %q want open", s)
		}
		if !opened.Equal(now) {
			t.Fatalf("expected re-armed opened_at = now, got %v", opened)
		}
	})
}

func TestFoldHealth(t *testing.T) {
	// First observation seeds the estimate directly.
	h := foldHealth(providerHealth{}, false, 500)
	if h.errorRate != 1.0 {
		t.Fatalf("first failure should set error rate 1.0, got %v", h.errorRate)
	}
	if h.p95Latency != 500 {
		t.Fatalf("first latency should seed 500, got %d", h.p95Latency)
	}
	if h.sampleSize != 1 {
		t.Fatalf("sample size should be 1, got %d", h.sampleSize)
	}
	// A subsequent success pulls the error rate down (EWMA).
	h2 := foldHealth(h, true, 100)
	if h2.errorRate >= h.errorRate {
		t.Fatalf("error rate should decay after a success: %v -> %v", h.errorRate, h2.errorRate)
	}
	if h2.sampleSize != 2 {
		t.Fatalf("sample size should be 2, got %d", h2.sampleSize)
	}
}

func TestBudgetDayKey(t *testing.T) {
	// Bucket is UTC date regardless of input zone.
	loc := time.FixedZone("WAT", 1*60*60) // Lagos +1
	ts := time.Date(2026, 6, 27, 0, 30, 0, 0, loc)  // 23:30 UTC on the 26th
	if got := budgetDayKey(ts); got != "2026-06-26" {
		t.Fatalf("budgetDayKey should use UTC date, got %q", got)
	}
}

func TestEffectiveBudgetUsedRollover(t *testing.T) {
	now := time.Date(2026, 6, 27, 12, 0, 0, 0, time.UTC)
	h := providerHealth{budgetUsed: 80, budgetDay: budgetDayKey(now)}
	if got := effectiveBudgetUsed(h, now); got != 80 {
		t.Fatalf("same day should keep used, got %d", got)
	}
	h.budgetDay = "2026-06-20"
	if got := effectiveBudgetUsed(h, now); got != 0 {
		t.Fatalf("stale day should reset to 0, got %d", got)
	}
}
