package association_test

// ---------------------------------------------------------------------------
// Organisation-wide task tracking.
//
// WHY THIS EXISTS
// ---------------
// GetTasks filtered every scope to tasks ASSIGNED TO THE CALLER, so nobody —
// not even an admin — could see whether the organisation's work was getting
// done. "Track task compliance / closure / status / deadline" was not possible:
// the only view was your own inbox.
//
// Two properties are pinned:
//
//   • scope=org returns the organisation's tasks and is ADMIN-ONLY. It is a
//     management view — who has been given what, and who is late — not a member
//     one.
//   • `overdue` is DERIVED from due_date, never read from `status`. The schema
//     has an OVERDUE status value that NOTHING writes, so a task past its due
//     date still reads ASSIGNED; trusting the column would report every late
//     task as on track, which is the exact opposite of what a compliance view
//     is for.
//
// Live-DB, same harness as founder_and_scoping_test.go.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/association"
)

// TestGetTasks_OrgScopeIsAdminOnly pins who may see the tracking view.
func TestGetTasks_OrgScopeIsAdminOnly(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgID, adminID, memberID := orgWithAdminAndMember(t, ctx, pool, svc)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM assoc_tasks WHERE organisation_id=$1`, orgID) })

	// A task assigned to nobody: it belongs to the organisation, so it must show
	// up in the tracking view even though it is in no one's inbox.
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_tasks (organisation_id, title, status, priority, due_date)
		VALUES ($1, 'Unassigned work', 'ASSIGNED', 'MEDIUM', now() + interval '7 days')`, orgID); err != nil {
		t.Fatalf("seed task: %v", err)
	}

	// A plain member is refused.
	if _, err := svc.GetTasks(ctx, memberID, "org"); err == nil {
		t.Error("a non-admin must not be able to read the organisation-wide task list")
	}

	// The admin sees it.
	list, err := svc.GetTasks(ctx, adminID, "org")
	if err != nil {
		t.Fatalf("admin org scope: %v", err)
	}
	found := false
	for _, task := range list {
		if task.Title == "Unassigned work" {
			found = true
			if task.AssigneeName != "Unassigned" {
				t.Errorf("assigneeName = %q, want Unassigned", task.AssigneeName)
			}
		}
	}
	if !found {
		t.Error("an unassigned organisation task must appear in the tracking view")
	}

	// And it is NOT in the admin's own inbox — "mine" stays assignee-filtered.
	mine, err := svc.GetTasks(ctx, adminID, "mine")
	if err != nil {
		t.Fatalf("mine scope: %v", err)
	}
	for _, task := range mine {
		if task.Title == "Unassigned work" {
			t.Error("scope=mine must stay filtered to tasks assigned to the caller")
		}
	}
}

// TestGetTasks_OverdueIsDerivedNotStored is the regression that matters for a
// compliance view: nothing writes the OVERDUE status, so it must be computed.
func TestGetTasks_OverdueIsDerivedNotStored(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgID, adminID, _ := orgWithAdminAndMember(t, ctx, pool, svc)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM assoc_tasks WHERE organisation_id=$1`, orgID) })

	cases := []struct {
		title  string
		status string
		due    any
		want   bool
	}{
		// Past due and still open: overdue, even though status says ASSIGNED.
		{"Late " + uuid.NewString()[:6], "ASSIGNED", time.Now().Add(-48 * time.Hour), true},
		// Past due but finished: closed work is not a compliance problem.
		{"Done late " + uuid.NewString()[:6], "COMPLETED", time.Now().Add(-48 * time.Hour), false},
		// Cancelled work likewise stops counting.
		{"Cancelled " + uuid.NewString()[:6], "CANCELLED", time.Now().Add(-48 * time.Hour), false},
		// Future deadline: not overdue.
		{"Upcoming " + uuid.NewString()[:6], "ASSIGNED", time.Now().Add(48 * time.Hour), false},
		// No deadline at all: never overdue.
		{"No deadline " + uuid.NewString()[:6], "ASSIGNED", nil, false},
	}

	for _, tc := range cases {
		if _, err := pool.Exec(ctx, `
			INSERT INTO assoc_tasks (organisation_id, title, status, priority, due_date)
			VALUES ($1,$2,$3,'MEDIUM',$4)`, orgID, tc.title, tc.status, tc.due); err != nil {
			t.Fatalf("seed %q: %v", tc.title, err)
		}
	}

	list, err := svc.GetTasks(ctx, adminID, "org")
	if err != nil {
		t.Fatalf("org scope: %v", err)
	}
	got := map[string]association.TaskSummary{}
	for _, task := range list {
		got[task.Title] = task
	}

	for _, tc := range cases {
		task, ok := got[tc.title]
		if !ok {
			t.Errorf("%q missing from the tracking view", tc.title)
			continue
		}
		if task.Overdue != tc.want {
			t.Errorf("%q overdue = %v, want %v (status=%s)", tc.title, task.Overdue, tc.want, task.Status)
		}
	}
}
