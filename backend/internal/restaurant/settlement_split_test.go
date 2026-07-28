package restaurant

import "testing"

// TestOrderSettlementSplit locks the food-order payout policy, including rider-tip
// routing. It is pure (no DB): the split is the single source of truth the settlement
// engine then executes, and settlement's own invariant tests prove that split
// conserves value exactly. Here we only assert this module hands settlement the RIGHT
// split for each order shape.
func TestOrderSettlementSplit(t *testing.T) {
	riderID := "rider-1"

	t.Run("rider assigned, with tip → 80/10/10 + tip to rider", func(t *testing.T) {
		sp := orderSettlementSplit("owner-1", &riderID, 5_000, 0, 0, false)
		if sp.ProviderID != "owner-1" || sp.ProviderPct != 0.80 || sp.PlatformPct != 0.10 || sp.RiderPct != 0.10 {
			t.Fatalf("unexpected base split: %+v", sp)
		}
		if sp.RiderID == nil || *sp.RiderID != riderID {
			t.Fatalf("rider not set: %+v", sp)
		}
		if sp.TipKobo != 5_000 {
			t.Fatalf("tip should route 100%% to the rider leg, got TipKobo=%d", sp.TipKobo)
		}
		if err := sp.Validate(); err != nil {
			t.Fatalf("split must be valid: %v", err)
		}
	})

	t.Run("rider assigned, no tip → 80/10/10, zero tip", func(t *testing.T) {
		sp := orderSettlementSplit("owner-1", &riderID, 0, 0, 0, false)
		if sp.TipKobo != 0 || sp.RiderPct != 0.10 {
			t.Fatalf("unexpected split: %+v", sp)
		}
		if err := sp.Validate(); err != nil {
			t.Fatalf("split must be valid: %v", err)
		}
	})

	t.Run("no rider, with tip → 90/10 fold, tip NOT attached to a nil rider", func(t *testing.T) {
		// The critical edge case: a tip with no rider must NOT produce an invalid
		// split (settlement.Split rejects a tip with no RiderID). The tip folds into
		// the total and reaches the self-delivering owner via the 90% base share.
		sp := orderSettlementSplit("owner-1", nil, 5_000, 0, 0, false)
		if sp.RiderID != nil {
			t.Fatalf("no rider expected, got %v", *sp.RiderID)
		}
		if sp.ProviderPct != 0.90 || sp.PlatformPct != 0.10 || sp.RiderPct != 0 {
			t.Fatalf("no-rider split should be 90/10: %+v", sp)
		}
		if sp.TipKobo != 0 {
			t.Fatalf("tip must not attach to a nil rider leg, got TipKobo=%d", sp.TipKobo)
		}
		if err := sp.Validate(); err != nil {
			t.Fatalf("no-rider split must be valid (this is the tip-without-rider guard): %v", err)
		}
	})

	t.Run("platform-funded promo → discount off platform leg", func(t *testing.T) {
		sp := orderSettlementSplit("owner-1", &riderID, 0, 10_000, 0, true)
		if sp.DiscountKobo != 10_000 || !sp.DiscountFundedByPlatform {
			t.Fatalf("platform-funded discount not routed: %+v", sp)
		}
		if err := sp.Validate(); err != nil {
			t.Fatalf("split must be valid: %v", err)
		}
	})

	t.Run("restaurant-funded promo → discount off provider remainder", func(t *testing.T) {
		sp := orderSettlementSplit("owner-1", &riderID, 0, 10_000, 0, false)
		if sp.DiscountKobo != 10_000 || sp.DiscountFundedByPlatform {
			t.Fatalf("restaurant-funded discount not routed: %+v", sp)
		}
	})

	t.Run("no rider + promo → 90/10 fold still carries the discount+funder", func(t *testing.T) {
		sp := orderSettlementSplit("owner-1", nil, 0, 7_500, 0, true)
		if sp.DiscountKobo != 7_500 || !sp.DiscountFundedByPlatform {
			t.Fatalf("no-rider split must still bear the discount: %+v", sp)
		}
		if err := sp.Validate(); err != nil {
			t.Fatalf("no-rider promo split must be valid: %v", err)
		}
	})
}
