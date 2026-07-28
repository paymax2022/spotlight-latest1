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
