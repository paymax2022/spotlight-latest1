package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB tests for campaign budget lines and reward tiers.
//
// Both were the milestones story again: cf_reward_tiers existed and nothing ever
// wrote it, cf_campaign_budget did not exist at all, and GetDetail returned empty
// arrays for both. The campaign page therefore said "0 budget items" under a
// heading promising to explain where the money goes, and offered no rewards on a
// campaign whose creator had defined them in the wizard.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run 'LiveDB_Budget|LiveDB_Reward' -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	cf "spotlight/backend/internal/crowdfunding"
)

// TestLiveDB_BudgetLinesPersistInOrder: a budget is a list the creator composed,
// so the order they entered it in is part of the content.
func TestLiveDB_BudgetLinesPersistInOrder(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	svc, creator := milestoneCreator(t, ctx)

	note := "quoted by the hospital"
	req := baseSubmit("Budget ordering")
	req.Budget = []cf.SubmitBudgetItemRequest{
		{Label: "Theatre fees", AmountKobo: 300000, Note: &note},
		{Label: "Medication", AmountKobo: 150000},
	}
	res, err := svc.SubmitForReview(ctx, creator, req)
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	campaignID, _ := res["campaignId"].(string)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM campaigns WHERE id=$1`, campaignID) })

	detail, err := svc.GetDetail(ctx, campaignID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	budget, _ := detail["budget"].([]map[string]any)
	if len(budget) != 2 {
		t.Fatalf("detail carries %d budget lines, want 2", len(budget))
	}
	if budget[0]["label"] != "Theatre fees" || budget[1]["label"] != "Medication" {
		t.Errorf("order not preserved: %v then %v", budget[0]["label"], budget[1]["label"])
	}
	if budget[0]["note"] != note {
		t.Errorf("note = %v, want %q", budget[0]["note"], note)
	}
	// An omitted note must be null, not "": the client renders the note line on
	// truthiness and an empty string would draw an empty row.
	if budget[1]["note"] != nil {
		t.Errorf("missing note = %v, want nil", budget[1]["note"])
	}
}

// TestLiveDB_RewardTierClaimedIsCountedNotDeclared is the honesty rule for social
// proof: how many backers took a tier is a fact about who did, never a number the
// campaign may assert about itself.
func TestLiveDB_RewardTierClaimedIsCountedNotDeclared(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	svc, creator := milestoneCreator(t, ctx)

	limit := 25
	req := baseSubmit("Reward claims")
	req.RewardTiers = []cf.SubmitRewardTierRequest{
		{Title: "Thank-you note", AmountKobo: 100000, Description: "A handwritten note"},
		{Title: "Care package", AmountKobo: 500000, Description: "Gift box", Limit: &limit, RequiresShipping: true},
	}
	res, err := svc.SubmitForReview(ctx, creator, req)
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	campaignID, _ := res["campaignId"].(string)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM campaigns WHERE id=$1`, campaignID) })

	detail, _ := svc.GetDetail(ctx, campaignID)
	tiers, _ := detail["rewardTiers"].([]map[string]any)
	if len(tiers) != 2 {
		t.Fatalf("detail carries %d tiers, want 2", len(tiers))
	}
	// Cheapest first — the order a backer scans them in.
	if tiers[0]["title"] != "Thank-you note" {
		t.Errorf("tiers not cheapest-first: %v", tiers[0]["title"])
	}
	if tiers[0]["claimed"] != 0 || tiers[1]["claimed"] != 0 {
		t.Errorf("fresh tiers must start at 0 claimed, got %v and %v", tiers[0]["claimed"], tiers[1]["claimed"])
	}
	if tiers[1]["limit"] != limit {
		t.Errorf("limit = %v, want %d", tiers[1]["limit"], limit)
	}

	// A REAL backer takes the second tier.
	tierID, _ := tiers[1]["id"].(string)
	backerID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO cf_reward_backers (id, tier_id, backer_name, reward_tier_title, amount_kobo, requires_shipping)
		VALUES ($1,$2,'A Real Backer','Care package',500000,true)`, backerID, tierID); err != nil {
		t.Fatalf("seed backer: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM cf_reward_backers WHERE id=$1`, backerID) })

	detail2, _ := svc.GetDetail(ctx, campaignID)
	tiers2, _ := detail2["rewardTiers"].([]map[string]any)
	if tiers2[1]["claimed"] != 1 {
		t.Errorf("claimed = %v after one real backer, want 1", tiers2[1]["claimed"])
	}
	if tiers2[0]["claimed"] != 0 {
		t.Errorf("the other tier moved to %v; a claim must count only for the tier taken", tiers2[0]["claimed"])
	}

	// The stored counter column stays untouched — the count is derived, so it
	// cannot drift away from who actually claimed.
	var stored int
	if err := pool.QueryRow(ctx, `SELECT claimed FROM cf_reward_tiers WHERE id=$1`, tierID).Scan(&stored); err != nil {
		t.Fatalf("read stored counter: %v", err)
	}
	if stored != 0 {
		t.Errorf("stored claimed column = %d; the read path must not depend on it", stored)
	}
}

// TestLiveDB_BudgetAndRewardValidation: caller-fixable submissions, and the whole
// campaign rolls back rather than landing without the plan that came with it.
func TestLiveDB_BudgetAndRewardValidation(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	svc, creator := milestoneCreator(t, ctx)

	zero := 0
	cases := []struct {
		name string
		make func() cf.SubmitCampaignRequest
	}{
		{"blank budget label", func() cf.SubmitCampaignRequest {
			r := baseSubmit("Reject blank budget label")
			r.Budget = []cf.SubmitBudgetItemRequest{{Label: "   ", AmountKobo: 1}}
			return r
		}},
		{"negative budget amount", func() cf.SubmitCampaignRequest {
			r := baseSubmit("Reject negative budget")
			r.Budget = []cf.SubmitBudgetItemRequest{{Label: "x", AmountKobo: -1}}
			return r
		}},
		{"blank tier title", func() cf.SubmitCampaignRequest {
			r := baseSubmit("Reject blank tier")
			r.RewardTiers = []cf.SubmitRewardTierRequest{{Title: " ", AmountKobo: 1}}
			return r
		}},
		{"zero tier limit", func() cf.SubmitCampaignRequest {
			r := baseSubmit("Reject zero limit")
			r.RewardTiers = []cf.SubmitRewardTierRequest{{Title: "x", AmountKobo: 1, Limit: &zero}}
			return r
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := tc.make()
			if _, err := svc.SubmitForReview(ctx, creator, req); !errors.Is(err, cf.ErrInvalidSubmission) {
				t.Errorf("err = %v, want ErrInvalidSubmission", err)
			}
			var n int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM campaigns WHERE title=$1`, req.Title).Scan(&n); err != nil {
				t.Fatalf("count: %v", err)
			}
			if n != 0 {
				t.Errorf("%d campaign(s) survived — the campaign and its plan must land together", n)
			}
		})
	}
}
