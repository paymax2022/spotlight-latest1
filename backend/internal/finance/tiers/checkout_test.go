package tiers

import (
	"errors"
	"testing"
)

// sentinel for "rejected, and not via the allowance error"
var errNonPositive = errors.New("non-positive")

// The Tier-0 checkout allowance (ADR-043) is a KYC relaxation, so these tests are
// mostly about what it must NOT do.
//
// The money bug it exists to prevent: ADR-042 lets a Tier-0 customer fund their
// wallet by card for a purchase in flight. Without a matching spend gate they are
// charged, credited, and then refused at escrow — left holding money they cannot
// spend and (being Tier 0) cannot withdraw. That is strictly worse than the clean
// "complete KYC" refusal they used to get.
//
// The money bug it must not CREATE: ADR-042's whole safety argument is that a
// Tier-0 account cannot get value back out. If this allowance ever reached a
// cash-out path, that argument collapses.

// decide is the PRODUCTION rule, not a copy of it. An earlier version of this file
// re-implemented the logic here; a mutation run proved that useless — changing the
// real cap left every test green. Call the real thing.
var decide = checkoutDecision

// With the flag off, a Tier-0 account is refused exactly as before this change.
// Nothing ships switched on.
func TestCheckoutAllowance_DisabledByDefault(t *testing.T) {
	s := &Service{}
	if s.checkoutAllowance {
		t.Fatal("a Service built without WithCheckoutAllowance must refuse Tier 0 — an unwired call site must be stricter, never looser")
	}
	if err := decide(false, 100_000, 0); !errors.Is(err, ErrWalletDisabled) {
		t.Fatalf("flag off must return ErrWalletDisabled, got %v", err)
	}
	if !s.WithCheckoutAllowance(true).checkoutAllowance {
		t.Fatal("WithCheckoutAllowance(true) must enable the allowance")
	}
	if s.WithCheckoutAllowance(false).checkoutAllowance {
		t.Fatal("WithCheckoutAllowance(false) must be a working kill switch")
	}
}

func TestCheckoutAllowance_Bounds(t *testing.T) {
	cases := []struct {
		name         string
		amount, used int64
		wantErr      error
	}{
		{"a normal purchase inside the allowance", 350_000, 0, nil},
		{"exactly the per-purchase ceiling", CheckoutMaxSingleKobo, 0, nil},
		{"a kobo over the per-purchase ceiling", CheckoutMaxSingleKobo + 1, 0, ErrCheckoutAllowanceExceeded},
		{"exactly exhausting the window", CheckoutMaxSingleKobo, CheckoutAllowanceKobo - CheckoutMaxSingleKobo, nil},
		// The debit that CROSSES the cap is the one refused — checking `used`
		// alone would let a final purchase straddle the limit.
		{"a kobo over the window", 100_001, CheckoutAllowanceKobo - 100_000, ErrCheckoutAllowanceExceeded},
		{"window already exhausted", 1, CheckoutAllowanceKobo, ErrCheckoutAllowanceExceeded},
		{"zero is not a purchase", 0, 0, errNonPositive},
		{"a negative debit is never a credit", -350_000, 0, errNonPositive},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := decide(true, tc.amount, tc.used)
			switch {
			case tc.wantErr == nil && err != nil:
				t.Fatalf("want allowed, got %v", err)
			case tc.wantErr != nil && err == nil:
				t.Fatalf("want %v, got allowed — an unverified account would move money it is not entitled to", tc.wantErr)
			case errors.Is(tc.wantErr, ErrCheckoutAllowanceExceeded) && !errors.Is(err, ErrCheckoutAllowanceExceeded):
				t.Fatalf("want ErrCheckoutAllowanceExceeded, got %v", err)
			}
		})
	}
}

// The allowance must never exceed what the top-up side will fund. If the spend cap
// were the larger of the two, a Tier-0 customer could reach a purchase they cannot
// be funded for; if the per-purchase ceiling exceeded the window, the window would
// be decorative.
func TestCheckoutAllowance_AgreesWithTheFundingSide(t *testing.T) {
	if CheckoutMaxSingleKobo > CheckoutAllowanceKobo {
		t.Fatalf("per-purchase ceiling %d exceeds the rolling allowance %d", CheckoutMaxSingleKobo, CheckoutAllowanceKobo)
	}
	// Mirrors frontend-web/src/server/wallet/topup-gate.ts. These are compliance
	// parameters and must move together — a mismatch strands customers between the
	// funding gate and the spending gate.
	const wantSingle, wantWindow = 1_000_000, 2_000_000
	if CheckoutMaxSingleKobo != wantSingle || CheckoutAllowanceKobo != wantWindow {
		t.Fatalf("Go allowance (%d single / %d window) drifted from topup-gate.ts (%d / %d) — update both or customers get funded for purchases they cannot make",
			CheckoutMaxSingleKobo, CheckoutAllowanceKobo, wantSingle, wantWindow)
	}
}

// ErrCheckoutAllowanceExceeded must stay distinct from ErrDailyLimitExceeded and
// ErrWalletDisabled: the three mean different things to a customer ("verify to
// raise this", "you hit today's cap", "wallet off") and handlers map them to
// different responses.
func TestCheckoutAllowance_ErrorsAreDistinct(t *testing.T) {
	if errors.Is(ErrCheckoutAllowanceExceeded, ErrDailyLimitExceeded) ||
		errors.Is(ErrCheckoutAllowanceExceeded, ErrWalletDisabled) {
		t.Fatal("ErrCheckoutAllowanceExceeded must not alias another tier error")
	}
}

// Tier 1+ must be completely unaffected. EnforceCheckoutDebitLimit delegates to
// EnforceWalletDebitLimit for every non-zero tier, so the relaxation cannot widen
// a verified account's limits.
func TestCheckoutAllowance_OnlyTier0Differs(t *testing.T) {
	for _, tier := range []Tier{Tier1, Tier2, Tier3} {
		if tier == Tier0 {
			t.Fatalf("Tier %d must not equal Tier0", tier)
		}
		// The configs the delegated path uses are untouched by this change.
		got := GetConfig(tier)
		if got.Tier != tier {
			t.Fatalf("GetConfig(%d) returned tier %d", tier, got.Tier)
		}
	}
	// And Tier 0's own strict config is unchanged: the allowance is an override in
	// one method, not a rewrite of the tier table.
	if GetConfig(Tier0).DailyDebitLimitKobo != 0 {
		t.Fatal("Tier0's daily debit limit must stay 0 — EnforceWalletDebitLimit still refuses it")
	}
}
