package risk

import "testing"

func TestSizeVolTarget(t *testing.T) {
	const equity = 100_000_000 // ₦1,000,000
	// target 10% vol, instrument 20% vol → notional = equity * 0.10/0.20 = 50% equity.
	if got := SizeVolTarget(equity, 1000, 2000); got != 50_000_000 {
		t.Fatalf("vol-target size = %d, want 50_000_000", got)
	}
	// A MORE volatile instrument gets a SMALLER notional.
	hi := SizeVolTarget(equity, 1000, 4000)
	lo := SizeVolTarget(equity, 1000, 2000)
	if hi >= lo {
		t.Fatalf("higher instrument vol must size smaller: hi=%d lo=%d", hi, lo)
	}
	// Fail-closed: unknown instrument vol, non-positive equity/target → 0.
	for _, c := range []struct{ eq int64; tgt, iv Bps }{{equity, 1000, 0}, {0, 1000, 2000}, {equity, 0, 2000}, {-1, 1000, 2000}} {
		if got := SizeVolTarget(c.eq, c.tgt, c.iv); got != 0 {
			t.Fatalf("expected fail-closed 0 for %+v, got %d", c, got)
		}
	}
}

func TestKellyFraction(t *testing.T) {
	// Even-odds (b=1), 60% win → f* = 2*0.6-1 = 0.2.
	if f := KellyFraction(0.6, 1.0); f < 0.1999 || f > 0.2001 {
		t.Fatalf("kelly = %v, want ~0.2", f)
	}
	// No edge (50/50 even-odds) → 0.
	if f := KellyFraction(0.5, 1.0); f != 0 {
		t.Fatalf("no-edge kelly = %v, want 0", f)
	}
	// Malformed / losing edge → 0 (fail closed).
	for _, c := range []struct{ p, b float64 }{{0, 1}, {1, 1}, {0.6, 0}, {0.3, 1}} {
		if f := KellyFraction(c.p, c.b); f != 0 {
			t.Fatalf("kelly(%v,%v)=%v, want 0", c.p, c.b, f)
		}
	}
}

func TestFractionalKelly(t *testing.T) {
	const equity = 100_000_000
	// full kelly 0.2, quarter-kelly → 0.05 of equity = 5,000,000.
	if got := FractionalKelly(equity, 0.6, 1.0, 0.25, 0); got < 4_999_990 || got > 5_000_000 {
		t.Fatalf("quarter-kelly = %d, want ~5_000_000 (conservative floor)", got)
	}
	// Hard fraction cap binds: cap 2% overrides the 5% kelly size.
	if got := FractionalKelly(equity, 0.6, 1.0, 0.25, 200); got != 2_000_000 {
		t.Fatalf("capped kelly = %d, want 2_000_000 (2%%)", got)
	}
	// No edge → 0.
	if got := FractionalKelly(equity, 0.5, 1.0, 0.25, 0); got != 0 {
		t.Fatalf("no-edge kelly size = %d, want 0", got)
	}
}

func TestConfidenceScale(t *testing.T) {
	// below min confidence → 0.
	if got := ConfidenceScale(1_000_000, 4000, 5000); got != 0 {
		t.Fatalf("below-min confidence must zero the size, got %d", got)
	}
	// scales linearly by confidence.
	if got := ConfidenceScale(1_000_000, 8000, 0); got != 800_000 {
		t.Fatalf("confidence scale = %d, want 800_000", got)
	}
}

func TestApplyCapsAndReduce(t *testing.T) {
	// smallest binding cap wins; 0 caps ignored.
	if got := ApplyCaps(10_000_000, SizeCaps{MaxPositionKobo: 6_000_000, MaxByEquityFracKobo: 0, MaxByLeverageKobo: 4_000_000}); got != 4_000_000 {
		t.Fatalf("caps = %d, want 4_000_000 (leverage headroom binds)", got)
	}
	// reduce-before-increase: no adds while uncertainty rises.
	if got := ReduceBeforeIncrease(3_000_000, 5_000_000, true); got != 3_000_000 {
		t.Fatalf("uncertainty-rising add must be refused: got %d, want 3_000_000", got)
	}
	if got := ReduceBeforeIncrease(3_000_000, 5_000_000, false); got != 5_000_000 {
		t.Fatalf("calm add should pass: got %d", got)
	}
	// a reduction is always allowed, even on rising uncertainty.
	if got := ReduceBeforeIncrease(3_000_000, 1_000_000, true); got != 1_000_000 {
		t.Fatalf("reduction should pass: got %d", got)
	}
}
