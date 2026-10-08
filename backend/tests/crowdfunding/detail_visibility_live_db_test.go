package crowdfunding_test

// LIVE-DB tests for the campaign-detail visibility gate.
// GetDetail read any campaigns row by id with no status check at all: a
// pending submission's beneficiary block — name, relationship, description —
// was readable by anyone holding the UUID, and a soft-deleted campaign kept
// serving full detail to its own creator after DELETE returned 200.
// Gated on TEST_DATABASE_URL alone (scripts/ci/check-live-db-gate.sh).
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_DetailVisibility -v

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	cf "spotlight/backend/internal/crowdfunding"
	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_DetailVisibilityGate(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	svc, creator := milestoneCreator(t, ctx)
	stranger := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, stranger, "cf-stranger-"+stranger+"@test.local"); err != nil {
		t.Fatalf("seed stranger: %v", err)
	}
	testsupport.CleanupUser(t, pool, stranger)

	res, err := svc.SubmitForReview(ctx, creator, baseSubmit("Visibility gate"))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	campaignID, _ := res["campaignId"].(string)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM campaigns WHERE id=$1`, campaignID)
	})

	// PENDING_REVIEW: creator sees it, a stranger must not — the error is the
	// same "not found" an absent id produces, never an existence tell.
	if _, err := svc.GetDetail(ctx, campaignID, creator); err != nil {
		t.Fatalf("creator read of own pending campaign: %v", err)
	}
	if _, err := svc.GetDetail(ctx, campaignID, stranger); !errors.Is(err, cf.ErrCampaignNotFound) {
		t.Errorf("stranger read of pending campaign: err = %v, want ErrCampaignNotFound", err)
	}

	// ACTIVE: publicly readable — the whole point of going live.
	if _, err := pool.Exec(ctx, `UPDATE campaigns SET review_status='ACTIVE' WHERE id=$1`, campaignID); err != nil {
		t.Fatalf("activate: %v", err)
	}
	if _, err := svc.GetDetail(ctx, campaignID, stranger); err != nil {
		t.Errorf("stranger read of active campaign: %v", err)
	}

	// Paused by its owner: drops out of public view but stays readable to the
	// creator who paused it (the pause screen needs the detail).
	if _, err := pool.Exec(ctx, `UPDATE campaigns SET paused_at=NOW() WHERE id=$1`, campaignID); err != nil {
		t.Fatalf("pause: %v", err)
	}
	if _, err := svc.GetDetail(ctx, campaignID, stranger); !errors.Is(err, cf.ErrCampaignNotFound) {
		t.Errorf("stranger read of paused campaign: err = %v, want ErrCampaignNotFound", err)
	}
	if _, err := svc.GetDetail(ctx, campaignID, creator); err != nil {
		t.Errorf("creator read of own paused campaign: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE campaigns SET paused_at=NULL WHERE id=$1`, campaignID); err != nil {
		t.Fatalf("resume: %v", err)
	}

	// Soft-deleted: gone from EVERY surface, creator included — the row exists
	// only to keep contribution and ledger references resolvable.
	if _, err := pool.Exec(ctx, `UPDATE campaigns SET deleted_at=NOW() WHERE id=$1`, campaignID); err != nil {
		t.Fatalf("soft-delete: %v", err)
	}
	if _, err := svc.GetDetail(ctx, campaignID, creator); !errors.Is(err, cf.ErrCampaignNotFound) {
		t.Errorf("creator read of deleted campaign: err = %v, want ErrCampaignNotFound", err)
	}
}
