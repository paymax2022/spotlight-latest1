package association_test

// ---------------------------------------------------------------------------
// LIVE-DB coverage for three election guards that election_integrity_test.go
// (TS-13 / §4, "release-blocking invariants") documents by code-reading but
// never actually exercises: PublishResults's CLOSED-only precondition,
// CastVote's invalid-ballot rejection (wrong position, non-approved
// candidate), and AddCandidate's officer-only authorization. All three were
// already correctly implemented when checked during a comprehensive
// association-module UAT pass — this closes the "documented but unverified"
// gap the same way TestLiveDB_IDOR_* files do elsewhere in this package,
// rather than assuming code-reading is equivalent to proof.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/association"
)

func TestLiveDB_PublishResults_RejectedBeforeClose(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()
	f := buildOpenElection(t, ctx, pool, svc)

	// Election is VOTING (opened, never closed). Publish must be rejected.
	if _, err := svc.PublishResults(ctx, f.officer, f.electionID); err == nil {
		t.Fatal("PublishResults on a still-VOTING election returned nil error, want rejection")
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM assoc_elections WHERE id=$1`, f.electionID).Scan(&status); err != nil {
		t.Fatalf("read election status: %v", err)
	}
	if status != "VOTING" {
		t.Fatalf("election status = %s after rejected publish, want unchanged VOTING", status)
	}
	var resultRows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_election_results WHERE election_id=$1`, f.electionID).Scan(&resultRows); err != nil {
		t.Fatalf("count results: %v", err)
	}
	if resultRows != 0 {
		t.Fatalf("results table has %d rows after a rejected publish, want 0", resultRows)
	}

	// Now close it and confirm publish succeeds — proves the rejection above
	// was really about state, not some unrelated failure.
	if err := svc.CloseElection(ctx, f.officer, f.electionID); err != nil {
		t.Fatalf("CloseElection: %v", err)
	}
	if _, err := svc.PublishResults(ctx, f.officer, f.electionID); err != nil {
		t.Fatalf("PublishResults after close: %v", err)
	}
}

func TestLiveDB_CastVote_RejectsInvalidBallots(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()
	f := buildOpenElection(t, ctx, pool, svc)
	voter, _ := seedActiveMembership(t, ctx, pool, f.org)

	// A second, unrelated election's position — the candidate doesn't belong
	// to f's election at all.
	other := buildOpenElection(t, ctx, pool, svc)

	if _, err := svc.CastVote(ctx, voter, f.electionID, association.CastVoteInput{PositionID: other.positionID, CandidateID: f.candA}); err == nil {
		t.Error("CastVote with a position from a different election returned nil error, want ErrInvalidBallot")
	}
	if _, err := svc.CastVote(ctx, voter, f.electionID, association.CastVoteInput{PositionID: f.positionID, CandidateID: other.candA}); err == nil {
		t.Error("CastVote with a candidate from a different election returned nil error, want ErrInvalidBallot")
	}

	// A candidate withdrawn after being added — no longer a legal ballot choice.
	if _, err := pool.Exec(ctx, `UPDATE assoc_election_candidates SET status='WITHDRAWN' WHERE id=$1`, f.candB); err != nil {
		t.Fatalf("withdraw candidate: %v", err)
	}
	if _, err := svc.CastVote(ctx, voter, f.electionID, association.CastVoteInput{PositionID: f.positionID, CandidateID: f.candB}); err == nil {
		t.Error("CastVote for a WITHDRAWN candidate returned nil error, want rejection")
	}

	// No ballot must have been recorded by any of the three rejected attempts.
	var ballots int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_election_ballots_cast WHERE election_id=$1`, f.electionID).Scan(&ballots); err != nil {
		t.Fatalf("count ballots: %v", err)
	}
	if ballots != 0 {
		t.Fatalf("ballots cast = %d after three rejected attempts, want 0", ballots)
	}

	// A legitimate vote for the still-APPROVED candidate still works.
	if _, err := svc.CastVote(ctx, voter, f.electionID, association.CastVoteInput{PositionID: f.positionID, CandidateID: f.candA}); err != nil {
		t.Fatalf("CastVote for the valid, approved candidate: %v (want success)", err)
	}
}

func TestLiveDB_AddCandidate_OfficerOnly(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()
	f := buildOpenElection(t, ctx, pool, svc)

	plainMember, candMembershipID := seedActiveMembership(t, ctx, pool, f.org)
	if _, err := svc.AddCandidate(ctx, plainMember, f.electionID, association.AddCandidateInput{
		PositionID: f.positionID, MembershipID: candMembershipID, Manifesto: "Self-nominated.",
	}); err == nil {
		t.Fatal("AddCandidate by a plain (non-officer) member returned nil error, want rejection")
	}

	// Also: an officer of a DIFFERENT org can't add a candidate here either.
	otherOrgOfficer := seedAdminRole(t, ctx, pool, seedOrganisation(t, ctx, pool, "Other Org "+uuid.New().String()), "NATIONAL_ADMIN")
	if _, err := svc.AddCandidate(ctx, otherOrgOfficer, f.electionID, association.AddCandidateInput{
		PositionID: f.positionID, MembershipID: candMembershipID, Manifesto: "Cross-org.",
	}); err == nil {
		t.Fatal("AddCandidate by a different org's officer returned nil error, want rejection")
	}

	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_election_candidates WHERE election_id=$1 AND membership_id=$2`, f.electionID, candMembershipID).Scan(&count); err != nil {
		t.Fatalf("count candidates: %v", err)
	}
	if count != 0 {
		t.Fatalf("candidate row exists after two rejected AddCandidate attempts, want 0")
	}

	// The actual election officer can still add them.
	if _, err := svc.AddCandidate(ctx, f.officer, f.electionID, association.AddCandidateInput{
		PositionID: f.positionID, MembershipID: candMembershipID, Manifesto: "Legit nomination.",
	}); err != nil {
		t.Fatalf("AddCandidate by the real officer: %v (want success)", err)
	}
}
