package association_test

// Regression tests for the defects fixed in the association module hardening
// pass. Each test names the defect it locks down; every one of these failed
// before the corresponding fix.
//
// Live-DB, same harness as live_db_integration_test.go: skipped without
// TEST_DATABASE_URL. Every row is created by the test with a fresh uuid.

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/association"
)

// newTestDraft builds a wizard draft exercising every field the publish path
// must persist — including the five that used to be silently discarded.
func newTestDraft(name string) association.OrgDraft {
	grace := 14
	founded := 1999
	return association.OrgDraft{
		Name:        name,
		Acronym:     "TST",
		Category:    "Professional",
		Description: "Created by the association regression suite.",
		// Required by validateOrgIdentity: the wizard cannot publish without a
		// logo and a founded year, so a draft that omits them is not a draft the
		// product can produce.
		LogoURL:             "https://cdn.test.invalid/logo.png",
		FoundedYear:         &founded,
		Location:            "Lagos, Nigeria",
		Website:             "https://test.invalid",
		GroupType:           "CLOSED",
		ApprovalRule:        "ADMIN",
		RegistrationFeeKobo: 250000,
		StructureType:       "STATEWIDE",
		StateLeaders: []association.OrgDraftStateLeader{
			{State: "Lagos", LeaderName: "Ada Leader", LeaderContact: "ada@test.invalid", CanApproveMembers: true},
		},
		Chapters: []association.OrgDraftChapter{
			{Name: "Lagos", Level: "STATE"},
		},
		Committees: []association.OrgDraftCommittee{
			{Name: "Finance"},
		},
		Categories: []association.OrgDraftCategory{
			{Label: "Full member", DuesKobo: 200000, Cadence: "ANNUAL"},
		},
		Rules:         []string{"Attend the AGM", "Pay dues on time"},
		Restrictions:  association.OrgDraftRestrictions{GraceDays: &grace, DisableVoting: true},
		AcceptedTerms: true,
	}
}

// newTestJoinDraft builds a join submission including a supporting document.
func newTestJoinDraft(orgID string) association.JoinDraft {
	url := "https://example.invalid/proof.pdf"
	return association.JoinDraft{
		OrganisationID: orgID,
		AcceptedRules:  true,
		Documents: []association.JoinDraftDocument{
			{Label: "Proof of qualification", URL: &url, Kind: "CERTIFICATE"},
		},
	}
}

// TestPublishOrganisation_FoundersOwnTheirOrg pins the P0 lockout: publish used
// to insert the organisation, chapters, committees and categories and NO
// membership or role, so GetAdminAccess/requireAssocAdmin/resolveOrgID all
// failed closed and the founder could not administer what they had just made.
func TestPublishOrganisation_FoundersOwnTheirOrg(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@founder.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}

	draft := newTestDraft("Founder Test " + uuid.New().String()[:8])
	res, err := svc.PublishOrganisation(ctx, userID, draft)
	if err != nil {
		t.Fatalf("publish: %v", err)
	}

	var status, standing, role, jurisdiction string
	if err := pool.QueryRow(ctx, `
		SELECT m.status, m.payment_standing, r.role, r.jurisdiction
		FROM assoc_memberships m
		JOIN assoc_member_roles r ON r.membership_id = m.id
		WHERE m.organisation_id=$1 AND m.user_id=$2`,
		res.OrganisationID, userID).Scan(&status, &standing, &role, &jurisdiction); err != nil {
		t.Fatalf("founder membership/role missing: %v", err)
	}
	if status != "ACTIVE" || role != "SUPER_ADMIN" || jurisdiction != "NATIONAL" {
		t.Fatalf("got status=%s role=%s jurisdiction=%s; want ACTIVE/SUPER_ADMIN/NATIONAL", status, role, jurisdiction)
	}

	// The companion profile row must exist: every read path joins it, and a
	// membership without one makes /me/profile and the directory fail.
	var profiles int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM assoc_member_profiles p
		JOIN assoc_memberships m ON m.id = p.membership_id
		WHERE m.organisation_id=$1 AND m.user_id=$2`, res.OrganisationID, userID).Scan(&profiles); err != nil {
		t.Fatalf("profile count: %v", err)
	}
	if profiles != 1 {
		t.Fatalf("member profile rows = %d; want 1", profiles)
	}

	// And the founder must actually read as an admin.
	access, err := svc.GetAdminAccess(ctx, userID)
	if err != nil {
		t.Fatalf("admin access: %v", err)
	}
	if !access.IsAdmin || access.Role != "SUPER_ADMIN" {
		t.Fatalf("GetAdminAccess = %+v; want IsAdmin with SUPER_ADMIN", access)
	}
	if access.OrganisationID == nil || *access.OrganisationID != res.OrganisationID {
		t.Fatalf("AdminAccess.OrganisationID = %v; want %s", access.OrganisationID, res.OrganisationID)
	}
}

// TestPublishOrganisation_IdempotentReplay pins the duplicate-organisation bug:
// the client always sent an Idempotency-Key and the handler never read it, so a
// transport retry created a second organisation with a second uuid.
func TestPublishOrganisation_IdempotentReplay(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@replay.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}

	draft := newTestDraft("Replay Test " + uuid.New().String()[:8])
	draft.IdempotencyKey = newIdemKey(t, "publish")

	first, err := svc.PublishOrganisation(ctx, userID, draft)
	if err != nil {
		t.Fatalf("first publish: %v", err)
	}
	second, err := svc.PublishOrganisation(ctx, userID, draft)
	if err != nil {
		t.Fatalf("replayed publish: %v", err)
	}
	if first.OrganisationID != second.OrganisationID {
		t.Fatalf("replay created a second organisation: %s vs %s", first.OrganisationID, second.OrganisationID)
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM assoc_organisations WHERE idempotency_key=$1`, draft.IdempotencyKey).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("organisations for one idempotency key = %d; want 1", count)
	}
}

// TestPublishOrganisation_PersistsWizardConfiguration pins the silent-drop bug:
// rules, restrictions, the structure type and per-state leaders were collected
// by the wizard, shown back on its review step, and then discarded because the
// Go OrgDraft had no fields for them.
func TestPublishOrganisation_PersistsWizardConfiguration(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@config.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}

	res, err := svc.PublishOrganisation(ctx, userID, newTestDraft("Config Test "+uuid.New().String()[:8]))
	if err != nil {
		t.Fatalf("publish: %v", err)
	}

	var rules int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM assoc_organisation_rules WHERE organisation_id=$1`, res.OrganisationID).Scan(&rules); err != nil {
		t.Fatalf("rules: %v", err)
	}
	if rules != 2 {
		t.Fatalf("persisted rules = %d; want 2", rules)
	}

	var graceDays int
	var disableVoting bool
	var structureType *string
	if err := pool.QueryRow(ctx,
		`SELECT grace_days, disable_voting, structure_type FROM assoc_organisations WHERE id=$1`,
		res.OrganisationID).Scan(&graceDays, &disableVoting, &structureType); err != nil {
		t.Fatalf("restrictions: %v", err)
	}
	if graceDays != 14 || !disableVoting {
		t.Fatalf("graceDays=%d disableVoting=%v; want 14/true", graceDays, disableVoting)
	}
	if structureType == nil || *structureType != "STATEWIDE" {
		t.Fatalf("structureType = %v; want STATEWIDE", structureType)
	}

	var leaderName *string
	var canApprove bool
	if err := pool.QueryRow(ctx,
		`SELECT leader_name, can_approve_members FROM assoc_chapter_leaders
		 WHERE organisation_id=$1 AND state_name='Lagos'`, res.OrganisationID).Scan(&leaderName, &canApprove); err != nil {
		t.Fatalf("chapter leader missing: %v", err)
	}
	if leaderName == nil || *leaderName != "Ada Leader" || !canApprove {
		t.Fatalf("leader=%v canApprove=%v; want 'Ada Leader'/true", leaderName, canApprove)
	}

	// And the detail DTO must surface what the join screens render, all of
	// which were absent and crashed the client on `.map` of undefined.
	org, err := svc.GetOrganisation(ctx, userID, res.OrganisationID)
	if err != nil {
		t.Fatalf("get organisation: %v", err)
	}
	if org.ApprovalSummary == "" {
		t.Fatal("ApprovalSummary is empty")
	}
	if org.Rules == nil || org.Requirements == nil || org.Branches == nil || org.CommitteeOptions == nil {
		t.Fatalf("nil slice in detail DTO: rules=%v requirements=%v branches=%v committees=%v",
			org.Rules, org.Requirements, org.Branches, org.CommitteeOptions)
	}
	if len(org.Rules) != 2 {
		t.Fatalf("detail rules = %d; want 2", len(org.Rules))
	}
	if org.Restrictions.GraceDays != 14 {
		t.Fatalf("detail graceDays = %d; want 14", org.Restrictions.GraceDays)
	}
}

// TestSubmitApplication_CreatesMembership pins the join pipeline: submitting to
// an OPEN organisation told the user "You are now a member" while creating no
// membership row at all, and DecideApplication's approve branch was an UPDATE
// that matched zero rows.
func TestSubmitApplication_CreatesMembership(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_organisations (id, name, category, group_type, approval_rule, published)
		VALUES ($1,$2,'Professional','OPEN','AUTO',true)`,
		orgID, "Open Join "+uuid.New().String()[:8]); err != nil {
		t.Fatalf("seed org: %v", err)
	}

	applicant := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		applicant, applicant+"@applicant.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}

	result, err := svc.SubmitApplication(ctx, applicant, newTestJoinDraft(orgID))
	if err != nil {
		t.Fatalf("submit application: %v", err)
	}
	if result.Status != "APPROVED" {
		t.Fatalf("status = %s; want APPROVED for an OPEN org", result.Status)
	}

	var status string
	if err := pool.QueryRow(ctx,
		`SELECT status FROM assoc_memberships WHERE organisation_id=$1 AND user_id=$2`,
		orgID, applicant).Scan(&status); err != nil {
		t.Fatalf("membership not created: %v", err)
	}
	if status != "ACTIVE" {
		t.Fatalf("membership status = %s; want ACTIVE", status)
	}

	// The supporting documents the join flow uploads must persist too — the
	// server used to bind nothing, so the whole upload step was decorative.
	var docs int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM assoc_application_documents WHERE application_id=$1`,
		result.ApplicationID).Scan(&docs); err != nil {
		t.Fatalf("documents: %v", err)
	}
	if docs != 1 {
		t.Fatalf("application documents = %d; want 1", docs)
	}
}

// TestGetAuditLog_DoesNotLeakAcrossOrganisations pins the audit leak: the query
// carried `WHERE (organisation_id=$1 OR actor_id=$2)`, and the actor clause
// defeated the org filter whenever one admin had acted in two organisations.
func TestGetAuditLog_DoesNotLeakAcrossOrganisations(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	founder := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		founder, founder+"@audit.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}

	// One admin, two organisations — exactly the shape that leaked.
	orgA, err := svc.PublishOrganisation(ctx, founder, newTestDraft("Audit A "+uuid.New().String()[:8]))
	if err != nil {
		t.Fatalf("publish A: %v", err)
	}
	orgB, err := svc.PublishOrganisation(ctx, founder, newTestDraft("Audit B "+uuid.New().String()[:8]))
	if err != nil {
		t.Fatalf("publish B: %v", err)
	}

	entries, err := svc.GetAuditLog(ctx, founder, "", orgA.OrganisationID)
	if err != nil {
		t.Fatalf("audit log: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("no audit entries for org A")
	}
	for _, e := range entries {
		if strings.Contains(e.SubjectID, orgB.OrganisationID) {
			t.Fatalf("org A's audit log leaked an org B row: %+v", e)
		}
		// The display fields the console renders must be populated; all four
		// were absent from the DTO, so every row rendered blank.
		if e.Summary == "" || e.At == "" || e.ActorName == "" {
			t.Fatalf("audit row missing display fields: %+v", e)
		}
	}
}

// TestMemberWrites_AreScopedToOwningOrganisation pins the cross-org write hole:
// these endpoints resolved the caller's own primary membership and then wrote a
// join row keyed by a caller-supplied object id, so a member of org A could
// RSVP to and check into org B's meetings.
func TestMemberWrites_AreScopedToOwningOrganisation(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgA := seedOrganisation(t, ctx, pool, "Scope A "+uuid.New().String()[:8])
	orgB := seedOrganisation(t, ctx, pool, "Scope B "+uuid.New().String()[:8])
	outsider, _ := seedActiveMembership(t, ctx, pool, orgA)

	// A meeting that belongs to org B only.
	meetingID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_meetings (id, organisation_id, title, starts_at)
		VALUES ($1,$2,'Org B private meeting', now() + interval '1 day')`, meetingID, orgB); err != nil {
		t.Fatalf("seed meeting: %v", err)
	}

	if err := svc.RsvpMeeting(ctx, outsider, meetingID, "YES"); err == nil {
		t.Fatal("a member of org A was allowed to RSVP to org B's meeting")
	}
	if err := svc.CheckInMeeting(ctx, outsider, meetingID); err == nil {
		t.Fatal("a member of org A was allowed to check into org B's meeting")
	}

	var attendance int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM assoc_meeting_attendance WHERE meeting_id=$1`, meetingID).Scan(&attendance); err != nil {
		t.Fatalf("attendance count: %v", err)
	}
	if attendance != 0 {
		t.Fatalf("attendance rows = %d; want 0 — a cross-org write landed", attendance)
	}
}

// TestRegenerateAiNoteSummary_RequiresOrgAdmin pins the unauthenticated IDOR:
// the service took an adminID and never checked it, so any authenticated user
// could flip any organisation's minutes back to PROCESSING.
func TestRegenerateAiNoteSummary_RequiresOrgAdmin(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgID := seedOrganisation(t, ctx, pool, "AI Note Org "+uuid.New().String()[:8])
	noteID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_ai_notes (id, organisation_id, meeting_title, source, status)
		VALUES ($1,$2,'Board minutes','TRANSCRIPT','READY')`, noteID, orgID); err != nil {
		t.Fatalf("seed ai note: %v", err)
	}

	stranger := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		stranger, stranger+"@stranger.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}

	if err := svc.RegenerateAiNoteSummary(ctx, stranger, noteID); err == nil {
		t.Fatal("a stranger was allowed to regenerate another organisation's minutes")
	}

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_ai_notes WHERE id=$1`, noteID).Scan(&status); err != nil {
		t.Fatalf("read note: %v", err)
	}
	if status != "READY" {
		t.Fatalf("note status = %s; want READY — the unauthorized call mutated it", status)
	}
}
