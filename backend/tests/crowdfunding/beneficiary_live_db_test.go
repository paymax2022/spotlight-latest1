package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB tests for the campaign beneficiary.
//
// The wizard has a whole step for this and will not let a creator past it, and
// GetDetail returned a hardcoded nil — so "raising for my mother" and "raising
// for myself" were indistinguishable to everyone who saw the campaign.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Beneficiary -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"testing"

	cf "spotlight/backend/internal/crowdfunding"
)

// TestLiveDB_BeneficiaryIsStoredAndSurfaced: the step the wizard insists on now
// reaches the page that needed it.
func TestLiveDB_BeneficiaryIsStoredAndSurfaced(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	svc, creator := milestoneCreator(t, ctx)

	desc := "My mother, recovering from surgery"
	req := baseSubmit("Raising for my mother")
	req.Beneficiary = &cf.SubmitBeneficiaryRequest{
		Name: "Ngozi Okafor", Relationship: "Family member", Description: &desc,
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
	b, ok := detail["beneficiary"].(map[string]any)
	if !ok {
		t.Fatalf("beneficiary = %v, want an object", detail["beneficiary"])
	}
	if b["name"] != "Ngozi Okafor" || b["relationship"] != "Family member" {
		t.Errorf("beneficiary = %v", b)
	}
	if b["description"] != desc {
		t.Errorf("description = %v, want %q", b["description"], desc)
	}
	// The badge a backer reads as "somebody checked" must start false.
	if b["verified"] != false {
		t.Errorf("verified = %v on a brand-new beneficiary, want false", b["verified"])
	}
}

// TestLiveDB_BeneficiaryVerifiedIsNotSelfDeclared: `verified` is not a field on
// the request at all, so even a caller who sends one cannot set it. This pins
// that, because the protection is an absence and absences get added back.
func TestLiveDB_BeneficiaryVerifiedIsNotSelfDeclared(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	svc, creator := milestoneCreator(t, ctx)

	req := baseSubmit("Claiming a verified beneficiary")
	req.Beneficiary = &cf.SubmitBeneficiaryRequest{Name: "Someone Real", Relationship: "Friend"}
	res, err := svc.SubmitForReview(ctx, creator, req)
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	campaignID, _ := res["campaignId"].(string)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM campaigns WHERE id=$1`, campaignID) })

	var verified bool
	var verifiedAt, verifiedBy *string
	if err := pool.QueryRow(ctx, `
		SELECT verified, verified_at::text, verified_by::text
		  FROM cf_campaign_beneficiary WHERE campaign_id=$1`, campaignID,
	).Scan(&verified, &verifiedAt, &verifiedBy); err != nil {
		t.Fatalf("read: %v", err)
	}
	if verified {
		t.Error("verified is true on submission; that badge is granted by review, never by the person asking for money")
	}
	if verifiedAt != nil || verifiedBy != nil {
		t.Errorf("verification audit fields were written at submission: at=%v by=%v", verifiedAt, verifiedBy)
	}
}

// TestLiveDB_BeneficiaryOptionalAndPartial: none is a legitimate answer; half of
// one is not.
func TestLiveDB_BeneficiaryOptionalAndPartial(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	svc, creator := milestoneCreator(t, ctx)

	// A campaign raising for its own creator has no beneficiary, and that must
	// render as "no block" rather than an empty card.
	res, err := svc.SubmitForReview(ctx, creator, baseSubmit("Raising for myself"))
	if err != nil {
		t.Fatalf("submit without beneficiary: %v", err)
	}
	campaignID, _ := res["campaignId"].(string)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM campaigns WHERE id=$1`, campaignID) })

	detail, _ := svc.GetDetail(ctx, campaignID)
	if detail["beneficiary"] != nil {
		t.Errorf("beneficiary = %v with none supplied, want nil", detail["beneficiary"])
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM cf_campaign_beneficiary WHERE campaign_id=$1`, campaignID).Scan(&rows); err != nil {
		t.Fatalf("count: %v", err)
	}
	if rows != 0 {
		t.Errorf("%d beneficiary row(s) written for a campaign that supplied none", rows)
	}

	// Half a beneficiary is a mistake worth reporting, not a row worth storing.
	for _, tc := range []struct {
		name string
		b    cf.SubmitBeneficiaryRequest
	}{
		{"name without relationship", cf.SubmitBeneficiaryRequest{Name: "Only A Name"}},
		{"relationship without name", cf.SubmitBeneficiaryRequest{Relationship: "Friend"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := baseSubmit("Partial " + tc.name)
			req.Beneficiary = &tc.b
			if _, err := svc.SubmitForReview(ctx, creator, req); !errors.Is(err, cf.ErrInvalidSubmission) {
				t.Errorf("err = %v, want ErrInvalidSubmission", err)
			}
			var n int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM campaigns WHERE title=$1`, req.Title).Scan(&n); err != nil {
				t.Fatalf("count: %v", err)
			}
			if n != 0 {
				t.Errorf("%d campaign(s) survived a rejected beneficiary", n)
			}
		})
	}
}
