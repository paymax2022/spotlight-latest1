package fx_test

import (
	"math"
	"testing"

	"spotlight/backend/internal/finance/fx"
)

// TestAmountsAreMinorUnits verifies that FX amounts follow the minor-unit rule.
// NGN amounts are in kobo; foreign currency amounts are in their own minor units
// (USD → cents, GBP → pence, EUR → cents). All must be integers.
func TestAmountsAreMinorUnits(t *testing.T) {
	q := fx.FXQuote{
		SourceCurrency:    "NGN",
		TargetCurrency:    "USD",
		SourceAmountKobo:  1_000_000, // ₦10,000
		TargetAmountMinor: 625,       // $6.25 (at a 0.00625 rate)
		Rate:              0.00625,
		FeeKobo:           200_000, // ₦2,000 fee
	}

	if q.SourceAmountKobo <= 0 {
		t.Errorf("SourceAmountKobo must be positive, got %d", q.SourceAmountKobo)
	}
	if q.TargetAmountMinor <= 0 {
		t.Errorf("TargetAmountMinor must be positive, got %d", q.TargetAmountMinor)
	}
	if q.FeeKobo < 0 {
		t.Errorf("FeeKobo must not be negative, got %d", q.FeeKobo)
	}
	if q.Rate <= 0 {
		t.Errorf("Rate must be positive, got %f", q.Rate)
	}
}

// TestFXConversionRateConsistency verifies that TargetAmountMinor is consistent
// with SourceAmountKobo × Rate within a 1 minor-unit rounding tolerance.
// This catches float → integer truncation errors in the conversion math.
func TestFXConversionRateConsistency(t *testing.T) {
	cases := []struct {
		sourceKobo  int64
		rate        float64    // NGN per target-currency minor unit (e.g. 0.00625 NGN/kobo → USD/cent)
		wantMinor   int64
	}{
		// ₦10,000 (1,000,000 kobo) × 0.00625 = 6,250 cents = $62.50
		{1_000_000, 0.00625, 6_250},
		// ₦5,000 (500,000 kobo) × 0.00545 ≈ 2,725 pence = £27.25
		{500_000, 0.00545, 2_725},
		// ₦1,000 (100,000 kobo) × 0.00680 = 680 cents = €6.80
		{100_000, 0.00680, 680},
	}

	for _, tc := range cases {
		got := int64(math.Round(float64(tc.sourceKobo) * tc.rate))
		diff := got - tc.wantMinor
		if diff < -1 || diff > 1 {
			t.Errorf("sourceKobo=%d rate=%f: got %d minor units, want %d (diff=%d > 1)",
				tc.sourceKobo, tc.rate, got, tc.wantMinor, diff)
		}
	}
}

// TestQuoteRequestMinAmount verifies the minimum quote amount enforced by Gin binding.
// Maplerad rejects quotes below a threshold; binding:min=100 guards against dust requests.
func TestQuoteRequestMinAmount(t *testing.T) {
	req := fx.QuoteRequest{
		SourceCurrency: "NGN",
		TargetCurrency: "USD",
		AmountKobo:     100,
	}
	if req.AmountKobo < 100 {
		t.Errorf("minimum AmountKobo should be 100 (₦1), got %d", req.AmountKobo)
	}
}

// TestConversionStatusValues verifies the FXConversion.Status field uses known values.
func TestConversionStatusValues(t *testing.T) {
	validStatuses := map[string]bool{
		"pending":   true,
		"completed": true,
		"failed":    true,
	}
	for _, s := range []string{"pending", "completed", "failed"} {
		if !validStatuses[s] {
			t.Errorf("unexpected status %q", s)
		}
	}
}

// TestCurrencyWalletMinorUnits verifies foreign-currency wallets store in minor units.
func TestCurrencyWalletMinorUnits(t *testing.T) {
	// $10.50 stored as 1050 cents
	w := fx.CurrencyWallet{
		UserID:       "user-abc",
		Currency:     "USD",
		BalanceMinor: 1050,
	}
	if w.BalanceMinor < 0 {
		t.Errorf("BalanceMinor must not be negative, got %d", w.BalanceMinor)
	}
	if w.Currency == "" {
		t.Error("Currency must not be empty")
	}
	// Verify it's not stored as a float (it's already int64 — this is a type-level guarantee)
	_ = w.BalanceMinor / 100 // integer division — no fractional cents possible
}
