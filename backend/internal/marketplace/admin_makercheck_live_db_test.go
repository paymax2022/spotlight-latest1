package marketplace

// ---------------------------------------------------------------------------
// LIVE-DB test for the MKT-007 maker-checker flows (Users ban, Appeals
// overturn). Follows the same pattern as service_boost_live_db_test.go:
// TEST_DATABASE_URL-gated, real pgxpool, no mocking of the DB layer.
//
// Run:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/marketplace/... -run TestLiveDB_MakerChecker -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func makercheckTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB maker-checker tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedMakercheckPlatformUser inserts a throwaway platform_users row (the
// module reads identity from platform_users, not auth.users, for admin views)
// and registers cleanup.
func seedMakercheckPlatformUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO platform_users (id, first_name, last_name, email, status)
		VALUES ($1,'Test','User',$2,'active') ON CONFLICT (id) DO NOTHING`,
		id, id+"@makercheck.test"); err != nil {
		t.Fatalf("seed platform_users: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM mkt_user_moderation WHERE user_id=$1`, id)
		pool.Exec(context.Background(), `DELETE FROM platform_users WHERE id=$1`, id)
	})
	return id
}

func TestLiveDB_MakerChecker_UserBan_DifferentAdminApproves(t *testing.T) {
	pool := makercheckTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil, nil)

	targetID := seedMakercheckPlatformUser(t, ctx, pool)
	makerID := uuid.New().String()
	checkerID := uuid.New().String()

	// Propose a ban — always dual-approval.
	view, err := svc.ProposeUserStatus(ctx, makerID, "test-role", targetID, SetUserStatusInput{Action: "ban", ReasonCode: "TEST_BAN"})
	if err != nil {
		t.Fatalf("propose ban: %v", err)
	}
	if !view.RequiresDualApproval || view.PendingAction == nil || *view.PendingAction != "ban" {
		t.Fatalf("expected pending ban requiring dual approval, got %+v", view)
	}
	if view.Status != "active" {
		t.Fatalf("expected status still 'active' before approval, got %q", view.Status)
	}

	// Same admin attempts to approve — must be refused.
	if _, err := svc.ApproveUserAction(ctx, makerID, "test-role", targetID, "self-attempt"); !errors.Is(err, ErrSameApproverNotAllowed) {
		t.Fatalf("expected ErrSameApproverNotAllowed for self-approval, got %v", err)
	}

	// A different admin approves — must succeed and apply the ban.
	approved, err := svc.ApproveUserAction(ctx, checkerID, "test-role", targetID, "confirmed")
	if err != nil {
		t.Fatalf("different-admin approve: %v", err)
	}
	if approved.Status != "banned" {
		t.Fatalf("expected status 'banned' after approval, got %q", approved.Status)
	}
	if approved.PendingAction != nil {
		t.Fatalf("expected pending_action cleared after approval, got %v", *approved.PendingAction)
	}

	// Verify the real DB row directly — proposed_by/second_approver_id distinct,
	// matching the DB CHECK constraint's invariant.
	var proposedBy, secondApprover string
	if err := pool.QueryRow(ctx, `SELECT proposed_by, second_approver_id FROM mkt_user_moderation WHERE user_id=$1`, targetID).
		Scan(&proposedBy, &secondApprover); err != nil {
		t.Fatalf("query row: %v", err)
	}
	if proposedBy != makerID || secondApprover != checkerID || proposedBy == secondApprover {
		t.Fatalf("expected distinct maker/checker in DB row, got proposed_by=%s second_approver_id=%s", proposedBy, secondApprover)
	}
}

func TestLiveDB_MakerChecker_AppealOverturn_DifferentAdminApproves(t *testing.T) {
	pool := makercheckTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil, nil)

	appellantID := seedMakercheckPlatformUser(t, ctx, pool)
	makerID := uuid.New().String()
	checkerID := uuid.New().String()
	targetListingID := uuid.New().String()

	a, err := svc.FileAppeal(ctx, appellantID, CreateAppealInput{
		TargetType: "listing", TargetID: targetListingID,
		OriginalAction: "removed_policy", OriginalReasonCode: "TEST_REASON", AppellantNote: "test appeal",
	})
	if err != nil {
		t.Fatalf("file appeal: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_appeals WHERE id=$1`, a.ID) })

	decided, err := svc.DecideAppealAdmin(ctx, makerID, "test-role", a.ID, DecideAppealInput{Decision: "overturn", ReasonCode: "TEST_OVERTURN"})
	if err != nil {
		t.Fatalf("propose overturn: %v", err)
	}
	if !decided.RequiresDualApproval || decided.Status != "decided" {
		t.Fatalf("expected 'decided' status requiring dual approval, got %+v", decided)
	}

	if _, err := svc.ApproveAppealAdmin(ctx, makerID, "test-role", a.ID, "self-attempt"); !errors.Is(err, ErrSameApproverNotAllowed) {
		t.Fatalf("expected ErrSameApproverNotAllowed for self-approval, got %v", err)
	}

	executed, err := svc.ApproveAppealAdmin(ctx, checkerID, "test-role", a.ID, "confirmed")
	if err != nil {
		t.Fatalf("different-admin approve: %v", err)
	}
	if executed.Status != "executed" {
		t.Fatalf("expected status 'executed', got %q", executed.Status)
	}

	var decidedBy, secondApprover string
	if err := pool.QueryRow(ctx, `SELECT decided_by, second_approver_id FROM mkt_appeals WHERE id=$1`, a.ID).
		Scan(&decidedBy, &secondApprover); err != nil {
		t.Fatalf("query row: %v", err)
	}
	if decidedBy != makerID || secondApprover != checkerID || decidedBy == secondApprover {
		t.Fatalf("expected distinct maker/checker in DB row, got decided_by=%s second_approver_id=%s", decidedBy, secondApprover)
	}
}

// TestLiveDB_MakerChecker_AppealUphold_ExecutesImmediately proves the severity
// split: an 'uphold' decision requires NO second approver and executes in the
// same call.
func TestLiveDB_MakerChecker_AppealUphold_ExecutesImmediately(t *testing.T) {
	pool := makercheckTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil, nil)

	appellantID := seedMakercheckPlatformUser(t, ctx, pool)
	makerID := uuid.New().String()
	targetListingID := uuid.New().String()

	a, err := svc.FileAppeal(ctx, appellantID, CreateAppealInput{
		TargetType: "listing", TargetID: targetListingID,
		OriginalAction: "removed_policy", OriginalReasonCode: "TEST_REASON", AppellantNote: "test appeal 2",
	})
	if err != nil {
		t.Fatalf("file appeal: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_appeals WHERE id=$1`, a.ID) })

	decided, err := svc.DecideAppealAdmin(ctx, makerID, "test-role", a.ID, DecideAppealInput{Decision: "uphold", ReasonCode: "TEST_UPHOLD"})
	if err != nil {
		t.Fatalf("decide uphold: %v", err)
	}
	if decided.RequiresDualApproval {
		t.Fatalf("expected uphold to NOT require dual approval, got %+v", decided)
	}
	if decided.Status != "executed" {
		t.Fatalf("expected uphold to execute immediately, got status %q", decided.Status)
	}

	if _, err := svc.ApproveAppealAdmin(ctx, uuid.New().String(), "test-role", a.ID, "x"); !errors.Is(err, ErrNoPendingAction) {
		t.Fatalf("expected ErrNoPendingAction on an already-executed uphold, got %v", err)
	}
}
