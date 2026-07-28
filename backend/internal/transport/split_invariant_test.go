package transport

import (
	"testing"
)

// TestTransportSplitBuildersSumToOne locks the transport settlement split builders
// to the money invariant settlement.Settle enforces: the percentage split MUST sum
// to exactly 1.0 (settlement.Split.Validate). Covers:
//   - settlementSplit (provider/platform from a commission tier),
//   - settlementSplitAllProvider (tips: 100% provider, 0% platform).
func TestTransportSplitBuildersSumToOne(t *testing.T) {
	tiers := []*CommissionConfig{
		{Tier: "standard", ProviderPct: 0.80, PlatformPct: 0.20},
		{Tier: "low", ProviderPct: 0.88, PlatformPct: 0.12},
		{Tier: "fleet", ProviderPct: 0.85, PlatformPct: 0.15},
	}
	for _, c := range tiers {
		sp := settlementSplit("driver-user-1", c)
		if err := sp.Validate(); err != nil {
			t.Errorf("tier %s split must be valid: %v", c.Tier, err)
		}
	}

	tip := settlementSplitAllProvider("driver-user-1")
	if err := tip.Validate(); err != nil {
		t.Errorf("all-provider tip split must be valid: %v", err)
	}
}
