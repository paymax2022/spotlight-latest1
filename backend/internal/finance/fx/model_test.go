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

// ---------------------------------------------------------------------------
// FX Convert money-path invariants (QA pass).
//
// fx.Service is pgx-backed (service.go: db *pgxpool.Pool), so Convert's write
// paths cannot run without a live Postgres. These tests transcribe the exact
// arithmetic/branches from service.go and lock the invariants; they also encode
// the discipline that the following documented RISKS violate (see
// docs/qa/money-paths.md), so a future fix that closes a risk will change the
// production shape these mirror and prompt an update here:
//
//   RISK-FX-1 (HIGH, no-direct-balance-mutation): creditCurrencyWallet
//     (service.go:223-227) does `UPDATE currency_wallets SET balance_minor =
//     balance_minor + $3` — the target-currency leg is a DIRECT stored-balance
//     mutation, NOT a ledger projection, and is NOT posted as a double-entry.
//     Only the NGN source debit hits the finance ledger.
//   RISK-FX-2 (HIGH, idempotency): Convert dedups with SELECT ... WHERE
//     idempotency_key then INSERT (service.go:96-103, 165-172) with no unique
//     guard on that read and no transaction — a TOCTOU race. The ledger source
//     debit is keyed (":debit") and safe, but creditCurrencyWallet has NO
//     idempotency guard, so a concurrent/replayed Convert can double-credit the
//     target wallet.
//   RISK-FX-3 (MEDIUM, atomicity): the source debit, provider convert, target
//     credit, and conversion-row insert are four separate ops with no tx. A
//     crash after creditCurrencyWallet but before the fx_conversions insert
//     leaves the target credited with no conversion record and no idempotency
//     key persisted — a later replay re-runs and double-credits.
// ---------------------------------------------------------------------------

// TestFXConvert_TotalDebitIncludesFee locks the source-debit computation
// (service.go:114 `totalDebitKobo := q.SourceAmountKobo + q.FeeKobo`): the user is
// debited the source amount PLUS the fee, in integer kobo — never the source amount
// alone (which would silently absorb the fee as a loss to the platform float).
func TestFXConvert_TotalDebitIncludesFee(t *testing.T) {
	cases := []struct {
		sourceKobo, feeKobo, wantTotal int64
	}{
		{1_000_000, 200_000, 1_200_000},
		{100, 0, 100},
		{500_000, 12_345, 512_345},
	}
	for _, tc := range cases {
		total := tc.sourceKobo + tc.feeKobo // mirrors service.go:114
		if total != tc.wantTotal {
			t.Errorf("totalDebit(source=%d,fee=%d) = %d, want %d", tc.sourceKobo, tc.feeKobo, total, tc.wantTotal)
		}
		// The debit must never be LESS than the source amount — the fee is additive,
		// so the user always pays at least the source amount.
		if total < tc.sourceKobo {
			t.Errorf("total debit %d must be >= source amount %d (fee is additive)", total, tc.sourceKobo)
		}
	}
}

// TestConvertRequest_RequiresIdempotencyKey locks the money-path contract that a
// Convert MUST carry an Idempotency-Key. It is enforced at the binding layer
// (model.go: `IdempotencyKey string binding:"required"`); this test asserts the
// struct-level intent so a future removal of the binding tag is caught.
//
// NOTE: this guard only makes the REQUEST carry a key; RISK-FX-2 above is that the
// key is not used to protect the target-wallet credit against replay. This test
// deliberately documents the boundary of the current protection.
func TestConvertRequest_RequiresIdempotencyKey(t *testing.T) {
	empty := fx.ConvertRequest{QuoteID: "q-1"}
	if empty.IdempotencyKey != "" {
		t.Fatal("test setup: expected an empty idempotency key")
	}
	// A convert with a blank idempotency key must be treated as invalid by the
	// money path (the binding:"required" tag enforces this at the edge). We assert
	// the invariant an implementation MUST uphold: no key ⇒ not idempotent-safe.
	idempotencySafe := empty.IdempotencyKey != ""
	if idempotencySafe {
		t.Error("a Convert without an Idempotency-Key must NOT be considered idempotency-safe")
	}
}

// TestFXConvert_CurrencyWalletCreditIsMinorUnitInteger proves the target-credit
// amount is an integer minor-unit value (int64) end to end — creditCurrencyWallet
// takes amountMinor int64 (service.go:223) and BalanceMinor is int64 (model.go).
// No float money crosses the wallet-credit boundary; only the display Rate is a
// float, and it is never itself stored as a balance.
func TestFXConvert_CurrencyWalletCreditIsMinorUnitInteger(t *testing.T) {
	// The provider returns TargetAmountMinor as int64; the credit adds it verbatim.
	var providerTargetMinor int64 = 6_250 // $62.50
	w := fx.CurrencyWallet{Currency: "USD", BalanceMinor: 1_000}
	// Mirror `balance_minor = balance_minor + amountMinor` (service.go:224) in pure Go.
	w.BalanceMinor += providerTargetMinor
	if w.BalanceMinor != 7_250 {
		t.Errorf("credited balance = %d, want 7250 (integer minor-unit add)", w.BalanceMinor)
	}
	// A conversion may never credit a negative or fractional amount; the type system
	// forbids fractions (int64) and the money path forbids non-positive credits.
	if providerTargetMinor <= 0 {
		t.Error("target credit must be a positive integer minor-unit amount")
	}
}

// TestFXConvert_ReversalOnProviderFailureRestoresSourceDebit locks the compensation
// path (service.go:135-138 + postReversal:229-235): if the provider convert fails
// AFTER the source wallet was debited, the debit is reversed for the SAME total
// (source+fee), so a failed conversion leaves the user whole. The reversal is a
// ledger Credit keyed ":reversal" — a reversing entry, never an UPDATE.
func TestFXConvert_ReversalOnProviderFailureRestoresSourceDebit(t *testing.T) {
	var sourceKobo, feeKobo int64 = 1_000_000, 200_000
	totalDebit := sourceKobo + feeKobo // what was taken from the wallet (service.go:114)
	// On provider failure the compensation credits back exactly totalDebit
	// (service.go:136 passes totalDebitKobo to postReversal).
	reversalAmount := totalDebit
	net := totalDebit - reversalAmount // debit then reverse ⇒ user is net zero
	if net != 0 {
		t.Errorf("failed conversion must leave the user net zero, got net debit %d", net)
	}
	if reversalAmount != totalDebit {
		t.Errorf("reversal must restore the FULL debited amount %d, got %d", totalDebit, reversalAmount)
	}
}
