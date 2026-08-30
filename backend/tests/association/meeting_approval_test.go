package association_test

// ---------------------------------------------------------------------------
// Member-proposed meetings, approved by an organisation admin.
//
// WHY THIS EXISTS
// ---------------
// Only an admin could schedule a meeting: the create route is gated on
// requireOrgAdmin and the member-facing routes were read/RSVP/check-in only.
// A member now proposes, and an admin decides.
//
// The properties that matter are about VISIBILITY and AUTHORITY, not CRUD:
//   • an admin's own proposal is scheduled, not queued — otherwise the owner
//     would be asking themselves for permission
//   • a member's proposal is invisible to the rest of the organisation, which
//     is the entire point of approval
//   • but visible to its proposer, or they cannot see what they submitted
//   • only an admin may decide, and only once
//
// Live-DB, same harness as founder_and_scoping_test.go: skipped without
// TEST_DATABASE_URL.
// ---------------------------------------------------------------------------

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/association"
)

func ptrString(s string) *string { return &s }

// meetingDraft builds a valid proposal starting in the future.
func meetingDraft(title string) association.MeetingRequest {
	return association.MeetingRequest{
		Title:    title,
		Mode:     "PHYSICAL",
		StartsAt: time.Now().Add(72 * time.Hour).UTC().Format(time.RFC3339),
		Location: ptrString("Community Hall"),
	}
}

// meetingTitles returns the titles a user sees on their own calendar.
func meetingTitles(t *testing.T, ctx context.Context, svc *association.Service, userID string) []string {
	t.Helper()
	list, err := svc.GetMeetings(ctx, userID)
	if err != nil {
		t.Fatalf("GetMeetings: %v", err)
	}
	out := make([]string, 0, len(list))
	for _, m := range list {
		out = append(out, m.Title)
	}
	return out
}

func containsTitle(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

// orgWithAdminAndMember publishes an organisation and returns the founder (an
// admin by construction) and a plain active member.
func orgWithAdminAndMember(t *testing.T, ctx context.Context, pool *pgxpool.Pool, svc *association.Service) (orgID, adminID, memberID string) {
	t.Helper()
	adminID = uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		adminID, adminID+"@mtgadmin.test"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	res, err := svc.PublishOrganisation(ctx, adminID, newTestDraft("Meetings "+uuid.NewString()[:8]))
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	orgID = res.OrganisationID
	memberID, _ = seedMember(t, ctx, pool, orgID, "@mtgmember.test")

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM assoc_meetings WHERE organisation_id=$1`, orgID)
	})
	return orgID, adminID, memberID
}

// TestProposeMeeting_AdminSchedulesDirectly: an admin is not asking permission.
func TestProposeMeeting_AdminSchedulesDirectly(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	_, adminID, memberID := orgWithAdminAndMember(t, ctx, pool, svc)

	title := "Admin scheduled " + uuid.NewString()[:8]
	_, approval, err := svc.ProposeMeeting(ctx, adminID, meetingDraft(title))
	if err != nil {
		t.Fatalf("propose as admin: %v", err)
	}
	if approval != "APPROVED" {
		t.Fatalf("approvalStatus = %q, want APPROVED — an admin scheduling a meeting is not proposing one", approval)
	}
	if !containsTitle(meetingTitles(t, ctx, svc, memberID), title) {
		t.Error("an admin-scheduled meeting must be visible to members at once")
	}
}

// TestProposeMeeting_MemberProposalIsHiddenUntilApproved is the core property.
func TestProposeMeeting_MemberProposalIsHiddenUntilApproved(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgID, adminID, memberID := orgWithAdminAndMember(t, ctx, pool, svc)
	other, _ := seedMember(t, ctx, pool, orgID, "@mtgother.test")

	title := "Member proposed " + uuid.NewString()[:8]
	id, approval, err := svc.ProposeMeeting(ctx, memberID, meetingDraft(title))
	if err != nil {
		t.Fatalf("propose as member: %v", err)
	}
	if approval != "PENDING" {
		t.Fatalf("approvalStatus = %q, want PENDING", approval)
	}

	if containsTitle(meetingTitles(t, ctx, svc, other), title) {
		t.Error("a pending proposal must NOT appear on another member's calendar")
	}
	if !containsTitle(meetingTitles(t, ctx, svc, memberID), title) {
		t.Error("a proposer must see their own pending proposal")
	}

	pending, err := svc.GetPendingMeetings(ctx, adminID, orgID)
	if err != nil {
		t.Fatalf("pending queue: %v", err)
	}
	found := false
	for _, p := range pending {
		if p.ID == id {
			found = true
			if strings.TrimSpace(p.ProposedByName) == "" {
				t.Error("the queue must name who proposed it")
			}
		}
	}
	if !found {
		t.Error("the proposal is missing from the admin approval queue")
	}

	status, err := svc.DecideMeeting(ctx, adminID, id, association.MeetingApprovalDecision{Approve: true})
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if status != "APPROVED" {
		t.Fatalf("decision = %q, want APPROVED", status)
	}
	if !containsTitle(meetingTitles(t, ctx, svc, other), title) {
		t.Error("an approved meeting must appear on every member's calendar")
	}
}

// TestDecideMeeting_RejectedStaysHidden: rejection is not a soft approval.
func TestDecideMeeting_RejectedStaysHidden(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgID, adminID, memberID := orgWithAdminAndMember(t, ctx, pool, svc)
	other, _ := seedMember(t, ctx, pool, orgID, "@mtgrej.test")

	title := "Rejected " + uuid.NewString()[:8]
	id, _, err := svc.ProposeMeeting(ctx, memberID, meetingDraft(title))
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	status, err := svc.DecideMeeting(ctx, adminID, id, association.MeetingApprovalDecision{Approve: false, Note: "clashes with the AGM"})
	if err != nil {
		t.Fatalf("reject: %v", err)
	}
	if status != "REJECTED" {
		t.Fatalf("decision = %q, want REJECTED", status)
	}
	if containsTitle(meetingTitles(t, ctx, svc, other), title) {
		t.Error("a rejected proposal must never reach the organisation's calendar")
	}
	list, err := svc.GetMeetings(ctx, memberID)
	if err != nil {
		t.Fatalf("GetMeetings: %v", err)
	}
	for _, m := range list {
		if m.Title == title && m.ApprovalStatus != "REJECTED" {
			t.Errorf("proposer sees approvalStatus %q, want REJECTED", m.ApprovalStatus)
		}
	}
}

// TestDecideMeeting_OnlyAdminsAndOnlyOnce pins the authority and the record.
func TestDecideMeeting_OnlyAdminsAndOnlyOnce(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	orgID, adminID, memberID := orgWithAdminAndMember(t, ctx, pool, svc)

	id, _, err := svc.ProposeMeeting(ctx, memberID, meetingDraft("Authority "+uuid.NewString()[:8]))
	if err != nil {
		t.Fatalf("propose: %v", err)
	}

	if _, err := svc.DecideMeeting(ctx, memberID, id, association.MeetingApprovalDecision{Approve: true}); err == nil {
		t.Fatal("a non-admin must not be able to decide a meeting")
	}

	outsider := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		outsider, outsider+"@mtgoutsider.test"); err != nil {
		t.Fatalf("seed outsider: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1`, outsider) })
	if _, err := svc.DecideMeeting(ctx, outsider, id, association.MeetingApprovalDecision{Approve: true}); err == nil {
		t.Fatal("an outsider must not be able to decide a meeting")
	}

	if _, err := svc.DecideMeeting(ctx, adminID, id, association.MeetingApprovalDecision{Approve: true}); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if _, err := svc.DecideMeeting(ctx, adminID, id, association.MeetingApprovalDecision{Approve: false}); err == nil {
		t.Error("an already-decided meeting must not be decidable again")
	}

	pending, err := svc.GetPendingMeetings(ctx, adminID, orgID)
	if err != nil {
		t.Fatalf("pending: %v", err)
	}
	for _, p := range pending {
		if p.ID == id {
			t.Error("a decided meeting must leave the pending queue")
		}
	}
}

// TestProposeMeeting_RejectsPastStart: a proposal an admin cannot meaningfully
// approve should not be accepted in the first place.
func TestProposeMeeting_RejectsPastStart(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveAssociationService(pool)

	_, _, memberID := orgWithAdminAndMember(t, ctx, pool, svc)

	draft := meetingDraft("Past " + uuid.NewString()[:8])
	draft.StartsAt = time.Now().Add(-24 * time.Hour).UTC().Format(time.RFC3339)
	if _, _, err := svc.ProposeMeeting(ctx, memberID, draft); err == nil {
		t.Error("a meeting starting in the past must be refused")
	}
}
