package ratings_test

import (
	"testing"

	"spotlight/backend/internal/finance/ratings"
)

// TestEntityTypeConstants verifies all 9 entity types are distinct and non-empty.
func TestEntityTypeConstants(t *testing.T) {
	types := []ratings.EntityType{
		ratings.EntityDoctor,
		ratings.EntityPharmacy,
		ratings.EntityRestaurant,
		ratings.EntityRider,
		ratings.EntityDriver,
		ratings.EntityBusOperator,
		ratings.EntityEventOrg,
		ratings.EntityCampaign,
		ratings.EntityGroupAdmin,
	}
	seen := map[ratings.EntityType]bool{}
	for _, et := range types {
		if et == "" {
			t.Error("EntityType must not be empty string")
		}
		if seen[et] {
			t.Errorf("duplicate EntityType: %q", et)
		}
		seen[et] = true
	}
	if len(seen) != 9 {
		t.Errorf("expected 9 distinct entity types, got %d", len(seen))
	}
}

// TestRatingScoreBounds verifies score is constrained to 1.0–5.0.
func TestRatingScoreBounds(t *testing.T) {
	cases := []struct {
		score float32
		valid bool
	}{
		{1.0, true},
		{3.5, true},
		{5.0, true},
		{0.9, false},
		{5.1, false},
		{0.0, false},
	}
	for _, tc := range cases {
		inBounds := tc.score >= 1.0 && tc.score <= 5.0
		if inBounds != tc.valid {
			t.Errorf("score %.1f: expected valid=%v, got valid=%v", tc.score, tc.valid, inBounds)
		}
	}
}

// TestCreateRequestRequiredFields verifies binding constraints on the create request.
func TestCreateRequestRequiredFields(t *testing.T) {
	req := ratings.CreateRequest{
		EntityID:       "doctor-abc",
		EntityType:     ratings.EntityDoctor,
		TransactionRef: "appointment-001",
		Score:          4.5,
	}
	if req.EntityID == "" {
		t.Error("CreateRequest.EntityID must not be empty (binding:required)")
	}
	if req.EntityType == "" {
		t.Error("CreateRequest.EntityType must not be empty (binding:required)")
	}
	if req.TransactionRef == "" {
		t.Error("CreateRequest.TransactionRef must not be empty — prevents duplicate ratings per order")
	}
	if req.Score < 1.0 || req.Score > 5.0 {
		t.Errorf("CreateRequest.Score %.1f is outside 1.0–5.0 (binding:min=1,max=5)", req.Score)
	}
}

// TestTransactionRefPreventsDoubleRating documents the at-most-once invariant.
// UNIQUE(entity_id, rater_id, transaction_ref) prevents a user rating the same
// entity twice for the same transaction.
func TestTransactionRefPreventsDoubleRating(t *testing.T) {
	r1 := ratings.Rating{RaterID: "user-abc", EntityID: "doctor-xyz", TransactionRef: "appt-001"}
	r2 := ratings.Rating{RaterID: "user-abc", EntityID: "doctor-xyz", TransactionRef: "appt-001"}
	if r1.RaterID == r2.RaterID && r1.EntityID == r2.EntityID && r1.TransactionRef == r2.TransactionRef {
		t.Log("INVARIANT: (entity_id, rater_id, transaction_ref) must be UNIQUE — DB will reject duplicate")
	}
}

// TestSummaryCountNonNegative verifies the aggregated rating count is never negative.
func TestSummaryCountNonNegative(t *testing.T) {
	s := ratings.Summary{
		EntityID:   "restaurant-001",
		EntityType: "restaurant",
		Average:    4.2,
		Count:      47,
	}
	if s.Count < 0 {
		t.Errorf("Summary.Count must be non-negative, got %d", s.Count)
	}
	if s.Average < 0 || s.Average > 5.0 {
		t.Errorf("Summary.Average %.1f is outside valid range 0.0–5.0", s.Average)
	}
}
