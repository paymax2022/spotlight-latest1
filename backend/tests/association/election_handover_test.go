package association_test

// Winner -> role handover (EL-015 / EC-011). Live-DB. Proves that publishing then
// handing over an election grants the winner the position's role and revokes the
// outgoing holders in the org (no lingering access), exactly once, senior-officer
// only, and only after results are published.

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/association"
)

func roleCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, membershipID, role string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_member_roles WHERE membership_id=$1 AND role=$2`, membershipID, role).Scan(&n); err != nil {
		t.Fatalf("role count: %v", err)
	}
	return n
}

// buildPublishedRoleElection creates a President position that confers NATIONAL_ADMIN,
// runs a 2–1 vote for candidate A, and closes + publishes. Returns the officer plus
// the winning/losing candidate memberships.
func buildPublishedRoleElection(t *testing.T, ctx context.Context, pool *pgxpool.Pool, svc *association.Service) (org, officer, electionID, candAMem, candBMem string) {
	t.Helper()
	org = seedOrganisation(t, ctx, pool, "HandoverOrg "+uuid.New().String())
	officer = seedAdminRole(t, ctx, pool, org, "NATIONAL_ADMIN")
	_, candAMem = seedActiveMembership(t, ctx, pool, org)
	_, candBMem = seedActiveMembership(t, ctx, pool, org)

	electionID, err := svc.CreateElection(ctx, officer, "", association.CreateElectionInput{
		Title:     "Exco",
		Positions: []association.CreatePositionInput{{Title: "President", Seats: 1, Role: "NATIONAL_ADMIN"}},
	})
	if err != nil {
		t.Fatalf("CreateElection: %v", err)
	}
	var positionID string
	if err := pool.QueryRow(ctx, `SELECT id FROM assoc_election_positions WHERE election_id=$1`, electionID).Scan(&positionID); err != nil {
		t.Fatalf("read position: %v", err)
	}
	candA, err := svc.AddCandidate(ctx, officer, electionID, association.AddCandidateInput{PositionID: positionID, MembershipID: candAMem})
	if err != nil {
		t.Fatalf("AddCandidate A: %v", err)
	}
	candB, err := svc.AddCandidate(ctx, officer, electionID, association.AddCandidateInput{PositionID: positionID, MembershipID: candBMem})
	if err != nil {
		t.Fatalf("AddCandidate B: %v", err)
	}
	if err := svc.OpenElection(ctx, officer, electionID); err != nil {
		t.Fatalf("OpenElection: %v", err)
	}
	for i := 0; i < 2; i++ {
		u, _ := seedActiveMembership(t, ctx, pool, org)
		if _, err := svc.CastVote(ctx, u, electionID, association.CastVoteInput{PositionID: positionID, CandidateID: candA}); err != nil {
			t.Fatalf("vote A: %v", err)
		}
	}
	ub, _ := seedActiveMembership(t, ctx, pool, org)
	if _, err := svc.CastVote(ctx, ub, electionID, association.CastVoteInput{PositionID: positionID, CandidateID: candB}); err != nil {
		t.Fatalf("vote B: %v", err)
	}
	if err := svc.CloseElection(ctx, officer, electionID); err != nil {
		t.Fatalf("CloseElection: %v", err)
	}
	if _, err := svc.PublishResults(ctx, officer, electionID); err != nil {
		t.Fatalf("PublishResults: %v", err)
	}
	return org, officer, electionID, candAMem, candBMem
}

func TestLiveDB_Handover_GrantsWinnerRevokesOutgoing(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	org, officer, electionID, candAMem, candBMem := buildPublishedRoleElection(t, ctx, pool, svc)

	// An outgoing incumbent already holds NATIONAL_ADMIN in the org.
	_, outgoingMem := seedActiveMembership(t, ctx, pool, org)
	execE(t, ctx, pool, `INSERT INTO assoc_member_roles (id, membership_id, role, jurisdiction) VALUES ($1,$2,'NATIONAL_ADMIN','NATIONAL')`, uuid.New().String(), outgoingMem)

	// Pre-conditions: winner has no role; incumbent holds it.
	if roleCount(t, ctx, pool, candAMem, "NATIONAL_ADMIN") != 0 {
		t.Fatal("winner already holds the role before handover")
	}
	if roleCount(t, ctx, pool, outgoingMem, "NATIONAL_ADMIN") != 1 {
		t.Fatal("incumbent should hold the role before handover")
	}

	res, err := svc.HandoverElection(ctx, officer, electionID)
	if err != nil {
		t.Fatalf("HandoverElection: %v", err)
	}
	if len(res.Positions) != 1 || res.Positions[0].Role != "NATIONAL_ADMIN" || len(res.Positions[0].Winners) != 1 {
		t.Fatalf("handover summary wrong: %+v", res.Positions)
	}

	// Winner gains the role; outgoing incumbent loses it (EC-011: no lingering access).
	if roleCount(t, ctx, pool, candAMem, "NATIONAL_ADMIN") != 1 {
		t.Fatal("winner did not gain the role")
	}
	if roleCount(t, ctx, pool, outgoingMem, "NATIONAL_ADMIN") != 0 {
		t.Fatal("outgoing incumbent kept the role (lingering access)")
	}
	// The defeated candidate never gets the role.
	if roleCount(t, ctx, pool, candBMem, "NATIONAL_ADMIN") != 0 {
		t.Fatal("losing candidate was granted the role")
	}
	// Audited + timestamped.
	var auditN int
	pool.QueryRow(ctx, `SELECT count(*) FROM assoc_audit_log WHERE action='ROLE_HANDOVER' AND subject_type='election_position'`).Scan(&auditN)
	if auditN < 1 {
		t.Fatal("no ROLE_HANDOVER audit row")
	}
	var handoverAt *string
	pool.QueryRow(ctx, `SELECT handover_at::text FROM assoc_elections WHERE id=$1`, electionID).Scan(&handoverAt)
	if handoverAt == nil {
		t.Fatal("handover_at not set")
	}
}

func TestLiveDB_Handover_ExactlyOnce(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	_, officer, electionID, candAMem, _ := buildPublishedRoleElection(t, ctx, pool, svc)

	if _, err := svc.HandoverElection(ctx, officer, electionID); err != nil {
		t.Fatalf("first handover: %v", err)
	}
	// Second handover is rejected and grants nothing new.
	if _, err := svc.HandoverElection(ctx, officer, electionID); err == nil {
		t.Fatal("second handover must be rejected (exactly-once)")
	}
	if got := roleCount(t, ctx, pool, candAMem, "NATIONAL_ADMIN"); got != 1 {
		t.Fatalf("winner role count = %d after double handover, want exactly 1", got)
	}
}

func TestLiveDB_Handover_Authz_And_State(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	org, officer, electionID, candAMem, _ := buildPublishedRoleElection(t, ctx, pool, svc)

	// Plain member cannot hand over.
	plain, _ := seedActiveMembership(t, ctx, pool, org)
	if _, err := svc.HandoverElection(ctx, plain, electionID); err == nil {
		t.Fatal("plain member ran handover (want forbidden)")
	}
	// A non-senior officer (SECRETARY) cannot hand over admin roles.
	secretary := seedAdminRole(t, ctx, pool, org, "SECRETARY")
	if _, err := svc.HandoverElection(ctx, secretary, electionID); err == nil {
		t.Fatal("secretary ran handover (want forbidden)")
	}
	// A senior officer of a DIFFERENT org cannot hand over this election.
	otherOrg := seedOrganisation(t, ctx, pool, "OtherHO "+uuid.New().String())
	foreign := seedAdminRole(t, ctx, pool, otherOrg, "NATIONAL_ADMIN")
	if _, err := svc.HandoverElection(ctx, foreign, electionID); err == nil {
		t.Fatal("foreign-org senior officer ran handover (want forbidden)")
	}
	// None of the forbidden attempts granted the role.
	if roleCount(t, ctx, pool, candAMem, "NATIONAL_ADMIN") != 0 {
		t.Fatal("a forbidden handover still granted the role")
	}

	// Handover before PUBLISHED is rejected (state guard): build a VOTING election.
	f := buildOpenElection(t, ctx, pool, svc) // 1 position, no role, status VOTING
	if _, err := svc.HandoverElection(ctx, f.officer, f.electionID); err == nil {
		t.Fatal("handover on a non-published election was accepted (want state error)")
	}

	// The legitimate senior officer still succeeds.
	if _, err := svc.HandoverElection(ctx, officer, electionID); err != nil {
		t.Fatalf("legit handover failed: %v", err)
	}
	if roleCount(t, ctx, pool, candAMem, "NATIONAL_ADMIN") != 1 {
		t.Fatal("winner not granted after legit handover")
	}
}
