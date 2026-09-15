package utilitybills

import (
	"errors"
	"testing"
)

func ptr(v int64) *int64 { return &v }

// ── applyBasisPoints: hand-computed truncation table ────────────────────
//
// Two cases below (333333@250bps and 7@5000bps) land on a non-exact
// division on purpose, to prove the floor/truncation direction is right —
// not just "close enough". A third (1@9999bps) proves a numerator smaller
// than the denominator truncates all the way to 0 rather than rounding up
// to 1. A fourth is an exact-division sanity check.
func TestApplyBasisPoints_MatchesHandComputedTable(t *testing.T) {
	cases := []struct {
		name       string
		amountKobo int64
		bps        int64
		want       int64
	}{
		{"exact division sanity check", 100_000, 150, 1_500},
		{"non-exact boundary: 8333.325 -> 8333", 333_333, 250, 8_333},
		{"non-exact boundary: 3.5 -> 3, not rounded to 4", 7, 5_000, 3},
		{"numerator smaller than denominator -> 0, not 1", 1, 9_999, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := applyBasisPoints(c.amountKobo, c.bps); got != c.want {
				t.Errorf("applyBasisPoints(%d, %d) = %d, want %d", c.amountKobo, c.bps, got, c.want)
			}
		})
	}
}

// floorDivInt64 must match JS Math.floor semantics even with a negative
// numerator (reachable via grossMarginBps when a product is priced at a
// loss), not just Go's truncate-toward-zero `/`.
func TestFloorDivInt64_NegativeNumeratorFloorsTowardNegativeInfinity(t *testing.T) {
	cases := []struct {
		num, den, want int64
	}{
		{-1, 3, -1},  // Go -1/3 == 0 (truncation); JS Math.floor(-1/3) == -1
		{-10, 3, -4}, // Go -10/3 == -3; JS floor(-3.33) == -4
		{-9, 3, -3},  // exact division, sign doesn't matter
		{10, 3, 3},   // positive/positive unaffected, sanity check
		{-10, -3, 3}, // both negative: JS floor(3.33) == 3, matches truncation
	}
	for _, c := range cases {
		if got := floorDivInt64(c.num, c.den); got != c.want {
			t.Errorf("floorDivInt64(%d, %d) = %d, want %d", c.num, c.den, got, c.want)
		}
	}
}

// ── CalculateUtilityPricing: fixed-amount product ────────────────────────

func TestCalculateUtilityPricing_FixedAmountProductPricesCorrectly(t *testing.T) {
	product := Product{
		AmountType:          AmountTypeFixed,
		AmountKobo:          ptr(500_000),
		MarkupBps:           150,
		ConvenienceFeeKobo:  5_000,
		ProviderDiscountBps: 100, // mapping leaves its own at 0, falls back here
	}
	mapping := ProviderMapping{
		Status:              MappingStatusActive,
		ProviderCostKobo:    nil,
		ProviderDiscountBps: 0,
	}

	got, err := CalculateUtilityPricing(product, mapping, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := Pricing{
		AmountKobo:         500_000,
		MarkupKobo:         7_500,
		ConvenienceFeeKobo: 5_000,
		RetailAmountKobo:   512_500,
		ProviderCostKobo:   495_000,
		GrossProfitKobo:    17_500,
		GrossMarginBps:     341,
	}
	if got != want {
		t.Errorf("CalculateUtilityPricing() = %+v, want %+v", got, want)
	}
}

// ── CalculateUtilityPricing: variable-amount product within bounds ──────

func TestCalculateUtilityPricing_VariableAmountWithinBoundsPricesCorrectly(t *testing.T) {
	product := Product{
		AmountType:          AmountTypeVariable,
		MinAmountKobo:       ptr(100_000),
		MaxAmountKobo:       ptr(1_000_000),
		MarkupBps:           250,
		ConvenienceFeeKobo:  10_000,
		ProviderDiscountBps: 200,
	}
	mapping := ProviderMapping{
		Status:              MappingStatusActive,
		ProviderCostKobo:    ptr(300_000), // used verbatim, discount fallback unused
		ProviderDiscountBps: 0,
	}
	requested := ptr(int64(333_333))

	got, err := CalculateUtilityPricing(product, mapping, requested)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := Pricing{
		AmountKobo:         333_333,
		MarkupKobo:         8_333,
		ConvenienceFeeKobo: 10_000,
		RetailAmountKobo:   351_666,
		ProviderCostKobo:   300_000,
		GrossProfitKobo:    51_666,
		GrossMarginBps:     1_469,
	}
	if got != want {
		t.Errorf("CalculateUtilityPricing() = %+v, want %+v", got, want)
	}
}

// ── CalculateUtilityPricing: variable-amount product outside bounds ─────

func TestCalculateUtilityPricing_VariableAmountOutsideBoundsErrors(t *testing.T) {
	product := Product{
		AmountType:    AmountTypeVariable,
		MinAmountKobo: ptr(100_000),
		MaxAmountKobo: ptr(1_000_000),
	}
	mapping := ProviderMapping{Status: MappingStatusActive, ProviderCostKobo: ptr(int64(1))}

	t.Run("below minimum", func(t *testing.T) {
		_, err := CalculateUtilityPricing(product, mapping, ptr(50_000))
		if !errors.Is(err, ErrAmountBelowMinimum) {
			t.Errorf("err = %v, want ErrAmountBelowMinimum", err)
		}
	})

	t.Run("above maximum", func(t *testing.T) {
		_, err := CalculateUtilityPricing(product, mapping, ptr(2_000_000))
		if !errors.Is(err, ErrAmountAboveMaximum) {
			t.Errorf("err = %v, want ErrAmountAboveMaximum", err)
		}
	})
}

// ── CalculateUtilityPricing: missing amount ──────────────────────────────

func TestCalculateUtilityPricing_MissingAmountErrors(t *testing.T) {
	mapping := ProviderMapping{Status: MappingStatusActive, ProviderCostKobo: ptr(int64(1))}

	t.Run("variable product without requested amount", func(t *testing.T) {
		product := Product{AmountType: AmountTypeVariable}
		_, err := CalculateUtilityPricing(product, mapping, nil)
		if !errors.Is(err, ErrAmountRequired) {
			t.Errorf("err = %v, want ErrAmountRequired", err)
		}
	})

	t.Run("fixed product with no configured amount", func(t *testing.T) {
		product := Product{AmountType: AmountTypeFixed, AmountKobo: nil}
		_, err := CalculateUtilityPricing(product, mapping, nil)
		if !errors.Is(err, ErrAmountRequired) {
			t.Errorf("err = %v, want ErrAmountRequired", err)
		}
	})
}

// ── CalculateUtilityPricing: non-positive provider cost errors ──────────

func TestCalculateUtilityPricing_NonPositiveProviderCostErrors(t *testing.T) {
	cases := []struct {
		name    string
		product Product
		mapping ProviderMapping
	}{
		{
			name:    "mapping cost explicitly zero, used verbatim (not treated as missing)",
			product: Product{AmountType: AmountTypeFixed, AmountKobo: ptr(100_000)},
			mapping: ProviderMapping{Status: MappingStatusActive, ProviderCostKobo: ptr(int64(0))},
		},
		{
			name:    "mapping cost explicitly negative",
			product: Product{AmountType: AmountTypeFixed, AmountKobo: ptr(100_000)},
			mapping: ProviderMapping{Status: MappingStatusActive, ProviderCostKobo: ptr(int64(-100))},
		},
		{
			name: "computed cost via 100% discount lands exactly on zero",
			product: Product{
				AmountType:          AmountTypeFixed,
				AmountKobo:          ptr(100_000),
				ProviderDiscountBps: 10_000, // 100% discount fallback
			},
			mapping: ProviderMapping{Status: MappingStatusActive, ProviderCostKobo: nil, ProviderDiscountBps: 0},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := CalculateUtilityPricing(c.product, c.mapping, nil)
			if !errors.Is(err, ErrProviderCostNotPositive) {
				t.Errorf("err = %v, want ErrProviderCostNotPositive", err)
			}
		})
	}
}
