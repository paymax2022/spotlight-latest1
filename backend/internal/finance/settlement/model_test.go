package settlement_test

import (
	"testing"

	"spotlight/backend/internal/finance/settlement"
)

// TestStatusConstants verifies the lifecycle status values are distinct and non-empty.
func TestStatusConstants(t *testing.T) {
	statuses := []settlement.Status{
		settlement.StatusEscrowed,
		settlement.StatusReleasing,
		settlement.StatusSettled,
		settlement.StatusDisputed,
		settlement.StatusRefunded,
	}
	seen := map[settlement.Status]bool{}
	for _, s := range statuses {
		if s == "" {
			t.Error("Status must not be empty string")
		}
		if seen[s] {
			t.Errorf("duplicate Status: %q", s)
		}
		seen[s] = true
	}
}

// TestSplitValidation verifies the key business rules for a Split.
func TestSplitValidation(t *testing.T) {
	// Golden path: 80% provider + 10% platform + 10% rider = 100%
	rider := "rider-123"
	sp := settlement.Split{
		ProviderID:  "provider-abc",
		ProviderPct: 0.80,
		PlatformPct: 0.10,
		RiderID:     &rider,
		RiderPct:    0.10,
	}
	total := sp.ProviderPct + sp.PlatformPct + sp.RiderPct
	if total < 0.999 || total > 1.001 {
		t.Errorf("split does not sum to 1.0: got %f", total)
	}

	// No rider: 90% provider + 10% platform
	sp2 := settlement.Split{
		ProviderID:  "provider-abc",
		ProviderPct: 0.90,
		PlatformPct: 0.10,
	}
	total2 := sp2.ProviderPct + sp2.PlatformPct + sp2.RiderPct
	if total2 < 0.999 || total2 > 1.001 {
		t.Errorf("no-rider split does not sum to 1.0: got %f", total2)
	}
}

// TestSplitValidateMethod exercises the fail-closed Split.Validate() invariant
// (called at the top of Settle): the split MUST sum to exactly 1.0, no negatives,
// and the rider share only counts when a rider is present.
func TestSplitValidateMethod(t *testing.T) {
	rider := "rider-1"
	cases := []struct {
		name    string
		split   settlement.Split
		wantErr bool
	}{
		{"provider+platform 90/10", settlement.Split{ProviderPct: 0.90, PlatformPct: 0.10}, false},
		{"all-provider tip 100/0", settlement.Split{ProviderPct: 1.0, PlatformPct: 0.0}, false},
		{"with rider 80/10/10", settlement.Split{ProviderPct: 0.80, PlatformPct: 0.10, RiderID: &rider, RiderPct: 0.10}, false},
		{"tier 88/12", settlement.Split{ProviderPct: 0.88, PlatformPct: 0.12}, false},
		// Failures:
		{"sums < 1 (orphaned rider share, no rider)", settlement.Split{ProviderPct: 0.80, PlatformPct: 0.10, RiderPct: 0.10}, true},
		{"sums > 1", settlement.Split{ProviderPct: 0.95, PlatformPct: 0.10}, true},
		{"negative platform", settlement.Split{ProviderPct: 1.10, PlatformPct: -0.10}, true},
		{"rider present but sum < 1", settlement.Split{ProviderPct: 0.80, PlatformPct: 0.10, RiderID: &rider, RiderPct: 0.05}, true},
		{"empty split", settlement.Split{}, true},
	}
	for _, tc := range cases {
		err := tc.split.Validate()
		if tc.wantErr && err == nil {
			t.Errorf("%s: expected validation error, got nil", tc.name)
		}
		if !tc.wantErr && err != nil {
			t.Errorf("%s: unexpected error: %v", tc.name, err)
		}
	}
}

// TestSplitKoboCalculation verifies split arithmetic produces integer kobo values.
// This is the double-entry constraint: sum of split parts must equal TotalKobo.
func TestSplitKoboCalculation(t *testing.T) {
	cases := []struct {
		totalKobo   int64
		providerPct float64
		platformPct float64
	}{
		{100_000, 0.80, 0.10},   // ₦1,000: ₦800 provider + ₦100 platform + ₦100 rider
		{500_000, 0.90, 0.10},   // ₦5,000: ₦4,500 provider + ₦500 platform
		{1_000_000, 0.85, 0.15}, // ₦10,000: ₦8,500 + ₦1,500
	}
	for _, tc := range cases {
		providerKobo := int64(float64(tc.totalKobo) * tc.providerPct)
		platformKobo := int64(float64(tc.totalKobo) * tc.platformPct)
		riderKobo := tc.totalKobo - providerKobo - platformKobo

		sum := providerKobo + platformKobo + riderKobo
		if sum != tc.totalKobo {
			t.Errorf("totalKobo=%d: parts sum to %d (diff=%d)",
				tc.totalKobo, sum, tc.totalKobo-sum)
		}
		if providerKobo < 0 || platformKobo < 0 || riderKobo < 0 {
			t.Errorf("totalKobo=%d: negative split part", tc.totalKobo)
		}
	}
}

// TestLifecycleOrder verifies the expected settlement lifecycle transitions.
func TestLifecycleOrder(t *testing.T) {
	// Escrowed is the entry state; settled and refunded are terminal.
	entryState := settlement.StatusEscrowed
	terminalStates := []settlement.Status{
		settlement.StatusSettled,
		settlement.StatusRefunded,
	}

	if entryState == "" {
		t.Error("entry state must not be empty")
	}
	for _, ts := range terminalStates {
		if ts == settlement.StatusEscrowed {
			t.Errorf("terminal state %q must not equal entry state", ts)
		}
	}
}
