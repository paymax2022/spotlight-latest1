package association

// ---------------------------------------------------------------------------
// LIVE-DB UAT for the state-leader onboarding + delegated-RBAC feature added
// this session:
//
//   - PublishOrganisation now auto-links a state leader to an existing
//     platform_users account by email, grants them CHAPTER_ADMIN scoped to
//     their state's chapter, and (post-commit) sends a welcome email via the
//     LeaderNotifier seam.
//   - AssignRole gained a chapter-scoped delegation path: a CHAPTER_ADMIN
//     (the state leader) may grant CHAPTER_ADMIN/SECRETARY to a member who
//     shares their OWN chapter, but can neither escalate to a privileged
//     role nor reach into another chapter/state. This is new privilege-
//     boundary code, so the cross-state and role-escalation refusals are the
//     cases most worth proving against a real database.
//
// Follows the pattern established in internal/marketplace/service_boost_live_db_test.go:
// TEST_DATABASE_URL-gated, pgxpool via t.Cleanup, no fakes for the DB layer.
//
// Run:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/association/... -run TestLiveDB -v
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func assocLiveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB association RBAC tests")
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

// fakeLeaderNotifier records every call so tests can assert the welcome email
// fired (or didn't) without a real Brevo client.
type fakeLeaderNotifier struct {
	calls []fakeLeaderNotifierCall
}

type fakeLeaderNotifierCall struct {
	toEmail, leaderName, orgName, stateName string
	canApproveMembers                       bool
}

func (f *fakeLeaderNotifier) NotifyStateLeader(_ context.Context, toEmail, leaderName, orgName, stateName string, canApproveMembers bool) error {
	f.calls = append(f.calls, fakeLeaderNotifierCall{toEmail, leaderName, orgName, stateName, canApproveMembers})
	return nil
}

// seedPlatformUser inserts a minimal platform_users row and returns its id.
func seedPlatformUser(t *testing.T, pool *pgxpool.Pool, email string) string {
	t.Helper()
	id := uuid.New().String()
	_, err := pool.Exec(context.Background(),
		`INSERT INTO platform_users (id, first_name, last_name, email, user_type) VALUES ($1,$2,$3,$4,$5)`,
		id, "Test", "Leader", email, "registered_user")
	if err != nil {
		t.Fatalf("seed platform_users: %v", err)
	}
	return id
}

func testOrgDraft(name string, chapters []OrgDraftChapter, leaders []OrgDraftStateLeader) OrgDraft {
	year := 2020
	return OrgDraft{
		Name:          name,
		Category:      "TEST",
		LogoURL:       "https://example.com/logo.png",
		FoundedYear:   &year,
		GroupType:     "OPEN",
		StructureType: "STATEWIDE",
		Chapters:      chapters,
		StateLeaders:  leaders,
		AcceptedTerms: true,
	}
}

func TestLiveDB_PublishOrganisation_AutoLinksMatchedStateLeaderAndNotifies(t *testing.T) {
	pool := assocLiveDBPool(t)
	ctx := context.Background()

	leaderEmail := "leader-" + uuid.New().String() + "@test.spotlight.dev"
	leaderUserID := seedPlatformUser(t, pool, leaderEmail)
	founderID := uuid.New().String()

	notifier := &fakeLeaderNotifier{}
	svc := NewService(pool, nil)
	svc.SetLeaderNotifier(notifier)

	draft := testOrgDraft("Test Assoc "+uuid.New().String(), []OrgDraftChapter{
		{Name: "Lagos", Level: "STATE"},
	}, []OrgDraftStateLeader{
		{State: "Lagos", LeaderName: "Jane Doe", LeaderEmail: leaderEmail, CanApproveMembers: true},
	})

	result, err := svc.PublishOrganisation(ctx, founderID, draft)
	if err != nil {
		t.Fatalf("PublishOrganisation: %v", err)
	}

	var chapterLeaderUserID *string
	var storedEmail string
	if err := pool.QueryRow(ctx,
		`SELECT user_id, leader_email FROM assoc_chapter_leaders WHERE organisation_id=$1 AND state_name='Lagos'`,
		result.OrganisationID).Scan(&chapterLeaderUserID, &storedEmail); err != nil {
		t.Fatalf("query assoc_chapter_leaders: %v", err)
	}
	if chapterLeaderUserID == nil || *chapterLeaderUserID != leaderUserID {
		t.Fatalf("expected chapter leader user_id=%s, got %v", leaderUserID, chapterLeaderUserID)
	}
	if storedEmail != leaderEmail {
		t.Fatalf("expected leader_email=%s, got %s", leaderEmail, storedEmail)
	}

	var role string
	var chapterName string
	if err := pool.QueryRow(ctx, `
		SELECT r.role, c.name
		FROM assoc_member_roles r
		JOIN assoc_memberships m ON m.id = r.membership_id
		JOIN assoc_chapters c ON c.id = m.chapter_id
		WHERE m.organisation_id=$1 AND m.user_id=$2`,
		result.OrganisationID, leaderUserID).Scan(&role, &chapterName); err != nil {
		t.Fatalf("query granted role: %v", err)
	}
	if role != "CHAPTER_ADMIN" {
		t.Fatalf("expected role CHAPTER_ADMIN, got %s", role)
	}
	if chapterName != "Lagos" {
		t.Fatalf("expected role scoped to Lagos chapter, got %s", chapterName)
	}

	if len(notifier.calls) != 1 {
		t.Fatalf("expected exactly 1 notification, got %d", len(notifier.calls))
	}
	call := notifier.calls[0]
	if call.toEmail != leaderEmail || call.leaderName != "Jane Doe" || call.stateName != "Lagos" || !call.canApproveMembers {
		t.Fatalf("unexpected notification payload: %+v", call)
	}
}

func TestLiveDB_PublishOrganisation_UnmatchedEmailSkipsLinkAndNotify(t *testing.T) {
	pool := assocLiveDBPool(t)
	ctx := context.Background()

	unmatchedEmail := "no-such-user-" + uuid.New().String() + "@test.spotlight.dev"
	founderID := uuid.New().String()

	notifier := &fakeLeaderNotifier{}
	svc := NewService(pool, nil)
	svc.SetLeaderNotifier(notifier)

	draft := testOrgDraft("Test Assoc "+uuid.New().String(), []OrgDraftChapter{
		{Name: "Ogun", Level: "STATE"},
	}, []OrgDraftStateLeader{
		{State: "Ogun", LeaderName: "No Account", LeaderEmail: unmatchedEmail, CanApproveMembers: false},
	})

	result, err := svc.PublishOrganisation(ctx, founderID, draft)
	if err != nil {
		t.Fatalf("PublishOrganisation: %v", err)
	}

	var chapterLeaderUserID *string
	if err := pool.QueryRow(ctx,
		`SELECT user_id FROM assoc_chapter_leaders WHERE organisation_id=$1 AND state_name='Ogun'`,
		result.OrganisationID).Scan(&chapterLeaderUserID); err != nil {
		t.Fatalf("query assoc_chapter_leaders: %v", err)
	}
	if chapterLeaderUserID != nil {
		t.Fatalf("expected no user_id link, got %v", *chapterLeaderUserID)
	}

	// PublishOrganisation always grants the founder their own org-owner
	// SUPER_ADMIN role, so "no roles granted" must be scoped to CHAPTER_ADMIN
	// (the role the auto-link would have granted the leader) rather than
	// asserting zero roles in the org.
	var chapterAdminCount int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM assoc_member_roles r JOIN assoc_memberships m ON m.id=r.membership_id WHERE m.organisation_id=$1 AND r.role='CHAPTER_ADMIN'`,
		result.OrganisationID).Scan(&chapterAdminCount); err != nil {
		t.Fatalf("count CHAPTER_ADMIN roles: %v", err)
	}
	if chapterAdminCount != 0 {
		t.Fatalf("expected no CHAPTER_ADMIN role granted, got %d", chapterAdminCount)
	}

	if len(notifier.calls) != 0 {
		t.Fatalf("expected no notification, got %d", len(notifier.calls))
	}
}

// stateScopedRBACFixture builds one organisation with two state chapters,
// a CHAPTER_ADMIN scoped to state A, and one plain member in each state —
// the minimum shape needed to exercise AssignRole's cross-state and
// role-escalation refusals.
type stateScopedRBACFixture struct {
	orgID                                  string
	stateALeaderUserID, stateAMemberID     string
	stateAMembershipID, stateBMembershipID string
}

func newStateScopedRBACFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, svc *Service) stateScopedRBACFixture {
	t.Helper()

	leaderEmail := "leader-" + uuid.New().String() + "@test.spotlight.dev"
	leaderUserID := seedPlatformUser(t, pool, leaderEmail)
	founderID := uuid.New().String()

	draft := testOrgDraft("Test Assoc "+uuid.New().String(), []OrgDraftChapter{
		{Name: "StateA", Level: "STATE"},
		{Name: "StateB", Level: "STATE"},
	}, []OrgDraftStateLeader{
		{State: "StateA", LeaderName: "State A Leader", LeaderEmail: leaderEmail, CanApproveMembers: true},
	})
	result, err := svc.PublishOrganisation(ctx, founderID, draft)
	if err != nil {
		t.Fatalf("PublishOrganisation: %v", err)
	}

	var stateAChapterID, stateBChapterID string
	if err := pool.QueryRow(ctx, `SELECT id FROM assoc_chapters WHERE organisation_id=$1 AND name='StateA'`, result.OrganisationID).Scan(&stateAChapterID); err != nil {
		t.Fatalf("lookup StateA chapter: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT id FROM assoc_chapters WHERE organisation_id=$1 AND name='StateB'`, result.OrganisationID).Scan(&stateBChapterID); err != nil {
		t.Fatalf("lookup StateB chapter: %v", err)
	}

	stateAMemberUserID := uuid.New().String()
	stateBMemberUserID := uuid.New().String()
	var stateAMembershipID, stateBMembershipID string
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)
	stateAMembershipID, err = svc.ensureMembership(ctx, tx, result.OrganisationID, stateAMemberUserID, "ACTIVE", "PAID", "MEM", nil, &stateAChapterID)
	if err != nil {
		t.Fatalf("seed state A member: %v", err)
	}
	stateBMembershipID, err = svc.ensureMembership(ctx, tx, result.OrganisationID, stateBMemberUserID, "ACTIVE", "PAID", "MEM", nil, &stateBChapterID)
	if err != nil {
		t.Fatalf("seed state B member: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit tx: %v", err)
	}

	return stateScopedRBACFixture{
		orgID:              result.OrganisationID,
		stateALeaderUserID: leaderUserID,
		stateAMembershipID: stateAMembershipID,
		stateBMembershipID: stateBMembershipID,
	}
}

func TestLiveDB_AssignRole_StateLeaderCanDelegateWithinOwnState(t *testing.T) {
	pool := assocLiveDBPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	fx := newStateScopedRBACFixture(t, ctx, pool, svc)

	if err := svc.AssignRole(ctx, fx.stateALeaderUserID, fx.stateAMembershipID, "SECRETARY"); err != nil {
		t.Fatalf("expected state leader to delegate SECRETARY within own state, got: %v", err)
	}

	var role string
	if err := pool.QueryRow(ctx,
		`SELECT role FROM assoc_member_roles WHERE membership_id=$1 AND role='SECRETARY'`,
		fx.stateAMembershipID).Scan(&role); err != nil {
		t.Fatalf("expected SECRETARY role row to exist: %v", err)
	}
}

func TestLiveDB_AssignRole_StateLeaderCannotDelegateAcrossStates(t *testing.T) {
	pool := assocLiveDBPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	fx := newStateScopedRBACFixture(t, ctx, pool, svc)

	err := svc.AssignRole(ctx, fx.stateALeaderUserID, fx.stateBMembershipID, "SECRETARY")
	if err != ErrForbidden {
		t.Fatalf("expected ErrForbidden for cross-state delegation, got: %v", err)
	}
}

func TestLiveDB_AssignRole_StateLeaderCannotEscalateToFinanceAdmin(t *testing.T) {
	pool := assocLiveDBPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	fx := newStateScopedRBACFixture(t, ctx, pool, svc)

	err := svc.AssignRole(ctx, fx.stateALeaderUserID, fx.stateAMembershipID, "FINANCE_ADMIN")
	if err != ErrForbidden {
		t.Fatalf("expected ErrForbidden for privileged-role escalation, got: %v", err)
	}

	err = svc.AssignRole(ctx, fx.stateALeaderUserID, fx.stateAMembershipID, "SUPER_ADMIN")
	if err != ErrForbidden {
		t.Fatalf("expected ErrForbidden for SUPER_ADMIN escalation, got: %v", err)
	}
}

func TestLiveDB_AssignRole_SuperAdminUnrestrictedAcrossStatesAndRoles(t *testing.T) {
	pool := assocLiveDBPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)

	founderEmail := "founder-" + uuid.New().String() + "@test.spotlight.dev"
	founderUserID := seedPlatformUser(t, pool, founderEmail)

	draft := testOrgDraft("Test Assoc "+uuid.New().String(), []OrgDraftChapter{
		{Name: "StateA", Level: "STATE"},
	}, nil)
	result, err := svc.PublishOrganisation(ctx, founderUserID, draft)
	if err != nil {
		t.Fatalf("PublishOrganisation: %v", err)
	}

	var stateAChapterID string
	if err := pool.QueryRow(ctx, `SELECT id FROM assoc_chapters WHERE organisation_id=$1 AND name='StateA'`, result.OrganisationID).Scan(&stateAChapterID); err != nil {
		t.Fatalf("lookup StateA chapter: %v", err)
	}
	memberUserID := uuid.New().String()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)
	membershipID, err := svc.ensureMembership(ctx, tx, result.OrganisationID, memberUserID, "ACTIVE", "PAID", "MEM", nil, &stateAChapterID)
	if err != nil {
		t.Fatalf("seed member: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit tx: %v", err)
	}

	// PublishOrganisation grants the founder SUPER_ADMIN/NATIONAL_ADMIN over
	// their own org (service_ext.go) — this is the pre-existing unrestricted
	// path, which must keep working unchanged now that AssignRole also has a
	// scoped branch.
	if err := svc.AssignRole(ctx, founderUserID, membershipID, "FINANCE_ADMIN"); err != nil {
		t.Fatalf("expected founder/SUPER_ADMIN to assign any role anywhere, got: %v", err)
	}

	var role string
	if err := pool.QueryRow(ctx,
		`SELECT role FROM assoc_member_roles WHERE membership_id=$1 AND role='FINANCE_ADMIN'`,
		membershipID).Scan(&role); err != nil {
		t.Fatalf("expected FINANCE_ADMIN role row to exist: %v", err)
	}
}
