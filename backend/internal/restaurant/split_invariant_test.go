package restaurant_test

import (
	"testing"

	"spotlight/backend/internal/finance/settlement"
)

// TestRestaurantSplitInvariant locks the food-delivery settlement splits to the
// money invariant Settle enforces: the percentage split MUST sum to exactly 1.0
// (settlement.Split.Validate). This mirrors the two branches in Service.UpdateStatus
// (restaurant/service.go): with a rider 80/10/10, and with NO rider 90/10 (the
// rider share folds back into the restaurant so escrow is fully released).
func TestRestaurantSplitInvariant(t *testing.T) {
	rider := "rider-xyz"

	withRider := settlement.Split{
		ProviderID:  "owner-1",
		ProviderPct: 0.80,
		PlatformPct: 0.10,
		RiderID:     &rider,
		RiderPct:    0.10,
	}
	if err := withRider.Validate(); err != nil {
		t.Errorf("with-rider food split must be valid: %v", err)
	}

	noRider := settlement.Split{
		ProviderID:  "owner-1",
		ProviderPct: 0.90, // rider share folded in
		PlatformPct: 0.10,
	}
	if err := noRider.Validate(); err != nil {
		t.Errorf("no-rider food split must be valid: %v", err)
	}

	// Guard: the OLD (buggy) no-rider shape — provider 0.80, no rider, but a
	// lingering 0.10 rider pct — must now be REJECTED (it left 10% in escrow).
	buggy := settlement.Split{
		ProviderID:  "owner-1",
		ProviderPct: 0.80,
		PlatformPct: 0.10,
		RiderPct:    0.10, // no RiderID → orphaned
	}
	if err := buggy.Validate(); err == nil {
		t.Error("no-rider split with orphaned rider pct must be rejected (sums to 0.90)")
	}
}

// TestRestaurantTippedSplitShape locks the two Split SHAPES Service.settleOrder builds
// for a tipped order. The tip arithmetic itself (rider gets 100% of it, percentages
// price total − tip, conservation) is owned by settlement's own invariant suite; what
// this guards is that restaurant hands Settle a split it will accept in both branches.
// The end-to-end money assertions live in TestLiveDB_OrderTipEscrowAndRiderPayout.
func TestRestaurantTippedSplitShape(t *testing.T) {
	rider := "rider-xyz"
	const tip = int64(50_000) // ₦500

	withRider := settlement.Split{
		ProviderID:  "owner-1",
		ProviderPct: 0.80,
		PlatformPct: 0.10,
		RiderID:     &rider,
		RiderPct:    0.10,
		TipKobo:     tip,
	}
	if err := withRider.Validate(); err != nil {
		t.Errorf("tipped food split must be valid: %v", err)
	}

	// A tip needs a payee: settleOrder MUST zero the tip on the no-rider branch —
	// passing it through would fail Validate and wedge the order's escrow.
	orphanTip := settlement.Split{
		ProviderID:  "owner-1",
		ProviderPct: 0.90,
		PlatformPct: 0.10,
		TipKobo:     tip, // no RiderID
	}
	if err := orphanTip.Validate(); err == nil {
		t.Error("a tip with no rider must be rejected by Validate — settleOrder has to zero it")
	}
}
