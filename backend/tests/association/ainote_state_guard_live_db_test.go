package association_test

// ---------------------------------------------------------------------------
// LIVE-DB regression guard for SetAiNoteStatus/RegenerateAiNoteSummary's new
// transition guards, added during a comprehensive association-module UAT
// pass. Before this: SetAiNoteStatus did an unconditional
// `UPDATE ... SET status=$2 WHERE id=$1` with no precondition on the CURRENT
// status, so a note could be published while still PROCESSING (skipping
// review) or published twice/out of order; RegenerateAiNoteSummary
// unconditionally reset status to PROCESSING regardless of current status,
// so it could silently revert an already-PUBLISHED (sealed, official)
// meeting's minutes with no error and no visible sign anything changed.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestLiveDB_SetAiNoteStatus_RejectsPublishBeforeApprove(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "AiNotes Guard "+uuid.New().String())
	noteID := seedAiNote(t, ctx, pool, orgID) // seeded READY, not APPROVED
	actorID := seedAdminRole(t, ctx, pool, orgID, "SECRETARY")

	// Publishing a note that was never approved must be rejected.
	if err := svc.SetAiNoteStatus(ctx, actorID, noteID, "PUBLISHED", "MINUTES_PUBLISH"); err == nil {
		t.Fatal("publishing a READY (never-approved) note returned nil error, want rejection")
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_ai_notes WHERE id=$1`, noteID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "READY" {
		t.Fatalf("status after rejected publish = %s, want unchanged READY", status)
	}

	// Approve, then publish twice — the second publish must be rejected, not
	// silently re-succeed with a duplicate audit row.
	if err := svc.SetAiNoteStatus(ctx, actorID, noteID, "APPROVED", "MINUTES_APPROVE"); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if err := svc.SetAiNoteStatus(ctx, actorID, noteID, "PUBLISHED", "MINUTES_PUBLISH"); err != nil {
		t.Fatalf("first publish: %v", err)
	}
	if err := svc.SetAiNoteStatus(ctx, actorID, noteID, "PUBLISHED", "MINUTES_PUBLISH"); err == nil {
		t.Fatal("second publish of an already-PUBLISHED note returned nil error, want rejection")
	}
	var publishAuditCount int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM assoc_audit_log WHERE subject_type='ai_note' AND subject_id=$1 AND action='MINUTES_PUBLISH'`,
		noteID).Scan(&publishAuditCount); err != nil {
		t.Fatalf("count publish audit: %v", err)
	}
	if publishAuditCount != 1 {
		t.Errorf("MINUTES_PUBLISH audit rows = %d, want exactly 1 (double-publish must not write a second row)", publishAuditCount)
	}
}

func TestLiveDB_RegenerateAiNoteSummary_RejectsOncePublished(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "AiNotes Guard "+uuid.New().String())
	noteID := seedAiNote(t, ctx, pool, orgID)
	actorID := seedAdminRole(t, ctx, pool, orgID, "SECRETARY")

	// Regenerating a READY (not yet published) note is still allowed.
	if err := svc.RegenerateAiNoteSummary(ctx, actorID, noteID); err != nil {
		t.Fatalf("regenerate a READY note: %v", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_ai_notes WHERE id=$1`, noteID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "PROCESSING" {
		t.Fatalf("status after regenerate = %s, want PROCESSING", status)
	}

	// Walk it to PUBLISHED, then regenerate must be rejected — not silently
	// revert the sealed minutes back to PROCESSING.
	if _, err := pool.Exec(ctx, `UPDATE assoc_ai_notes SET status='READY' WHERE id=$1`, noteID); err != nil {
		t.Fatalf("advance to READY for setup: %v", err)
	}
	if err := svc.SetAiNoteStatus(ctx, actorID, noteID, "APPROVED", "MINUTES_APPROVE"); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if err := svc.SetAiNoteStatus(ctx, actorID, noteID, "PUBLISHED", "MINUTES_PUBLISH"); err != nil {
		t.Fatalf("publish: %v", err)
	}
	if err := svc.RegenerateAiNoteSummary(ctx, actorID, noteID); err == nil {
		t.Fatal("regenerating a PUBLISHED note returned nil error, want rejection")
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_ai_notes WHERE id=$1`, noteID).Scan(&status); err != nil {
		t.Fatalf("read status after rejected regenerate: %v", err)
	}
	if status != "PUBLISHED" {
		t.Fatalf("PUBLISHED note reverted to %s after a rejected regenerate — the published minutes were destroyed", status)
	}
	var regenAuditCount int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM assoc_audit_log WHERE subject_type='ai_note' AND subject_id=$1 AND action='MINUTES_REGENERATE'`,
		noteID).Scan(&regenAuditCount); err != nil {
		t.Fatalf("count regenerate audit: %v", err)
	}
	if regenAuditCount != 1 { // the one earlier, allowed regenerate on the READY note
		t.Errorf("MINUTES_REGENERATE audit rows = %d, want exactly 1 (the rejected attempt on PUBLISHED must not audit)", regenAuditCount)
	}
}
