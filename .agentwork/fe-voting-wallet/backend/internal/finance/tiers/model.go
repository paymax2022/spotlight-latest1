package tiers

import "fmt"

// Tier levels mirror the KYC tier model in ADR-001.
type Tier int

const (
	Tier0 Tier = 0 // unverified — wallet disabled
	Tier1 Tier = 1 // BVN verified
	Tier2 Tier = 2 // ID verified
	Tier3 Tier = 3 // full KYC
)

// TierConfig holds the daily and per-transaction limits for a tier.
type TierConfig struct {
	Tier                Tier
	DailyDebitLimitKobo int64 // 0 = disabled (Tier 0)
	MaxBalanceKobo      int64 // 0 = unlimited
}

var tierConfigs = map[Tier]TierConfig{
	Tier0: {Tier: Tier0, DailyDebitLimitKobo: 0, MaxBalanceKobo: 0},
	Tier1: {Tier: Tier1, DailyDebitLimitKobo: 5_000_000, MaxBalanceKobo: 30_000_000},   // ₦50k/day, ₦300k balance
	Tier2: {Tier: Tier2, DailyDebitLimitKobo: 20_000_000, MaxBalanceKobo: 500_000_000}, // ₦200k/day, ₦5M balance
	Tier3: {Tier: Tier3, DailyDebitLimitKobo: 0, MaxBalanceKobo: 0},                    // unlimited
}

// ErrWalletDisabled is returned for Tier0 users.
var ErrWalletDisabled = fmt.Errorf("tiers: wallet disabled for tier 0 — complete KYC to activate")

// ErrDailyLimitExceeded is returned when the daily debit limit is hit.
var ErrDailyLimitExceeded = fmt.Errorf("tiers: daily debit limit exceeded")

// GetConfig returns the TierConfig for a given tier level.
func GetConfig(t Tier) TierConfig {
	if cfg, ok := tierConfigs[t]; ok {
		return cfg
	}
	return tierConfigs[Tier0]
}
