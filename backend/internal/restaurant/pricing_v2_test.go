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

// TestOrderBoundsKeepApplyBpInsideInt64 is the reason maxLineQuantity and
// maxOrderSubtotalKobo exist. applyBp multiplies BEFORE it divides, so at the surge
// ceiling (50000 bp = 5x) the product overflows int64 once the subtotal passes ~1.845e14
// kobo — wrapping the surge, and the escrowed total, NEGATIVE on the money path.
// The bounds must keep every derived amount comfortably inside int64.
func TestOrderBoundsKeepApplyBpInsideInt64(t *testing.T) {
	const maxBp = 50000 // SetPricingConfig's surge ceiling

	// At the aggregate bound, the product still fits and applyBp is exact.
	if got, want := applyBp(maxOrderSubtotalKobo, maxBp), int64(maxOrderSubtotalKobo/10000*maxBp); got != want {
		t.Errorf("applyBp at the cap = %d, want %d — the bound does not keep the product inside int64", got, want)
	}
	// Compose the worst case the bounds permit: surge at 5x, then the service fee at
	// 100%, then the total. Nothing may go negative.
	surge := applyBp(maxOrderSubtotalKobo, maxBp)
	items := maxOrderSubtotalKobo + surge
	fee := applyBp(items, 10000) // service_fee_bp ceiling
	total := items + DeliveryFeeKobo + fee
	for _, c := range []struct {
		name string
		v    int64
	}{{"surge", surge}, {"items", items}, {"fee", fee}, {"total", total}} {
		if c.v <= 0 {
			t.Errorf("%s = %d — wrapped negative at the permitted maximum", c.name, c.v)
		}
	}

	// And the bounds are consistent with each other: the largest cart the per-line cap
	// allows in a single line must not already exceed the aggregate cap unnoticed.
	if maxItemPriceKobo*int64(maxLineQuantity) < 0 {
		t.Error("a single max-priced line at the quantity cap already overflows int64")
	}
}
