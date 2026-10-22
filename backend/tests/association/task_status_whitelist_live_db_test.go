package association_test

// ---------------------------------------------------------------------------
// LIVE-DB regression guard for UpdateTaskStatus's new assignee-status
// allow-list, added during a comprehensive association-module UAT pass.
// Before this: UpdateTaskStatus wrote whatever string it was given straight
// into assoc_tasks.status with no validation beyond the DB's own 11-value
// CHECK constraint — an assignee could self-jump straight to COMPLETED
// (skipping AWAITING_REVIEW/approval) or set OVERDUE directly, contradicting
// the invariant task_tracking_test.go's TestGetTasks_OverdueIsDerivedNotStored
// already protects on the READ side ("nothing ever writes OVERDUE").
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestLiveDB_UpdateTaskStatus_AssigneeCannotSelfApproveOrSetOverdue(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "Task Guard "+uuid.New().String())
	assignee, membershipID := seedActiveMembership(t, ctx, pool, orgID)

	taskID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO assoc_tasks (id, organisation_id, title, status, priority, assignee_id) VALUES ($1,$2,'Draft the report','ASSIGNED','MEDIUM',$3)`,
		taskID, orgID, membershipID); err != nil {
		t.Fatalf("seed task: %v", err)
	}

	// Out-of-scope target statuses must all be rejected, and the task must
	// not move at all — not even partially.
	for _, blocked := range []string{"COMPLETED", "REJECTED", "CANCELLED", "OVERDUE", "DRAFT", "REOPENED", "not-a-real-status"} {
		if err := svc.UpdateTaskStatus(ctx, assignee, taskID, blocked); err == nil {
			t.Errorf("UpdateTaskStatus(%q) by the assignee returned nil error, want rejection", blocked)
		}
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_tasks WHERE id=$1`, taskID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "ASSIGNED" {
		t.Fatalf("task status = %s after all-rejected attempts, want unchanged ASSIGNED", status)
	}

	// The allowed self-service subset still works.
	for _, allowed := range []string{"ACCEPTED", "IN_PROGRESS", "BLOCKED", "AWAITING_REVIEW"} {
		if err := svc.UpdateTaskStatus(ctx, assignee, taskID, allowed); err != nil {
			t.Fatalf("UpdateTaskStatus(%q) by the assignee: %v (want allowed)", allowed, err)
		}
		if err := pool.QueryRow(ctx, `SELECT status FROM assoc_tasks WHERE id=$1`, taskID).Scan(&status); err != nil {
			t.Fatalf("read status after %q: %v", allowed, err)
		}
		if status != allowed {
			t.Errorf("task status = %s after setting %q, want %s", status, allowed, allowed)
		}
	}
}
