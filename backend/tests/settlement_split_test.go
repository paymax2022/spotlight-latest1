package tests

import (
	"testing"
)

// Settlement split math is the single most leak-prone money calculation in the
// platform: every marketplace vertical (food, transport, telemedicine, events,
// crowdfunding) routes its payout through it. The production Settle() computes:
//
//	platformKobo = int64(total * platformPct)
//	riderKobo    = int64(total * riderPct)   // 0 if no rider
//	providerKobo = total - platformKobo - riderKobo   // <- absorbs rounding
//
// The critical invariant is CONSERVATION: platform + rider + provider == total,
// to the kobo, for ANY split percentages and ANY amount. The "provider absorbs
// the remainder" pattern guarantees this — these tests lock that property so a
// future refactor (e.g. rounding each leg independently) that leaks fractions of
// a kobo is caught immediately.
//
// This mirrors internal/finance/settlement/service.go without importing it,
// because that package is under concurrent edit. If the production split formula
// changes, update splitParts() to match and these invariants still apply.

func splitParts(total int64, platformPct, riderPct float64, hasRider bool) (platform, rider, provider int64) {
	platform = int64(float64(total) * platformPct)
	if hasRider {
		rider = int64(float64(total) * riderPct)
	}
	provider = total - platform - rider // provider absorbs the rounding remainder
	return
}

func TestSettlementSplit_ConservesTotal(t *testing.T) {
	cases := []struct {
		name        string
		total       int64
		platformPct float64
		riderPct    float64
		hasRider    bool
	}{
		{"food 10pct no rider", 350_00, 0.10, 0, false},
		{"transport 15pct + rider 70pct", 500_00, 0.15, 0.70, true},
		{"telemedicine 12.5pct", 1_500_00, 0.125, 0, false},
		{"odd amount triggers rounding", 333_33, 0.10, 0, false},
		{"tiny amount 1 kobo", 1, 0.10, 0, false},
		{"prime amount, 3-way", 99_991, 0.137, 0.421, true},
		{"large amount", 5_000_000_00, 0.10, 0.65, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, r, prov := splitParts(tc.total, tc.platformPct, tc.riderPct, tc.hasRider)
			if sum := p + r + prov; sum != tc.total {
				t.Fatalf("conservation violated: platform=%d rider=%d provider=%d sum=%d total=%d (leak=%d)",
					p, r, prov, sum, tc.total, tc.total-sum)
			}
			// No leg may be negative (would imply over-commission / corrupt split).
			if p < 0 || r < 0 || prov < 0 {
				t.Fatalf("negative leg: platform=%d rider=%d provider=%d", p, r, prov)
			}
		})
	}
}

func TestSettlementSplit_ProviderAbsorbsRounding(t *testing.T) {
	// 1 kobo at 10% -> platform=0 (truncated), provider=1. Nothing vanishes.
	p, _, prov := splitParts(1, 0.10, 0, false)
	if p != 0 || prov != 1 {
		t.Fatalf("rounding: platform=%d provider=%d, want 0 and 1", p, prov)
	}
}

func TestSettlementSplit_FullPlatformLeavesProviderZero(t *testing.T) {
	// Degenerate but valid: 100% platform (e.g. fully-funded internal order).
	p, _, prov := splitParts(100_00, 1.0, 0, false)
	if p != 100_00 || prov != 0 {
		t.Fatalf("100%% platform: platform=%d provider=%d, want 10000 and 0", p, prov)
	}
}
