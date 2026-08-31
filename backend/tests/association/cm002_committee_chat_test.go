package association_test

// CM-002: committee / executive chat isolation (live-DB).
//
// After the org-scope IDOR sweep, chat threads are organisation-isolated but not
// sub-group-isolated. These tests prove scope-aware access: EXECUTIVE threads are
// limited to org admins/execs, COMMITTEE threads (linked via committee_id) to that
// committee's ACTIVE members, and GENERAL/EVENT/unlinked threads stay org-scoped.
// Gated on TEST_DATABASE_URL like the rest of the suite.

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func seedChatThreadScoped(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orgID, scope, committeeID string) string {
	t.Helper()
	threadID := uuid.New().String()
	var cid any
	if committeeID != "" {
		cid = committeeID
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_chat_threads (id, organisation_id, title, scope, committee_id)
		VALUES ($1, $2, 'Scoped', $3, $4)`, threadID, orgID, scope, cid); err != nil {
		t.Fatalf("seed scoped chat thread: %v", err)
	}
	return threadID
}

func seedCommittee(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orgID string) string {
	t.Helper()
	committeeID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_committees (id, organisation_id, name)
		VALUES ($1, $2, 'Finance Committee')`, committeeID, orgID); err != nil {
		t.Fatalf("seed committee: %v", err)
	}
	return committeeID
}

func seedCommitteeMember(t *testing.T, ctx context.Context, pool *pgxpool.Pool, committeeID, membershipID, status string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_committee_members (id, committee_id, membership_id, role, status)
		VALUES ($1, $2, $3, 'MEMBER', $4)`, uuid.New().String(), committeeID, membershipID, status); err != nil {
		t.Fatalf("seed committee member: %v", err)
	}
}

func TestLiveDB_CM002_ExecutiveThread_NonExecForbidden(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	org := seedOrganisation(t, ctx, pool, "ExecOrg "+uuid.New().String())
	exec := seedAdminRole(t, ctx, pool, org, "NATIONAL_ADMIN")
	plain, _ := seedActiveMembership(t, ctx, pool, org)
	thread := seedChatThreadScoped(t, ctx, pool, org, "EXECUTIVE", "")

	// Exec can read + post.
	if _, err := svc.GetChatThread(ctx, exec, thread); err != nil {
		t.Fatalf("exec must read EXECUTIVE thread, got: %v", err)
	}
	if _, err := svc.SendChatMessage(ctx, exec, thread, "exec msg"); err != nil {
		t.Fatalf("exec must post to EXECUTIVE thread, got: %v", err)
	}
	// Plain org member is denied read + write.
	if _, err := svc.GetChatThread(ctx, plain, thread); err == nil {
		t.Fatal("CM-002: plain member read an EXECUTIVE thread (want error)")
	}
	if _, err := svc.SendChatMessage(ctx, plain, thread, "intrusion"); err == nil {
		t.Fatal("CM-002: plain member posted to an EXECUTIVE thread (want error)")
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_chat_messages WHERE thread_id=$1 AND body='intrusion'`, thread).Scan(&n); err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if n != 0 {
		t.Fatalf("foreign message persisted (%d) despite forbidden post", n)
	}
	// Thread list excludes the EXECUTIVE thread for the plain member.
	list, err := svc.GetChatThreads(ctx, plain)
	if err != nil {
		t.Fatalf("GetChatThreads: %v", err)
	}
	for _, s := range list {
		if s.ID == thread {
			t.Fatal("CM-002: EXECUTIVE thread listed for a non-exec member")
		}
	}
}

func TestLiveDB_CM002_CommitteeThread_NonMemberForbidden(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	org := seedOrganisation(t, ctx, pool, "CommOrg "+uuid.New().String())
	committee := seedCommittee(t, ctx, pool, org)
	memberUser, memberMembership := seedActiveMembership(t, ctx, pool, org)
	seedCommitteeMember(t, ctx, pool, committee, memberMembership, "ACTIVE")
	orgOnly, _ := seedActiveMembership(t, ctx, pool, org) // in org, NOT on committee
	thread := seedChatThreadScoped(t, ctx, pool, org, "COMMITTEE", committee)

	// Committee member can read + post + list.
	if _, err := svc.GetChatThread(ctx, memberUser, thread); err != nil {
		t.Fatalf("committee member must read COMMITTEE thread, got: %v", err)
	}
	if _, err := svc.SendChatMessage(ctx, memberUser, thread, "hello committee"); err != nil {
		t.Fatalf("committee member must post, got: %v", err)
	}
	list, err := svc.GetChatThreads(ctx, memberUser)
	if err != nil {
		t.Fatalf("GetChatThreads(member): %v", err)
	}
	sawForMember := false
	for _, s := range list {
		if s.ID == thread {
			sawForMember = true
		}
	}
	if !sawForMember {
		t.Errorf("committee thread not listed for its own member")
	}
	// Non-committee org member is denied read + write + list.
	if _, err := svc.GetChatThread(ctx, orgOnly, thread); err == nil {
		t.Fatal("CM-002: non-committee org member read a COMMITTEE thread (want error)")
	}
	if _, err := svc.SendChatMessage(ctx, orgOnly, thread, "intrusion"); err == nil {
		t.Fatal("CM-002: non-committee org member posted to a COMMITTEE thread (want error)")
	}
	list2, err := svc.GetChatThreads(ctx, orgOnly)
	if err != nil {
		t.Fatalf("GetChatThreads(orgOnly): %v", err)
	}
	for _, s := range list2 {
		if s.ID == thread {
			t.Fatal("CM-002: COMMITTEE thread listed for a non-committee member")
		}
	}
}

func TestLiveDB_CM002_CommitteeThread_NullCommitteeFallsBackToOrg(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	org := seedOrganisation(t, ctx, pool, "LegacyCommOrg "+uuid.New().String())
	orgMember, _ := seedActiveMembership(t, ctx, pool, org)
	// COMMITTEE scope but not linked to any committee (committee_id NULL) → legacy
	// org-scoped fallback so pre-migration threads don't lock everyone out.
	thread := seedChatThreadScoped(t, ctx, pool, org, "COMMITTEE", "")

	if _, err := svc.GetChatThread(ctx, orgMember, thread); err != nil {
		t.Fatalf("org member must read an UNLINKED committee thread (legacy fallback), got: %v", err)
	}
}

func TestLiveDB_CM002_GeneralThread_OrgMemberStillAllowed(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	org := seedOrganisation(t, ctx, pool, "GenOrg "+uuid.New().String())
	member, _ := seedActiveMembership(t, ctx, pool, org)
	thread := seedChatThread(t, ctx, pool, org) // GENERAL

	if _, err := svc.GetChatThread(ctx, member, thread); err != nil {
		t.Fatalf("org member must read a GENERAL thread (no regression), got: %v", err)
	}
}
