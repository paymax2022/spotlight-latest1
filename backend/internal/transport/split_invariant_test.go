package transport

import (
	"testing"

	"spotlight/backend/internal/finance/settlement"
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
		sp := settlementSplit("driver-user-1", c, 0)
		if err := sp.Validate(); err != nil {
			t.Errorf("tier %s split must be valid: %v", c.Tier, err)
		}
	}

	tip := settlementSplitAllProvider("driver-user-1")
	if err := tip.Validate(); err != nil {
		t.Errorf("all-provider tip split must be valid: %v", err)
	}
}

// TestParcelInsuranceSettlement_PlatformOnly proves the actual money-movement
// invariant behind the insurance-premium fix: a courier's commission split
// must apply ONLY to the fare, never to the insurance premium riding alongside
// it in the same escrow. Uses settlement.ComputeLegs directly — the same
// function Service.Settle calls to move real money — so this fails the moment
// that guarantee breaks, not just when the split's own percentages stop
// summing to 1.0.
func TestParcelInsuranceSettlement_PlatformOnly(t *testing.T) {
	comm := &CommissionConfig{Tier: "standard", ProviderPct: 0.80, PlatformPct: 0.20}
	fareKobo := int64(160_000)
	insuranceKobo := int64(15_000)
	totalKobo := fareKobo + insuranceKobo

	split := settlementSplit("courier-1", comm, insuranceKobo)
	legs, err := settlement.ComputeLegs(totalKobo, split)
	if err != nil {
		t.Fatalf("ComputeLegs: %v", err)
	}
	wantProvider := int64(float64(fareKobo) * comm.ProviderPct) // 128000
	wantPlatform := int64(float64(fareKobo)*comm.PlatformPct) + insuranceKobo // 32000 + 15000
	if legs.ProviderKobo != wantProvider {
		t.Errorf("courier leg = %d, want %d (must be computed off fare only, never insurance)", legs.ProviderKobo, wantProvider)
	}
	if legs.PlatformKobo != wantPlatform {
		t.Errorf("platform leg = %d, want %d (fare share + the FULL insurance premium)", legs.PlatformKobo, wantPlatform)
	}
	if legs.ProviderKobo+legs.PlatformKobo+legs.RiderKobo != totalKobo {
		t.Errorf("legs don't sum to the escrowed total: %d+%d+%d != %d", legs.ProviderKobo, legs.PlatformKobo, legs.RiderKobo, totalKobo)
	}
}
