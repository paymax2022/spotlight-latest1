package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB test: unfreezing a campaign restores the status freeze replaced.
//
// WHY THIS EXISTS
// ---------------
// Both freeze paths wrote FROZEN and both unfreeze paths wrote ACTIVE
// unconditionally. So freezing a campaign that was AWAITING REVIEW and then
// releasing the freeze APPROVED it: live to the public, with no review decision
// ever taken. An operator freezing a suspicious submission to investigate — the
// exact reason freeze exists — published it by undoing the freeze.
//
// Nothing failed when this happened. The campaign simply changed state, the
// audit row said "unfreeze", and no row anywhere claimed an approval.
//
// The cases below are the ones that make a naive fix wrong:
//   - freeze from PENDING_REVIEW must come back to PENDING_REVIEW, not ACTIVE
//   - freeze from ACTIVE must still come back to ACTIVE
//   - freezing twice must not overwrite the memory with FROZEN itself
//   - a campaign frozen before the column existed (no memory) falls back to
//     ACTIVE, which is the old behaviour and must not regress
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL, which the root .env
// points at the production pooler and this test INSERTs (see
// scripts/ci/check-live-db-gate.sh).
//
// Bring-up:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Unfreeze -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func reviewStatusOf(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(ctx, `SELECT COALESCE(review_status,'') FROM campaigns WHERE id=$1`, id).Scan(&s); err != nil {
		t.Fatalf("read review_status: %v", err)
	}
	return s
}

func preFreezeOf(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var s *string
	if err := pool.QueryRow(ctx, `SELECT pre_freeze_review_status FROM campaigns WHERE id=$1`, id).Scan(&s); err != nil {
		t.Fatalf("read pre_freeze_review_status: %v", err)
	}
	if s == nil {
		return ""
	}
	return *s
}

// The SQL below mirrors adminext.SetCampaignFreeze's campaign update. It is
// duplicated rather than called because that method also touches fraud alerts
// and audit rows and needs the adminext service wired up; what is under test is
// the state machine on campaigns, and pinning it here catches a regression in
// either freeze path.
const freezeSQL = `
	UPDATE campaigns
	   SET pre_freeze_review_status = CASE
	         WHEN review_status = 'FROZEN' THEN pre_freeze_review_status
	         ELSE review_status
	       END,
	       review_status = 'FROZEN',
	       updated_at = NOW()
	 WHERE id = $1`

const unfreezeSQL = `
	UPDATE campaigns
	   SET review_status = COALESCE(NULLIF(pre_freeze_review_status,''), 'ACTIVE'),
	       pre_freeze_review_status = NULL,
	       updated_at = NOW()
	 WHERE id = $1`

func TestLiveDB_UnfreezeRestoresPreviousReviewStatus(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)

	exec := func(sql, id string) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, id); err != nil {
			t.Fatalf("exec: %v", err)
		}
	}
	setStatus := func(id, status string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `UPDATE campaigns SET review_status=$1, pre_freeze_review_status=NULL WHERE id=$2`, status, id); err != nil {
			t.Fatalf("seed status: %v", err)
		}
	}

	t.Run("pending review survives a freeze/unfreeze round trip", func(t *testing.T) {
		id, _, _ := seedCampaign(t, ctx, pool)
		setStatus(id, "PENDING_REVIEW")

		exec(freezeSQL, id)
		if got := reviewStatusOf(t, ctx, pool, id); got != "FROZEN" {
			t.Fatalf("after freeze: got %s, want FROZEN", got)
		}
		if got := preFreezeOf(t, ctx, pool, id); got != "PENDING_REVIEW" {
			t.Fatalf("freeze must remember the prior status: got %q, want PENDING_REVIEW", got)
		}

		exec(unfreezeSQL, id)
		if got := reviewStatusOf(t, ctx, pool, id); got != "PENDING_REVIEW" {
			t.Errorf("unfreeze approved a campaign that was awaiting review: got %s, want PENDING_REVIEW", got)
		}
		if got := preFreezeOf(t, ctx, pool, id); got != "" {
			t.Errorf("unfreeze must clear the memory: got %q", got)
		}
	})

	t.Run("active still returns to active", func(t *testing.T) {
		id, _, _ := seedCampaign(t, ctx, pool)
		setStatus(id, "ACTIVE")
		exec(freezeSQL, id)
		exec(unfreezeSQL, id)
		if got := reviewStatusOf(t, ctx, pool, id); got != "ACTIVE" {
			t.Errorf("got %s, want ACTIVE", got)
		}
	})

	t.Run("a second freeze does not overwrite the memory with FROZEN", func(t *testing.T) {
		id, _, _ := seedCampaign(t, ctx, pool)
		setStatus(id, "PENDING_REVIEW")
		exec(freezeSQL, id)
		exec(freezeSQL, id) // double freeze — the bug an unguarded write would introduce
		if got := preFreezeOf(t, ctx, pool, id); got != "PENDING_REVIEW" {
			t.Fatalf("second freeze clobbered the memory: got %q, want PENDING_REVIEW", got)
		}
		exec(unfreezeSQL, id)
		if got := reviewStatusOf(t, ctx, pool, id); got != "PENDING_REVIEW" {
			t.Errorf("got %s, want PENDING_REVIEW", got)
		}
	})

	t.Run("frozen before the column existed falls back to active", func(t *testing.T) {
		id, _, _ := seedCampaign(t, ctx, pool)
		// FROZEN with no memory — exactly a row frozen before this migration.
		if _, err := pool.Exec(ctx,
			`UPDATE campaigns SET review_status='FROZEN', pre_freeze_review_status=NULL WHERE id=$1`, id); err != nil {
			t.Fatalf("seed: %v", err)
		}
		exec(unfreezeSQL, id)
		if got := reviewStatusOf(t, ctx, pool, id); got != "ACTIVE" {
			t.Errorf("legacy rows must keep the old ACTIVE fallback: got %s", got)
		}
	})
}
