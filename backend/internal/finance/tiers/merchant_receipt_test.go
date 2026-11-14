package tiers

import (
	"errors"
	"testing"
)

// The merchant half of the ADR-001 tier table: how much a single order may be worth
// BEFORE it may be RECEIVED by an account at this KYC level.
// These tests pin the coherence property the feature exists for — the ceiling is the
// SAME ladder a customer is held to, not a second scale invented for restaurants. If
// ops changes a tier's cap in tierConfigs, the merchant ceiling for that tier moves
// with it; a test that hard-coded 5_000_000 twice would stay green while the two
// drifted apart, so both derivations are asserted.

func TestMerchantReceiptLimit_FollowsTheTierLadder(t *testing.T) {
	cases := []struct {
		tier Tier
		want int64
		why  string
	}{
		{Tier0, SmallTransactionMaxKobo, "unverified gets the same per-transaction ceiling ADR-001 gives an unverified SPENDER"},
		{Tier1, 5_000_000, "BVN verified — ₦50,000"},
		{Tier2, 20_000_000, "ID verified — ₦200,000"},
		{Tier3, 0, "full KYC — unlimited"},
		{Tier(9), SmallTransactionMaxKobo, "an unknown tier falls back to the strictest config, exactly like GetConfig"},
		{Tier(-1), SmallTransactionMaxKobo, "a nonsensical tier must never read as 0 = unlimited"},
	}
	for _, tc := range cases {
		if got := MerchantReceiptLimitKobo(tc.tier); got != tc.want {
			t.Errorf("MerchantReceiptLimitKobo(%d) = %d, want %d (%s)", tc.tier, got, tc.want, tc.why)
		}
	}
}

// The verified tiers are capped at THEIR OWN daily debit cap — the number a customer
// at that level may already spend in a day. Deriving from GetConfig instead of a
// second literal is what keeps "consistent with tier KYC" true after a compliance
// change to the tier table.
func TestMerchantReceiptLimit_VerifiedTiersMirrorTheirOwnDailyCap(t *testing.T) {
	for _, tier := range []Tier{Tier1, Tier2} {
		merchant := MerchantReceiptLimitKobo(tier)
		if want := GetConfig(tier).DailyDebitLimitKobo; merchant != want {
			t.Errorf("tier %d: merchant receipt ceiling %d != that tier's daily debit cap %d", tier, merchant, want)
		}
	}
}

// decideMerchant is the PRODUCTION rule, not a copy of it (see checkout_test.go's
// `decide`, which is already taken in this package).
var decideMerchant = merchantReceiptDecision

func TestMerchantReceiptDecision_Bounds(t *testing.T) {
	cases := []struct {
		name   string
		limit  int64
		amount int64
		want   error
	}{
		{"inside the ceiling", 5_000_000, 4_999_999, nil},
		{"exactly at the ceiling", 5_000_000, 5_000_000, nil},
		// The order that CROSSES the ceiling is the one refused.
		{"a kobo over the ceiling", 5_000_000, 5_000_001, ErrMerchantOrderLimitExceeded},
		{"unlimited tier admits anything", 0, 9_200_000_000_000, nil},
		// A zero-value order (a fully discounted collection) is not this gate's
		// problem — it has nothing to receive.
		{"a free order is not a refusal", 2_000_000, 0, nil},
	}
	for _, tc := range cases {
		err := decideMerchant(tc.limit, tc.amount)
		if tc.want == nil && err != nil {
			t.Errorf("%s: got %v, want accept", tc.name, err)
		}
		if tc.want != nil && !errors.Is(err, tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, err, tc.want)
		}
	}
}
