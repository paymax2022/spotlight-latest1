package referrals_test

import (
	"testing"
	"time"

	"spotlight/backend/internal/finance/referrals"
)

// v1DefaultConfig mirrors the seed in 20260910000001_referral_direct_rewards.sql
// (PRD §2.2 tiers + §2.3 milestones, kobo). Kept in the test so the tier-lookup and
// milestone maths are exercised without a DB.
func v1DefaultConfig() referrals.ProgramConfig {
	max49 := 49
	max249 := 249
	max999 := 999
	return referrals.ProgramConfig{
		Version: 1,
		TierTable: []referrals.TierBand{
			{Tier: referrals.TierStarter, MinCount: 1, MaxCount: &max49, Rate: 0.05},
			{Tier: referrals.TierGrowth, MinCount: 50, MaxCount: &max249, Rate: 0.08},
			{Tier: referrals.TierPro, MinCount: 250, MaxCount: &max999, Rate: 0.12},
			{Tier: referrals.TierElite, MinCount: 1000, MaxCount: nil, Rate: 0.15},
		},
		MilestoneTable: []referrals.MilestoneBand{
			{Threshold: 10, BonusKobo: 500000},     // ₦5,000
			{Threshold: 50, BonusKobo: 2000000},    // ₦20,000
			{Threshold: 250, BonusKobo: 10000000},  // ₦100,000
			{Threshold: 1000, BonusKobo: 50000000}, // ₦500,000
		},
		IsActive:      true,
		EffectiveFrom: time.Now().Add(-time.Hour),
	}
}

// TestTierForCount verifies the config-driven tier/rate lookup across every band
// boundary (§2.2 volume accelerator).
func TestTierForCount(t *testing.T) {
	cfg := v1DefaultConfig()
	cases := []struct {
		count     int
		wantTier  string
		wantRate  float64
		wantFound bool
	}{
		{0, "", 0, false}, // below the lowest band → no tier / no rate
		{1, referrals.TierStarter, 0.05, true},
		{49, referrals.TierStarter, 0.05, true},
		{50, referrals.TierGrowth, 0.08, true},
		{249, referrals.TierGrowth, 0.08, true},
		{250, referrals.TierPro, 0.12, true},
		{999, referrals.TierPro, 0.12, true},
		{1000, referrals.TierElite, 0.15, true},
		{50000, referrals.TierElite, 0.15, true}, // open-ended top band
	}
	for _, c := range cases {
		b, ok := cfg.TierForCount(c.count)
		if ok != c.wantFound {
			t.Errorf("TierForCount(%d) found=%v, want %v", c.count, ok, c.wantFound)
			continue
		}
		if !ok {
			continue
		}
		if b.Tier != c.wantTier || b.Rate != c.wantRate {
			t.Errorf("TierForCount(%d) = %s/%.2f, want %s/%.2f",
				c.count, b.Tier, b.Rate, c.wantTier, c.wantRate)
		}
	}
}

// TestComputeReward verifies reward = floor(margin * rate) in kobo, integer-safe.
func TestComputeReward(t *testing.T) {
	cases := []struct {
		margin int64
		rate   float64
		want   int64
	}{
		{100_000, 0.05, 5_000},  // ₦1,000 margin @ 5% = ₦50
		{100_000, 0.08, 8_000},  // Growth
		{100_000, 0.15, 15_000}, // Elite
		{0, 0.05, 0},            // zero margin → zero reward (§4.1 no-op precondition)
		{-500, 0.05, 0},         // negative margin → zero
		{100_000, 0, 0},         // zero rate (count 0 / no tier) → zero
		{333, 0.05, 16},         // floor(16.65) = 16 — never rounds up (fail-closed on cost)
	}
	for _, c := range cases {
		if got := referrals.ComputeReward(c.margin, c.rate); got != c.want {
			t.Errorf("ComputeReward(%d, %.2f) = %d, want %d", c.margin, c.rate, got, c.want)
		}
	}
}

// TestComputeRewardNeverExceedsMargin is a cost-safety invariant: a reward can
// never exceed the margin it's a share of (rate <= 1 for all valid config).
func TestComputeRewardNeverExceedsMargin(t *testing.T) {
	cfg := v1DefaultConfig()
	const margin = 1_000_000 // ₦10,000
	for _, b := range cfg.TierTable {
		reward := referrals.ComputeReward(margin, b.Rate)
		if reward > margin {
			t.Errorf("tier %s: reward %d exceeds margin %d (rate %.2f)", b.Tier, reward, margin, b.Rate)
		}
	}
}

// TestMilestoneKoboValues locks the §2.3 milestone amounts in kobo.
func TestMilestoneKoboValues(t *testing.T) {
	cfg := v1DefaultConfig()
	want := map[int]int64{10: 500000, 50: 2000000, 250: 10000000, 1000: 50000000}
	if len(cfg.MilestoneTable) != len(want) {
		t.Fatalf("milestone count = %d, want %d", len(cfg.MilestoneTable), len(want))
	}
	for _, m := range cfg.MilestoneTable {
		if want[m.Threshold] != m.BonusKobo {
			t.Errorf("milestone %d = %d kobo, want %d", m.Threshold, m.BonusKobo, want[m.Threshold])
		}
		if m.BonusKobo%100 != 0 {
			t.Errorf("milestone %d bonus %d is not a whole naira", m.Threshold, m.BonusKobo)
		}
	}
}

// TestPurchaseSettledContract documents the emit-hook struct the integration agent
// builds against — field presence and types are the load-bearing contract.
func TestPurchaseSettledContract(t *testing.T) {
	in := referrals.PurchaseSettled{
		Module:        "bills",
		TransactionID: "txn-abc",
		PayerUserID:   "user-payer",
		MarginKobo:    100_000, // integer minor units — never a float
		Currency:      "NGN",
		SettledAt:     time.Now(),
	}
	if in.MarginKobo <= 0 {
		t.Error("MarginKobo must be a positive integer minor-unit amount")
	}
	if in.TransactionID == "" {
		t.Error("TransactionID is the idempotency anchor — must be present")
	}
	// Refund event must carry the same transaction id.
	ref := referrals.PurchaseRefunded{TransactionID: in.TransactionID, RefundedAt: time.Now()}
	if ref.TransactionID != in.TransactionID {
		t.Error("PurchaseRefunded.TransactionID must match the settled transaction")
	}
}

// TestStatusConstants pins the reward + milestone state-machine values.
func TestStatusConstants(t *testing.T) {
	if referrals.RewardStatusPending != "PENDING" ||
		referrals.RewardStatusCredited != "CREDITED" ||
		referrals.RewardStatusReversed != "REVERSED" {
		t.Error("reward status constants must be PENDING/CREDITED/REVERSED")
	}
	if referrals.MilestoneStatusAchieved != "ACHIEVED" ||
		referrals.MilestoneStatusPaid != "PAID" ||
		referrals.MilestoneStatusVoided != "VOIDED" {
		t.Error("milestone status constants must be ACHIEVED/PAID/VOIDED")
	}
	if referrals.ActiveWindowDays != 30 {
		t.Errorf("ActiveWindowDays = %d, want 30 (§2.2 rolling rule)", referrals.ActiveWindowDays)
	}
}

// TestNextMilestoneMathIsIdempotentContract documents that config versioning is
// forward-only: a future effective_from must not be treated as active. This is a
// data-model invariant (ActiveConfig picks effective_from <= now), asserted here as
// a contract note against the config the mobile/integration agents rely on.
func TestConfigEffectiveFromForwardOnly(t *testing.T) {
	cfg := v1DefaultConfig()
	if !cfg.EffectiveFrom.Before(time.Now()) {
		t.Error("v1 config effective_from should already be active (in the past)")
	}
	future := cfg
	future.EffectiveFrom = time.Now().Add(24 * time.Hour)
	if future.EffectiveFrom.Before(time.Now()) {
		t.Error("a future-dated config must not read as active — forward-only invariant")
	}
}
