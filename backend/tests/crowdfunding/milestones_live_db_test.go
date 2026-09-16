package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB tests for campaign milestones.
//
// cf_campaign_milestones existed and a read endpoint existed, but nothing ever
// wrote a row: the submit DTO accepted no milestone data, so the wizard collected
// a funding plan and the server dropped it. GetDetail returned a literal empty
// array on top of that, so the Milestones screen told every visitor "this campaign
// releases funds without milestone gating" — a claim about how money moves, made
// on no evidence.
//
// Gated on TEST_DATABASE_URL alone (scripts/ci/check-live-db-gate.sh).
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Milestone -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	cf "spotlight/backend/internal/crowdfunding"
	"spotlight/backend/internal/testsupport"
)

func milestoneCreator(t *testing.T, ctx context.Context) (*cf.Service, string) {
	t.Helper()
	pool := liveDBPool(t)
	svc := cf.NewService(pool, nil, nil)
	creatorID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, creatorID, "cf-mile-"+creatorID+"@test.local"); err != nil {
		t.Fatalf("seed creator: %v", err)
	}
	testsupport.CleanupUser(t, pool, creatorID)
	return svc, creatorID
}

func baseSubmit(title string, ms ...cf.SubmitMilestoneRequest) cf.SubmitCampaignRequest {
	return cf.SubmitCampaignRequest{
		Type: "DONATION", Category: "medical", Title: title,
		Summary: "s", Story: "st", GoalKobo: 500000,
		RefundPolicy: "FLEXIBLE", Milestones: ms,
	}
}

// TestLiveDB_MilestonesArePersistedAndOrdered: the plan the wizard collects
// survives submission, in the order it was entered.
func TestLiveDB_MilestonesArePersistedAndOrdered(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	svc, creator := milestoneCreator(t, ctx)

	res, err := svc.SubmitForReview(ctx, creator, baseSubmit("Milestone ordering",
		cf.SubmitMilestoneRequest{Title: "Surgery deposit", TargetKobo: 200000, Status: "ACTIVE"},
		cf.SubmitMilestoneRequest{Title: "Post-op care", TargetKobo: 300000, Status: "LOCKED"},
	))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	campaignID, _ := res["campaignId"].(string)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM campaigns WHERE id=$1`, campaignID) })

	rows, err := pool.Query(ctx, `
		SELECT title, target_kobo, status, sort_order
		  FROM cf_campaign_milestones WHERE campaign_id=$1 ORDER BY sort_order`, campaignID)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	defer rows.Close()
	type row struct {
		title  string
		target int64
		status string
		order  int
	}
	var got []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.title, &r.target, &r.status, &r.order); err != nil {
			t.Fatalf("scan: %v", err)
		}
		got = append(got, r)
	}
	if len(got) != 2 {
		t.Fatalf("persisted %d milestones, want 2 — the wizard's plan must survive submission", len(got))
	}
	if got[0].title != "Surgery deposit" || got[0].target != 200000 || got[0].status != "ACTIVE" || got[0].order != 0 {
		t.Errorf("first milestone = %+v", got[0])
	}
	if got[1].title != "Post-op care" || got[1].status != "LOCKED" || got[1].order != 1 {
		t.Errorf("second milestone = %+v", got[1])
	}

	// And the detail payload carries them — the Milestones screen reads that and
	// nothing else.
	detail, err := svc.GetDetail(ctx, campaignID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	ms, _ := detail["milestones"].([]map[string]any)
	if len(ms) != 2 {
		t.Fatalf("detail carries %d milestones, want 2", len(ms))
	}
	if ms[0]["title"] != "Surgery deposit" || ms[0]["status"] != "ACTIVE" {
		t.Errorf("detail first milestone = %v", ms[0])
	}
}

// TestLiveDB_MilestoneStatusIsNotSelfDeclared is the money-honesty rule: a
// creator must not be able to publish a campaign that tells backers funds were
// RELEASED for a milestone no money ever moved for.
func TestLiveDB_MilestoneStatusIsNotSelfDeclared(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	svc, creator := milestoneCreator(t, ctx)

	for _, status := range []string{"RELEASED", "PENDING_REVIEW"} {
		title := "Self declared " + status
		_, err := svc.SubmitForReview(ctx, creator, baseSubmit(title,
			cf.SubmitMilestoneRequest{Title: "Money already sent", TargetKobo: 1000, Status: status},
		))
		if !errors.Is(err, cf.ErrInvalidSubmission) {
			t.Errorf("status %s err = %v, want ErrInvalidSubmission", status, err)
		}
		// The whole submission rolls back: no campaign, not just no milestone.
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM campaigns WHERE title=$1`, title).Scan(&n); err != nil {
			t.Fatalf("count: %v", err)
		}
		if n != 0 {
			t.Errorf("%d campaign(s) survived a rejected milestone — the campaign and its plan must land together", n)
		}
	}
}

// TestLiveDB_MilestoneDefaultsAndValidation: an omitted status follows the
// wizard's own labelling, and the cheap guards are caller-fixable errors.
func TestLiveDB_MilestoneDefaultsAndValidation(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	svc, creator := milestoneCreator(t, ctx)

	res, err := svc.SubmitForReview(ctx, creator, baseSubmit("Defaulted statuses",
		cf.SubmitMilestoneRequest{Title: "first", TargetKobo: 100},
		cf.SubmitMilestoneRequest{Title: "second", TargetKobo: 200},
	))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	campaignID, _ := res["campaignId"].(string)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM campaigns WHERE id=$1`, campaignID) })

	var first, second string
	if err := pool.QueryRow(ctx, `
		SELECT max(status) FILTER (WHERE sort_order=0), max(status) FILTER (WHERE sort_order=1)
		  FROM cf_campaign_milestones WHERE campaign_id=$1`, campaignID).Scan(&first, &second); err != nil {
		t.Fatalf("read statuses: %v", err)
	}
	if first != "ACTIVE" || second != "LOCKED" {
		t.Errorf("defaults = %s/%s, want ACTIVE/LOCKED — the first milestone is what the campaign is working on", first, second)
	}

	for _, bad := range []cf.SubmitMilestoneRequest{
		{Title: "   ", TargetKobo: 1},
		{Title: "negative", TargetKobo: -1},
		{Title: "bad date", TargetKobo: 1, DueAt: ptrStr("not-a-date")},
		{Title: "unknown", TargetKobo: 1, Status: "WHATEVER"},
	} {
		if _, err := svc.SubmitForReview(ctx, creator, baseSubmit("Rejected "+bad.Title, bad)); !errors.Is(err, cf.ErrInvalidSubmission) {
			t.Errorf("milestone %+v err = %v, want ErrInvalidSubmission", bad, err)
		}
	}
}

func ptrStr(s string) *string { return &s }
