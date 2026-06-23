package tiers_test

import (
	"testing"

	"spotlight/backend/internal/finance/tiers"
)

// TestTierConfigs verifies the tier limit schedule matches product requirements.
// Iron rule: these numbers MUST NOT change without an ADR and a migration.
func TestTierConfigs(t *testing.T) {
	tests := []struct {
		tier               tiers.Tier
		wantDailyLimitKobo int64
		label              string
	}{
		{0, 0, "Tier 0 — no wallet access"},
		{1, 5_000_000, "Tier 1 — ₦50,000 daily limit"},
		{2, 20_000_000, "Tier 2 — ₦200,000 daily limit"},
		{3, 0, "Tier 3 — unlimited"},
	}
	for _, tc := range tests {
		cfg := tiers.GetConfig(tc.tier)
		if cfg.DailyDebitLimitKobo != tc.wantDailyLimitKobo {
			t.Errorf("%s: got DailyDebitLimitKobo=%d, want %d",
				tc.label, cfg.DailyDebitLimitKobo, tc.wantDailyLimitKobo)
		}
	}
}

// TestTier0IsDisabled verifies Tier 0 has zero limit (wallet disabled for unverified users).
func TestTier0IsDisabled(t *testing.T) {
	cfg := tiers.GetConfig(0)
	if cfg.DailyDebitLimitKobo != 0 {
		t.Errorf("Tier 0 should have zero daily limit (wallet disabled), got %d", cfg.DailyDebitLimitKobo)
	}
}

// TestTier3IsUnlimited verifies Tier 3 has no daily cap.
func TestTier3IsUnlimited(t *testing.T) {
	cfg := tiers.GetConfig(3)
	if cfg.DailyDebitLimitKobo != 0 {
		t.Errorf("Tier 3 should have zero limit (unlimited), got %d", cfg.DailyDebitLimitKobo)
	}
}

// TestLimitsAreInKobo verifies limit amounts are integers (no float, no naira).
func TestLimitsAreInKobo(t *testing.T) {
	for tier := tiers.Tier(0); tier <= 3; tier++ {
		cfg := tiers.GetConfig(tier)
		if cfg.DailyDebitLimitKobo > 0 && cfg.DailyDebitLimitKobo%100 != 0 {
			t.Errorf("Tier %d: DailyDebitLimitKobo=%d is not a whole naira amount",
				tier, cfg.DailyDebitLimitKobo)
		}
	}
}

// TestConfigForUnknownTierDefaultsToTier0 verifies that an unknown tier falls back to Tier 0.
func TestConfigForUnknownTierDefaultsToTier0(t *testing.T) {
	cfg := tiers.GetConfig(99)
	if cfg.DailyDebitLimitKobo != 0 {
		t.Errorf("Unknown tier should default to Tier 0 (wallet disabled), got %d", cfg.DailyDebitLimitKobo)
	}
}
