package association_test

// Live-DB authorization / IDOR-scope suite for the association module.
//
// These tests prove the cross-group data-isolation, admin org-scoping, and
// invite-only discovery invariants from the Groups & Associations test plan
// (SEC-001, DR-004, GR-004, GR-010, CH-005, AI-007, EC-013). They drive the
// REAL Service against a live Postgres and assert fail-closed denials across
// organisation boundaries.
//
// Gated on TEST_DATABASE_URL exactly like live_db_integration_test.go
// (shared liveDBPool + seed helpers). Run:
//   export TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:54322/postgres"
//   go test ./tests/association/ -run IDOR -v

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/association"
)

// ── local seed helpers (build on live_db_integration_test.go helpers) ──────────

func seedOrgOfType(t *testing.T, ctx context.Context, pool *pgxpool.Pool, name, groupType string) string {
	t.Helper()
	orgID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_organisations (id, name, category, description, group_type, approval_rule, published)
		VALUES ($1, $2, 'Professional', '', $3, 'ADMIN', true)`, orgID, name, groupType); err != nil {
		t.Fatalf("seed org (%s): %v", groupType, err)
	}
	return orgID
}

// seedMemberProfile inserts the assoc_member_profiles row that the directory /
// member-detail reads inner-join on. jsonb columns rely on their schema defaults.
func seedMemberProfile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, membershipID, fullName string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_member_profiles (membership_id, full_name)
		VALUES ($1, $2) ON CONFLICT (membership_id) DO NOTHING`, membershipID, fullName); err != nil {
		t.Fatalf("seed member profile: %v", err)
	}
}

func seedChatThread(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orgID string) string {
	t.Helper()
	threadID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_chat_threads (id, organisation_id, title, scope)
		VALUES ($1, $2, 'General', 'GENERAL')`, threadID, orgID); err != nil {
		t.Fatalf("seed chat thread: %v", err)
	}
	return threadID
}

func seedApplication(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orgID, userID string) string {
	t.Helper()
	appID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_applications (id, organisation_id, user_id, status)
		VALUES ($1, $2, $3, 'PENDING')`, appID, orgID, userID); err != nil {
		t.Fatalf("seed application: %v", err)
	}
	return appID
}

func seedOfflinePayment(t *testing.T, ctx context.Context, pool *pgxpool.Pool, membershipID, invoiceID string, amountKobo int64) string {
	t.Helper()
	paymentID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_payments (id, invoice_id, membership_id, amount_kobo, method, status, offline)
		VALUES ($1, $2, $3, $4, 'BANK_TRANSFER', 'PENDING', true)`,
		paymentID, invoiceID, membershipID, amountKobo); err != nil {
		t.Fatalf("seed offline payment: %v", err)
	}
	return paymentID
}

// ── Group 1: cross-org data isolation ─────────────────────────────────────────

func TestLiveDB_IDOR_GetChatThread_CrossOrgForbidden(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgA := seedOrganisation(t, ctx, pool, "ChatA "+uuid.New().String())
	orgB := seedOrganisation(t, ctx, pool, "ChatB "+uuid.New().String())
	threadA := seedChatThread(t, ctx, pool, orgA)
	memberA, _ := seedActiveMembership(t, ctx, pool, orgA)
	memberB, _ := seedActiveMembership(t, ctx, pool, orgB)

	// Positive: a member of org A can open org A's thread.
	if _, err := svc.GetChatThread(ctx, memberA, threadA); err != nil {
		t.Fatalf("member of org A must read org A thread, got: %v", err)
	}
	// Negative (IDOR): a member of org B must NOT read org A's thread.
	if _, err := svc.GetChatThread(ctx, memberB, threadA); err == nil {
		t.Fatal("CROSS-ORG IDOR: member of org B read org A's chat thread (want error)")
	}
}

func TestLiveDB_IDOR_SendChatMessage_CrossOrgForbidden(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgA := seedOrganisation(t, ctx, pool, "SendA "+uuid.New().String())
	orgB := seedOrganisation(t, ctx, pool, "SendB "+uuid.New().String())
	threadA := seedChatThread(t, ctx, pool, orgA)
	memberA, _ := seedActiveMembership(t, ctx, pool, orgA)
	memberB, _ := seedActiveMembership(t, ctx, pool, orgB)

	// Positive: org A member can post to org A thread.
	if _, err := svc.SendChatMessage(ctx, memberA, threadA, "hello"); err != nil {
		t.Fatalf("member of org A must post to org A thread, got: %v", err)
	}
	// Negative (IDOR write): org B member must NOT post to org A thread.
	if _, err := svc.SendChatMessage(ctx, memberB, threadA, "intrusion"); err == nil {
		t.Fatal("CROSS-ORG IDOR: member of org B posted to org A's thread (want error)")
	}
	// And no foreign message was written.
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_chat_messages WHERE thread_id=$1 AND body='intrusion'`, threadA).Scan(&n); err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if n != 0 {
		t.Fatalf("foreign message was persisted (%d rows) despite forbidden send", n)
	}
}

func TestLiveDB_IDOR_ReactToMessage_CrossOrgForbidden(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgA := seedOrganisation(t, ctx, pool, "ReactA "+uuid.New().String())
	orgB := seedOrganisation(t, ctx, pool, "ReactB "+uuid.New().String())
	threadA := seedChatThread(t, ctx, pool, orgA)
	memberA, _ := seedActiveMembership(t, ctx, pool, orgA)
	memberB, _ := seedActiveMembership(t, ctx, pool, orgB)

	// A real message in org A's thread (author = memberA, via the scoped send path).
	msg, err := svc.SendChatMessage(ctx, memberA, threadA, "hi")
	if err != nil {
		t.Fatalf("seed message via SendChatMessage: %v", err)
	}

	// Positive: org A member can react.
	if err := svc.ReactToMessage(ctx, memberA, threadA, msg.ID, "👍"); err != nil {
		t.Fatalf("member of org A must react to org A message, got: %v", err)
	}
	// Negative (IDOR write): org B member must NOT react to org A's message.
	if err := svc.ReactToMessage(ctx, memberB, threadA, msg.ID, "🔥"); err == nil {
		t.Fatal("CROSS-ORG IDOR: member of org B reacted to org A's message (want error)")
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_chat_message_reactions WHERE message_id=$1 AND emoji='🔥'`, msg.ID).Scan(&n); err != nil {
		t.Fatalf("count reactions: %v", err)
	}
	if n != 0 {
		t.Fatalf("foreign reaction persisted (%d rows) despite forbidden react", n)
	}
}

func TestLiveDB_IDOR_GetAiNote_CrossOrgForbidden(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgA := seedOrganisation(t, ctx, pool, "NoteA "+uuid.New().String())
	orgB := seedOrganisation(t, ctx, pool, "NoteB "+uuid.New().String())
	noteA := seedAiNote(t, ctx, pool, orgA)
	memberA, _ := seedActiveMembership(t, ctx, pool, orgA)
	memberB, _ := seedActiveMembership(t, ctx, pool, orgB)

	if _, err := svc.GetAiNote(ctx, memberA, noteA); err != nil {
		t.Fatalf("member of org A must read org A ai-note, got: %v", err)
	}
	if _, err := svc.GetAiNote(ctx, memberB, noteA); err == nil {
		t.Fatal("CROSS-ORG IDOR: member of org B read org A's ai-note (want error)")
	}
	// Status endpoint must be scoped the same way.
	if _, err := svc.GetAiNoteStatus(ctx, memberB, noteA); err == nil {
		t.Fatal("CROSS-ORG IDOR: member of org B read org A's ai-note status (want error)")
	}
}

func TestLiveDB_IDOR_GetDirectory_ScopedToViewerOrg(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgA := seedOrganisation(t, ctx, pool, "DirA "+uuid.New().String())
	orgB := seedOrganisation(t, ctx, pool, "DirB "+uuid.New().String())
	viewerA, viewerMembershipA := seedActiveMembership(t, ctx, pool, orgA)
	_, foreignMembershipB := seedActiveMembership(t, ctx, pool, orgB)
	seedMemberProfile(t, ctx, pool, viewerMembershipA, "Viewer A")
	seedMemberProfile(t, ctx, pool, foreignMembershipB, "Foreign B")

	list, err := svc.GetDirectory(ctx, viewerA, association.MemberDirectoryQuery{})
	if err != nil {
		t.Fatalf("GetDirectory: %v", err)
	}
	sawSelf, sawForeign := false, false
	for _, m := range list {
		if m.ID == viewerMembershipA {
			sawSelf = true
		}
		if m.ID == foreignMembershipB {
			sawForeign = true
		}
	}
	if !sawSelf {
		t.Errorf("directory omitted the viewer's own org member")
	}
	if sawForeign {
		t.Fatal("CROSS-ORG LEAK: directory returned a member of a foreign organisation")
	}
}

func TestLiveDB_IDOR_GetMember_CrossOrgForbidden(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgA := seedOrganisation(t, ctx, pool, "MemA "+uuid.New().String())
	orgB := seedOrganisation(t, ctx, pool, "MemB "+uuid.New().String())
	_, targetMembershipA := seedActiveMembership(t, ctx, pool, orgA)
	seedMemberProfile(t, ctx, pool, targetMembershipA, "Target A")
	viewerB, _ := seedActiveMembership(t, ctx, pool, orgB)
	viewerA, _ := seedActiveMembership(t, ctx, pool, orgA)

	if _, err := svc.GetMember(ctx, viewerA, targetMembershipA); err != nil {
		t.Fatalf("same-org member view must succeed, got: %v", err)
	}
	if _, err := svc.GetMember(ctx, viewerB, targetMembershipA); err == nil {
		t.Fatal("CROSS-ORG IDOR: member of org B fetched a member of org A (want error)")
	}
}

// ── Group 2: admin cross-org authorization ────────────────────────────────────

func TestLiveDB_IDOR_DecideApplication_RequiresSameOrgAdmin(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgA := seedOrganisation(t, ctx, pool, "AppOrgA "+uuid.New().String())
	orgB := seedOrganisation(t, ctx, pool, "AppOrgB "+uuid.New().String())
	applicantUser, _ := seedActiveMembership(t, ctx, pool, orgB) // membership pre-exists; app pending
	appB := seedApplication(t, ctx, pool, orgB, applicantUser)

	adminA := seedAdminRole(t, ctx, pool, orgA, "NATIONAL_ADMIN") // admin of the WRONG org
	plainB, _ := seedActiveMembership(t, ctx, pool, orgB)         // member of org B, no admin role

	req := association.ApprovalDecisionRequest{Decision: "APPROVE", IdempotencyKey: "idem-" + uuid.New().String()}

	// Missing-authz: a plain member cannot decide.
	if err := svc.DecideApplication(ctx, plainB, appB, req); err == nil {
		t.Fatal("BROKEN AUTHZ: a non-admin decided an application (want error)")
	}
	// Cross-org: an admin of org A cannot decide org B's application.
	if err := svc.DecideApplication(ctx, adminA, appB, req); err == nil {
		t.Fatal("CROSS-ORG IDOR: admin of org A decided org B's application (want error)")
	}
	// The forbidden attempts must not have mutated the application.
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_applications WHERE id=$1`, appB).Scan(&status); err != nil {
		t.Fatalf("read app status: %v", err)
	}
	if status != "PENDING" {
		t.Fatalf("application status changed to %s despite forbidden decisions", status)
	}
	// Positive: an admin of org B (ManageMembers) can decide.
	adminB := seedAdminRole(t, ctx, pool, orgB, "NATIONAL_ADMIN")
	if err := svc.DecideApplication(ctx, adminB, appB, req); err != nil {
		t.Fatalf("same-org admin must decide, got: %v", err)
	}
}

func TestLiveDB_IDOR_DecideOfflinePayment_CrossOrgForbidden(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgA := seedOrganisation(t, ctx, pool, "PayOrgA "+uuid.New().String())
	orgB := seedOrganisation(t, ctx, pool, "PayOrgB "+uuid.New().String())
	_, membershipB := seedActiveMembership(t, ctx, pool, orgB)
	invoiceB := seedDuesInvoice(t, ctx, pool, membershipB, 500_00)
	paymentB := seedOfflinePayment(t, ctx, pool, membershipB, invoiceB, 500_00)

	financeAdminA := seedAdminRole(t, ctx, pool, orgA, "FINANCE_ADMIN") // finance admin of WRONG org
	key := "idem-" + uuid.New().String()
	if err := svc.DecideOfflinePayment(ctx, financeAdminA, paymentB, key, true); err == nil {
		t.Fatal("CROSS-ORG IDOR: finance admin of org A approved org B's offline payment (want error)")
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_payments WHERE id=$1`, paymentB).Scan(&status); err != nil {
		t.Fatalf("read payment status: %v", err)
	}
	if status != "PENDING" {
		t.Fatalf("payment advanced to %s despite forbidden cross-org approval", status)
	}
}

func TestLiveDB_IDOR_SuspendMember_CrossOrgForbidden(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgA := seedOrganisation(t, ctx, pool, "SuspA "+uuid.New().String())
	orgB := seedOrganisation(t, ctx, pool, "SuspB "+uuid.New().String())
	_, targetMembershipB := seedActiveMembership(t, ctx, pool, orgB)
	adminA := seedAdminRole(t, ctx, pool, orgA, "NATIONAL_ADMIN")

	if err := svc.SuspendMember(ctx, adminA, targetMembershipB, "test"); err == nil {
		t.Fatal("CROSS-ORG IDOR: admin of org A suspended a member of org B (want error)")
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_memberships WHERE id=$1`, targetMembershipB).Scan(&status); err != nil {
		t.Fatalf("read membership status: %v", err)
	}
	if status != "ACTIVE" {
		t.Fatalf("member suspended to %s despite forbidden cross-org action", status)
	}
}

func TestLiveDB_IDOR_AssignRole_CrossOrgForbidden(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgA := seedOrganisation(t, ctx, pool, "RoleA "+uuid.New().String())
	orgB := seedOrganisation(t, ctx, pool, "RoleB "+uuid.New().String())
	_, targetMembershipB := seedActiveMembership(t, ctx, pool, orgB)
	adminA := seedAdminRole(t, ctx, pool, orgA, "SUPER_ADMIN")

	if err := svc.AssignRole(ctx, adminA, targetMembershipB, "CHAPTER_ADMIN"); err == nil {
		t.Fatal("CROSS-ORG IDOR: super-admin of org A assigned a role in org B (want error)")
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_member_roles WHERE membership_id=$1`, targetMembershipB).Scan(&n); err != nil {
		t.Fatalf("count roles: %v", err)
	}
	if n != 0 {
		t.Fatalf("role granted in foreign org despite forbidden action (%d rows)", n)
	}
}

// ── Group 3: invite-only discovery hiding ─────────────────────────────────────

func TestLiveDB_IDOR_Discovery_HidesInviteOnly(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	tag := uuid.New().String()
	closedID := seedOrgOfType(t, ctx, pool, "Closed-"+tag, "CLOSED")
	inviteID := seedOrgOfType(t, ctx, pool, "Invite-"+tag, "INVITE_ONLY")

	list, err := svc.GetOrganisations(ctx, tag, 0, 0) // search term matches both by name
	if err != nil {
		t.Fatalf("GetOrganisations: %v", err)
	}
	sawClosed, sawInvite := false, false
	for _, o := range list {
		if o.ID == closedID {
			sawClosed = true
		}
		if o.ID == inviteID {
			sawInvite = true
		}
	}
	if !sawClosed {
		t.Errorf("discovery hid a CLOSED (approval-required) org — should be discoverable")
	}
	if sawInvite {
		t.Fatal("DISCOVERY LEAK: INVITE_ONLY org appeared in public discovery (want hidden)")
	}
}

func TestLiveDB_IDOR_GetOrganisation_InviteOnlyHiddenFromNonMember(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	inviteID := seedOrgOfType(t, ctx, pool, "InviteDetail-"+uuid.New().String(), "INVITE_ONLY")
	memberUser, _ := seedActiveMembership(t, ctx, pool, inviteID)
	outsiderUser, _ := seedActiveMembership(t, ctx, pool, seedOrganisation(t, ctx, pool, "Other "+uuid.New().String()))

	// Member of the invite-only org can view its detail.
	if _, err := svc.GetOrganisation(ctx, memberUser, inviteID); err != nil {
		t.Fatalf("member must view invite-only org detail, got: %v", err)
	}
	// Outsider must NOT be able to fetch the invite-only org by id.
	if _, err := svc.GetOrganisation(ctx, outsiderUser, inviteID); err == nil {
		t.Fatal("DISCOVERY LEAK: outsider fetched INVITE_ONLY org detail by id (want error)")
	}
}
