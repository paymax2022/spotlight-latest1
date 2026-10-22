package association_test

// ---------------------------------------------------------------------------
// LIVE-DB coverage for multi-position elections, added during a
// comprehensive association-module UAT pass. Every existing election_*
// fixture (buildOpenElection, and every hand-built one in
// election_integrity_test.go) uses exactly one position, so nothing ever
// exercised the actual multi-position case: a voter voting on one position
// but not another, the same voter voting on BOTH positions in one election,
// and the one-vote-per-position uniqueness constraint holding independently
// per position rather than per election. Reading CastVote's own ballot key
// (UNIQUE on (election_id, position_id, voter_membership_id) — position IS
// part of the key) suggested this already works; this proves it.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/association"
)

func TestLiveDB_Election_MultiPosition_IndependentVotesAndTally(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	org := seedOrganisation(t, ctx, pool, "MultiPos Election "+uuid.New().String())
	officer := seedAdminRole(t, ctx, pool, org, "NATIONAL_ADMIN")
	_, chairA := seedActiveMembership(t, ctx, pool, org)
	_, chairB := seedActiveMembership(t, ctx, pool, org)
	_, secA := seedActiveMembership(t, ctx, pool, org)
	_, secB := seedActiveMembership(t, ctx, pool, org)

	electionID, err := svc.CreateElection(ctx, officer, "", association.CreateElectionInput{
		Title: "Full Exco Election",
		Positions: []association.CreatePositionInput{
			{Title: "Chairperson", Seats: 1},
			{Title: "Secretary", Seats: 1},
		},
	})
	if err != nil {
		t.Fatalf("CreateElection: %v", err)
	}
	rows, err := pool.Query(ctx, `SELECT id, title FROM assoc_election_positions WHERE election_id=$1`, electionID)
	if err != nil {
		t.Fatalf("read positions: %v", err)
	}
	positions := map[string]string{} // title -> id
	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			t.Fatalf("scan position: %v", err)
		}
		positions[title] = id
	}
	rows.Close()
	if len(positions) != 2 {
		t.Fatalf("created election has %d positions, want 2", len(positions))
	}
	chairPos, secPos := positions["Chairperson"], positions["Secretary"]

	chairCandA, err := svc.AddCandidate(ctx, officer, electionID, association.AddCandidateInput{PositionID: chairPos, MembershipID: chairA, Manifesto: "Chair A."})
	if err != nil {
		t.Fatalf("add chair candidate A: %v", err)
	}
	if _, err := svc.AddCandidate(ctx, officer, electionID, association.AddCandidateInput{PositionID: chairPos, MembershipID: chairB, Manifesto: "Chair B."}); err != nil {
		t.Fatalf("add chair candidate B: %v", err)
	}
	secCandA, err := svc.AddCandidate(ctx, officer, electionID, association.AddCandidateInput{PositionID: secPos, MembershipID: secA, Manifesto: "Sec A."})
	if err != nil {
		t.Fatalf("add secretary candidate A: %v", err)
	}
	if _, err := svc.AddCandidate(ctx, officer, electionID, association.AddCandidateInput{PositionID: secPos, MembershipID: secB, Manifesto: "Sec B."}); err != nil {
		t.Fatalf("add secretary candidate B: %v", err)
	}
	if err := svc.OpenElection(ctx, officer, electionID); err != nil {
		t.Fatalf("OpenElection: %v", err)
	}

	voter1, _ := seedActiveMembership(t, ctx, pool, org)
	voter2, _ := seedActiveMembership(t, ctx, pool, org)

	// voter1 votes on BOTH positions in the same election.
	if _, err := svc.CastVote(ctx, voter1, electionID, association.CastVoteInput{PositionID: chairPos, CandidateID: chairCandA}); err != nil {
		t.Fatalf("voter1 vote chair: %v", err)
	}
	if _, err := svc.CastVote(ctx, voter1, electionID, association.CastVoteInput{PositionID: secPos, CandidateID: secCandA}); err != nil {
		t.Fatalf("voter1 vote secretary: %v (a vote on one position must not block voting on another)", err)
	}
	// voter2 votes on the CHAIR position only — abstaining on secretary must be
	// allowed, not forced.
	if _, err := svc.CastVote(ctx, voter2, electionID, association.CastVoteInput{PositionID: chairPos, CandidateID: chairCandA}); err != nil {
		t.Fatalf("voter2 vote chair: %v", err)
	}

	// voter1 tries to vote AGAIN on chair — must be idempotent (already-cast
	// receipt), not a second ballot, and must not affect their secretary vote.
	receipt, err := svc.CastVote(ctx, voter1, electionID, association.CastVoteInput{PositionID: chairPos, CandidateID: chairCandA})
	if err != nil {
		t.Fatalf("voter1 re-vote chair: %v", err)
	}
	if !receipt.AlreadyCast {
		t.Error("voter1's second chair vote was not reported as AlreadyCast")
	}

	tally, err := svc.Tally(ctx, officer, electionID)
	if err != nil {
		t.Fatalf("Tally: %v", err)
	}
	if len(tally) != 2 {
		t.Fatalf("tally has %d positions, want 2", len(tally))
	}
	for _, p := range tally {
		switch p.PositionID {
		case chairPos:
			if p.BallotsCast != 2 {
				t.Errorf("chair ballots cast = %d, want 2 (voter1 once + voter2 once, re-vote must not double-count)", p.BallotsCast)
			}
		case secPos:
			if p.BallotsCast != 1 {
				t.Errorf("secretary ballots cast = %d, want 1 (only voter1 voted; voter2 abstained)", p.BallotsCast)
			}
		default:
			t.Errorf("unexpected position id in tally: %s", p.PositionID)
		}
	}
}
