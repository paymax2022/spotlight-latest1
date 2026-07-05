package maps

import "testing"

// coverage_test.go — pure tier-derivation rules (MAPSERVICE.md §5). DB-free.

func TestDeriveTier(t *testing.T) {
	cases := []struct {
		name           string
		escalationRate float64
		pinCount       int64
		sampleCount    int64
		want           CoverageTier
	}{
		{"too few samples holds at FAIR", 0.0, 10, minTierSamples - 1, TierFair},
		{"too few samples even with high escalation", 0.9, 0, 1, TierFair},
		{"high escalation demotes to LOW", 0.75, 0, 20, TierLow},
		{"escalation just over threshold demotes", demoteEscalationRate + 0.01, 0, 20, TierLow},
		{"escalation exactly at demote threshold does not demote", demoteEscalationRate, 0, 20, TierFair},
		{"low escalation + enough pins promotes to GOOD", 0.10, promotePinCount, 20, TierGood},
		{"low escalation but too few pins stays FAIR", 0.10, promotePinCount - 1, 20, TierFair},
		{"promote threshold boundary with pins is GOOD", promoteEscalationRate, promotePinCount, 20, TierGood},
		{"mid escalation stays FAIR", 0.35, 10, 20, TierFair},
		{"zero escalation, zero pins, enough samples stays FAIR", 0.0, 0, 20, TierFair},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := deriveTier(tc.escalationRate, tc.pinCount, tc.sampleCount)
			if got != tc.want {
				t.Fatalf("deriveTier(%v, %d, %d) = %q, want %q",
					tc.escalationRate, tc.pinCount, tc.sampleCount, got, tc.want)
			}
		})
	}
}

// A fresh GOOD area that starts seeing escalations should eventually demote.
func TestDeriveTierDemotionTrajectory(t *testing.T) {
	// Reliable area: low escalation, many pins → GOOD.
	if got := deriveTier(0.05, 5, 50); got != TierGood {
		t.Fatalf("reliable area: got %q, want GOOD", got)
	}
	// Same area degrades (escalation climbs past 0.5) → LOW.
	if got := deriveTier(0.6, 5, 50); got != TierLow {
		t.Fatalf("degraded area: got %q, want LOW", got)
	}
}

// SeedLagos cell keys must be stable and distinct for distinct areas.
func TestLagosSeedCellKeys(t *testing.T) {
	seen := map[string]string{}
	for _, s := range lagosSeeds {
		cell := CellKey(s.lat, s.lng)
		if cell == "" {
			t.Fatalf("%s produced empty cell key", s.name)
		}
		if prev, dup := seen[cell]; dup {
			t.Errorf("cell collision: %s and %s both map to %q", prev, s.name, cell)
		}
		seen[cell] = s.name
	}
	if len(lagosSeeds) < 5 {
		t.Errorf("expected a handful of Lagos seeds, got %d", len(lagosSeeds))
	}
}
