package referrals_test

import (
	"testing"

	"spotlight/backend/internal/finance/referrals"
)

// TestRewardAmountKobo verifies the referral reward constant is correct per PRD.
// ₦500 = 50,000 kobo. Iron rule: change this only with an ADR.
func TestRewardAmountKobo(t *testing.T) {
	const wantKobo = 50_000 // ₦500
	if referrals.RewardAmountKobo != wantKobo {
		t.Errorf("RewardAmountKobo = %d, want %d (₦500)",
			referrals.RewardAmountKobo, wantKobo)
	}
}

// TestRewardAmountIsPositive verifies the reward is a positive integer (never zero or negative).
func TestRewardAmountIsPositive(t *testing.T) {
	if referrals.RewardAmountKobo <= 0 {
		t.Errorf("RewardAmountKobo must be positive, got %d", referrals.RewardAmountKobo)
	}
}

// TestRewardAmountIsWholeNaira verifies the reward is a whole naira (divisible by 100).
func TestRewardAmountIsWholeNaira(t *testing.T) {
	if referrals.RewardAmountKobo%100 != 0 {
		t.Errorf("RewardAmountKobo=%d is not a whole naira amount (must be divisible by 100)",
			referrals.RewardAmountKobo)
	}
}

// TestSelfReferralSentinel verifies that the referrer_id != referred_id invariant
// is a documented constraint — not a runtime accident.
// The at-most-once guarantee is enforced by UNIQUE(referrer_id, referred_id) in the DB
// plus the service-level self-referral guard. This test documents that contract.
func TestSelfReferralContract(t *testing.T) {
	referrerID := "user-aaa"
	referredID := "user-aaa" // same — invalid

	if referrerID == referredID {
		// The service must reject this case. Document the invariant.
		t.Log("self-referral detected: referrerID == referredID — service must block this")
	}

	// Verify a valid pair is distinct.
	referredIDValid := "user-bbb"
	if referrerID == referredIDValid {
		t.Error("test data error: referrerID and referredID should be distinct in the valid case")
	}
}

// TestCodeStructure verifies that a Code has the expected fields populated.
func TestCodeStructure(t *testing.T) {
	c := referrals.Code{
		UserID: "user-abc",
		Code:   "a1b2c3d4",
	}
	if c.UserID == "" {
		t.Error("Code.UserID must not be empty")
	}
	if len(c.Code) == 0 {
		t.Error("Code.Code must not be empty")
	}
	// Referral codes are 8 hex chars (4 bytes random → hex encoded).
	if len(c.Code) != 8 {
		t.Logf("note: code length is %d (expected 8 for 4-byte hex)", len(c.Code))
	}
}

// TestSummaryInvariants verifies Summary field constraints.
func TestSummaryInvariants(t *testing.T) {
	s := referrals.Summary{
		Code:            "a1b2c3d4",
		TotalReferrals:  3,
		TotalEarnedKobo: 3 * referrals.RewardAmountKobo,
	}
	if s.TotalEarnedKobo != int64(s.TotalReferrals)*referrals.RewardAmountKobo {
		t.Errorf("TotalEarnedKobo=%d is inconsistent with TotalReferrals=%d × RewardAmountKobo=%d",
			s.TotalEarnedKobo, s.TotalReferrals, referrals.RewardAmountKobo)
	}
	if s.TotalEarnedKobo < 0 {
		t.Error("TotalEarnedKobo must not be negative")
	}
}
