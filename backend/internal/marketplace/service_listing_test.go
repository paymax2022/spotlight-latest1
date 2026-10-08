package marketplace

import "testing"

func TestValidateCondition(t *testing.T) {
	cases := []struct {
		name      string
		condition string
		isVehicle bool
		wantErr   bool
	}{
		{"new, non-vehicle", "new", false, false},
		{"used, non-vehicle", "used", false, false},
		{"refurbished, non-vehicle", "refurbished", false, false},
		{"new, vehicle", "new", true, false},
		{"foreign_used on Vehicles is allowed", "foreign_used", true, false},
		{"local_used on Vehicles is allowed", "local_used", true, false},
		{"foreign_used outside Vehicles is rejected", "foreign_used", false, true},
		{"local_used outside Vehicles is rejected", "local_used", false, true},
		{"unknown condition is rejected regardless of category", "mint", true, true},
		{"empty condition is rejected", "", false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateCondition(tc.condition, tc.isVehicle)
			if tc.wantErr && err == nil {
				t.Errorf("validateCondition(%q, %v) = nil, want error", tc.condition, tc.isVehicle)
			}
			if !tc.wantErr && err != nil {
				t.Errorf("validateCondition(%q, %v) = %v, want nil", tc.condition, tc.isVehicle, err)
			}
		})
	}
}

// TestListingTombstoned pins the public detail-read gate (E2E-SOC-037): only the
// two soft-delete tombstones must 404 on GET /listings/:id. Every lifecycle
// status stays readable — the route is auth-optional and the seller's own
// detail view of a non-live listing comes through it (SOC-004 asserts
// pending_review at 200).
func TestListingTombstoned(t *testing.T) {
	cases := []struct {
		status ListingStatus
		want   bool
	}{
		{ListingRemovedUser, true},
		{ListingRemovedPolicy, true},
		{ListingDraft, false},
		{ListingPendingReview, false},
		{ListingActive, false},
		{ListingPaused, false},
		{ListingExpired, false},
		{ListingSold, false},
	}
	for _, tc := range cases {
		t.Run(string(tc.status), func(t *testing.T) {
			if got := listingTombstoned(tc.status); got != tc.want {
				t.Errorf("listingTombstoned(%q) = %v, want %v", tc.status, got, tc.want)
			}
		})
	}
}
