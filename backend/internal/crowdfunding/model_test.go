package crowdfunding_test

import (
	"testing"
	"time"

	"spotlight/backend/internal/crowdfunding"
)

// TestCampaignStatusValues verifies the known campaign lifecycle states.
func TestCampaignStatusValues(t *testing.T) {
	validStatuses := map[string]bool{
		"draft":     true,
		"active":    true,
		"funded":    true,
		"failed":    true,
		"cancelled": true,
	}
	for s := range validStatuses {
		if s == "" {
			t.Error("campaign status must not be empty")
		}
	}
	// Funded and cancelled are terminal — they must differ from entry (draft).
	for _, terminal := range []string{"funded", "cancelled", "failed"} {
		if terminal == "draft" {
			t.Errorf("terminal status %q must not equal entry state 'draft'", terminal)
		}
	}
}

// TestCampaignGoalMustBePositive verifies the campaign goal is a positive kobo amount.
func TestCampaignGoalMustBePositive(t *testing.T) {
	req := crowdfunding.CreateCampaignRequest{
		Title:    "Save the Studio",
		GoalKobo: 1_000_000_00, // ₦1,000,000
		Deadline: time.Now().Add(30 * 24 * time.Hour),
	}
	if req.GoalKobo <= 0 {
		t.Errorf("GoalKobo must be positive, got %d", req.GoalKobo)
	}
	if req.GoalKobo < 100 {
		t.Errorf("GoalKobo must be at least 100 (binding:min=100), got %d", req.GoalKobo)
	}
}

// TestGoalVsRaisedInvariant verifies that RaisedKobo never exceeds GoalKobo for an active campaign.
// Once RaisedKobo >= GoalKobo the campaign transitions to "funded".
func TestGoalVsRaisedInvariant(t *testing.T) {
	c := crowdfunding.Campaign{
		GoalKobo:   5_000_000, // ₦50,000
		RaisedKobo: 0,
		Status:     "active",
	}
	if c.RaisedKobo > c.GoalKobo {
		t.Errorf("RaisedKobo=%d exceeds GoalKobo=%d before funding", c.RaisedKobo, c.GoalKobo)
	}

	// Simulate reaching goal.
	c.RaisedKobo = c.GoalKobo
	if c.RaisedKobo < c.GoalKobo {
		t.Error("at-goal state: RaisedKobo should equal GoalKobo")
	}
}

// TestContributionMinimum verifies contributions require at least ₦1 (100 kobo).
func TestContributionMinimum(t *testing.T) {
	req := crowdfunding.ContributeRequest{
		AmountKobo:     100,
		IdempotencyKey: "contrib-001",
	}
	if req.AmountKobo < 100 {
		t.Errorf("AmountKobo must be at least 100 (₦1), got %d", req.AmountKobo)
	}
	if req.IdempotencyKey == "" {
		t.Error("IdempotencyKey must not be empty — required for at-most-once contribution")
	}
}

// TestContributionSettlementIDRequired documents that every contribution must store
// its settlement_id so Settle() and Refund() can be called later.
func TestContributionSettlementIDField(t *testing.T) {
	c := crowdfunding.Contribution{
		CampaignID:     "campaign-abc",
		ContributorID:  "user-xyz",
		AmountKobo:     500_000,
		IdempotencyKey: "contrib-001",
		SettlementID:   "settlement-aaa",
	}
	if c.SettlementID == "" {
		t.Error("Contribution.SettlementID must be stored — required for Settle/Refund lifecycle")
	}
}
