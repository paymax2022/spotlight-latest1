package restaurant

import "testing"

func TestApplyBp(t *testing.T) {
	cases := []struct {
		amount int64
		bp     int
		want   int64
	}{
		{100_000, 1000, 10_000},   // 10%
		{100_000, 750, 7_500},     // 7.5%
		{100_000, 0, 0},           // no fee
		{0, 1000, 0},              // no subtotal
		{100_000, 50000, 500_000}, // 5x surge
		{10_005, 750, 750},        // 10005*750/10000 = 750.375 → floor 750
		{100_000, -5, 0},          // negative bp → 0
		{-100, 1000, 0},           // negative amount → 0
	}
	for _, c := range cases {
		if got := applyBp(c.amount, c.bp); got != c.want {
			t.Errorf("applyBp(%d, %d) = %d, want %d", c.amount, c.bp, got, c.want)
		}
	}
}

// TestApplyBpNeverExceedsInputTimesRate documents the flooring guarantee: the derived
// fee/surge is always ≤ the exact fraction (never rounds up past what was quoted).
func TestApplyBpNeverExceedsInputTimesRate(t *testing.T) {
	for _, amt := range []int64{1, 999, 33_333, 1_000_000} {
		for _, bp := range []int{1, 750, 1000, 9999} {
			got := applyBp(amt, bp)
			if float64(got) > float64(amt)*float64(bp)/10000+1e-9 {
				t.Errorf("applyBp(%d,%d)=%d exceeds exact %.4f", amt, bp, got, float64(amt)*float64(bp)/10000)
			}
			if got < 0 {
				t.Errorf("applyBp(%d,%d)=%d negative", amt, bp, got)
			}
		}
	}
}
