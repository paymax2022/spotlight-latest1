package association_test

// Association election integrity (TS-13 / §4). Live-DB. Proves the release-blocking
// invariants: one-member-one-vote (incl. concurrency), ballot secrecy by
// construction, fail-closed eligibility + voting window, correct/reproducible/
// tamper-evident tally, immutable published results, and officer-only authz.

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/association"
)

func execE(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(ctx, sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

type electionFix struct {
	org        string
	officer    string
	electionID string
	positionID string
	candA      string
	candB      string
}

// buildOpenElection sets up an org with an officer, a 1-seat position with two
// candidates, and opens it for voting. Returns the ids.
func buildOpenElection(t *testing.T, ctx context.Context, pool *pgxpool.Pool, svc *association.Service) electionFix {
	t.Helper()
	org := seedOrganisation(t, ctx, pool, "ElecOrg "+uuid.New().String())
	officer := seedAdminRole(t, ctx, pool, org, "NATIONAL_ADMIN")
	_, candMembA := seedActiveMembership(t, ctx, pool, org)
	_, candMembB := seedActiveMembership(t, ctx, pool, org)

	electionID, err := svc.CreateElection(ctx, officer, "", association.CreateElectionInput{
		Title:     "Exco Election",
		Positions: []association.CreatePositionInput{{Title: "Chairperson", Seats: 1}},
	})
	if err != nil {
		t.Fatalf("CreateElection: %v", err)
	}
	var positionID string
	if err := pool.QueryRow(ctx, `SELECT id FROM assoc_election_positions WHERE election_id=$1`, electionID).Scan(&positionID); err != nil {
		t.Fatalf("read position: %v", err)
	}
	candA, err := svc.AddCandidate(ctx, officer, electionID, association.AddCandidateInput{PositionID: positionID, MembershipID: candMembA, Manifesto: "Transparency."})
	if err != nil {
		t.Fatalf("AddCandidate A: %v", err)
	}
	candB, err := svc.AddCandidate(ctx, officer, electionID, association.AddCandidateInput{PositionID: positionID, MembershipID: candMembB, Manifesto: "Solar power."})
	if err != nil {
		t.Fatalf("AddCandidate B: %v", err)
	}
	if err := svc.OpenElection(ctx, officer, electionID); err != nil {
		t.Fatalf("OpenElection: %v", err)
	}
	return electionFix{org: org, officer: officer, electionID: electionID, positionID: positionID, candA: candA, candB: candB}
}

func TestLiveDB_Election_FullFlow_TallyWinnerImmutableResults(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()
	f := buildOpenElection(t, ctx, pool, svc)

	// Three eligible voters: A, A, B  →  candA wins 2–1.
	v1, _ := seedActiveMembership(t, ctx, pool, f.org)
	v2, _ := seedActiveMembership(t, ctx, pool, f.org)
	v3, _ := seedActiveMembership(t, ctx, pool, f.org)
	for _, cast := range []struct{ voter, cand string }{{v1, f.candA}, {v2, f.candA}, {v3, f.candB}} {
		if _, err := svc.CastVote(ctx, cast.voter, f.electionID, association.CastVoteInput{PositionID: f.positionID, CandidateID: cast.cand}); err != nil {
			t.Fatalf("CastVote: %v", err)
		}
	}

	// Live tally (officer): 2 / 1, ballotsCast 3.
	tally, err := svc.Tally(ctx, f.officer, f.electionID)
	if err != nil {
		t.Fatalf("Tally: %v", err)
	}
	if len(tally) != 1 || tally[0].BallotsCast != 3 {
		t.Fatalf("tally shape wrong: %+v", tally)
	}
	got := map[string]int{}
	for _, r := range tally[0].Results {
		got[r.CandidateID] = r.Votes
	}
	if got[f.candA] != 2 || got[f.candB] != 1 {
		t.Fatalf("tally counts wrong: A=%d B=%d (want 2/1)", got[f.candA], got[f.candB])
	}
	sum := got[f.candA] + got[f.candB]
	if sum != tally[0].BallotsCast {
		t.Fatalf("tamper check: sum(votes)=%d != ballotsCast=%d", sum, tally[0].BallotsCast)
	}

	// Close + publish → immutable snapshot with the winner flagged.
	if err := svc.CloseElection(ctx, f.officer, f.electionID); err != nil {
		t.Fatalf("CloseElection: %v", err)
	}
	results, err := svc.PublishResults(ctx, f.officer, f.electionID)
	if err != nil {
		t.Fatalf("PublishResults: %v", err)
	}
	var winner string
	for _, r := range results[0].Results {
		if r.IsWinner {
			winner = r.CandidateID
		}
	}
	if winner != f.candA {
		t.Fatalf("winner = %s, want candA", winner)
	}
	if results[0].Checksum == "" {
		t.Fatal("published result missing checksum")
	}

	// Immutability: republishing is rejected, and the snapshot rows persist.
	if _, err := svc.PublishResults(ctx, f.officer, f.electionID); err == nil {
		t.Fatal("re-publish must be rejected (immutable results)")
	}
	var resultRows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_election_results WHERE election_id=$1`, f.electionID).Scan(&resultRows); err != nil {
		t.Fatalf("count results: %v", err)
	}
	if resultRows != 2 {
		t.Fatalf("result rows = %d, want 2", resultRows)
	}

	// Voter view exposes results only after publish.
	det, err := svc.GetElection(ctx, v1, f.electionID)
	if err != nil {
		t.Fatalf("GetElection: %v", err)
	}
	if det.Status != "PUBLISHED" || len(det.Results) != 1 {
		t.Fatalf("published election detail missing results: status=%s results=%d", det.Status, len(det.Results))
	}
}

func TestLiveDB_Election_OneMemberOneVote_Idempotent(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()
	f := buildOpenElection(t, ctx, pool, svc)
	voter, voterMembership := seedActiveMembership(t, ctx, pool, f.org)

	first, err := svc.CastVote(ctx, voter, f.electionID, association.CastVoteInput{PositionID: f.positionID, CandidateID: f.candA})
	if err != nil {
		t.Fatalf("first vote: %v", err)
	}
	if first.AlreadyCast {
		t.Fatal("first vote wrongly reported AlreadyCast")
	}
	// Attempt to change the vote → idempotent, same receipt, NOT counted.
	second, err := svc.CastVote(ctx, voter, f.electionID, association.CastVoteInput{PositionID: f.positionID, CandidateID: f.candB})
	if err != nil {
		t.Fatalf("second vote: %v", err)
	}
	if !second.AlreadyCast || second.Receipt != first.Receipt {
		t.Fatalf("second vote not idempotent: alreadyCast=%v receiptMatch=%v", second.AlreadyCast, second.Receipt == first.Receipt)
	}
	var casts, votes, forB int
	pool.QueryRow(ctx, `SELECT count(*) FROM assoc_election_ballots_cast WHERE position_id=$1 AND voter_membership_id=$2`, f.positionID, voterMembership).Scan(&casts)
	pool.QueryRow(ctx, `SELECT count(*) FROM assoc_election_votes WHERE position_id=$1`, f.positionID).Scan(&votes)
	pool.QueryRow(ctx, `SELECT count(*) FROM assoc_election_votes WHERE candidate_id=$1`, f.candB).Scan(&forB)
	if casts != 1 || votes != 1 || forB != 0 {
		t.Fatalf("double vote leaked: casts=%d votes=%d forB=%d (want 1/1/0)", casts, votes, forB)
	}
}

func TestLiveDB_Election_ConcurrentDoubleVote_ExactlyOne(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()
	f := buildOpenElection(t, ctx, pool, svc)
	voter, _ := seedActiveMembership(t, ctx, pool, f.org)

	const N = 8
	var wg sync.WaitGroup
	for i := 0; i < N; i++ {
		wg.Add(1)
		cand := f.candA
		if i%2 == 1 {
			cand = f.candB
		}
		go func(c string) {
			defer wg.Done()
			_, _ = svc.CastVote(ctx, voter, f.electionID, association.CastVoteInput{PositionID: f.positionID, CandidateID: c})
		}(cand)
	}
	wg.Wait()

	var casts, votes int
	pool.QueryRow(ctx, `SELECT count(*) FROM assoc_election_ballots_cast WHERE election_id=$1 AND position_id=$2`, f.electionID, f.positionID).Scan(&casts)
	pool.QueryRow(ctx, `SELECT count(*) FROM assoc_election_votes WHERE election_id=$1 AND position_id=$2`, f.electionID, f.positionID).Scan(&votes)
	if casts != 1 || votes != 1 {
		t.Fatalf("concurrency leaked votes: casts=%d votes=%d (want exactly 1/1)", casts, votes)
	}
}

func TestLiveDB_Election_BallotSecrecy_NoVoterChoiceLink(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()

	// The anonymous-choice table must have NO voter/membership reference, and the
	// turnout table must have NO candidate/choice reference — so no SQL can join a
	// voter to their choice (EL-008 / EC-004).
	var voterColsInVotes int
	pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_name='assoc_election_votes' AND (column_name LIKE '%voter%' OR column_name LIKE '%member%' OR column_name LIKE '%user%')`).Scan(&voterColsInVotes)
	if voterColsInVotes != 0 {
		t.Fatalf("ballot secrecy broken: assoc_election_votes has a voter-linking column (%d)", voterColsInVotes)
	}
	var choiceColsInCast int
	pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_name='assoc_election_ballots_cast' AND (column_name LIKE '%candidate%' OR column_name LIKE '%choice%' OR column_name LIKE '%vote_for%')`).Scan(&choiceColsInCast)
	if choiceColsInCast != 0 {
		t.Fatalf("ballot secrecy broken: assoc_election_ballots_cast records the choice (%d)", choiceColsInCast)
	}
	// And votes must carry no timestamp that could correlate with a cast time.
	var tsColsInVotes int
	pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_name='assoc_election_votes' AND data_type LIKE 'timestamp%'`).Scan(&tsColsInVotes)
	if tsColsInVotes != 0 {
		t.Fatalf("ballot secrecy weakened: assoc_election_votes has a timestamp column (%d)", tsColsInVotes)
	}
}

func TestLiveDB_Election_Eligibility_FailClosed(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()
	f := buildOpenElection(t, ctx, pool, svc)

	// Non-member (belongs to a different org).
	otherOrg := seedOrganisation(t, ctx, pool, "Other "+uuid.New().String())
	outsider, _ := seedActiveMembership(t, ctx, pool, otherOrg)
	if _, err := svc.CastVote(ctx, outsider, f.electionID, association.CastVoteInput{PositionID: f.positionID, CandidateID: f.candA}); err == nil {
		t.Fatal("non-member voted (want ineligible)")
	}
	// Arrears (OVERDUE) member.
	arrears, arrearsM := seedActiveMembership(t, ctx, pool, f.org)
	execE(t, ctx, pool, `UPDATE assoc_memberships SET payment_standing='OVERDUE' WHERE id=$1`, arrearsM)
	if _, err := svc.CastVote(ctx, arrears, f.electionID, association.CastVoteInput{PositionID: f.positionID, CandidateID: f.candA}); err == nil {
		t.Fatal("arrears member voted (want ineligible)")
	}
	// Suspended member.
	susp, suspM := seedActiveMembership(t, ctx, pool, f.org)
	execE(t, ctx, pool, `UPDATE assoc_memberships SET status='SUSPENDED' WHERE id=$1`, suspM)
	if _, err := svc.CastVote(ctx, susp, f.electionID, association.CastVoteInput{PositionID: f.positionID, CandidateID: f.candA}); err == nil {
		t.Fatal("suspended member voted (want ineligible)")
	}
	// No stray ballots were recorded.
	var casts int
	pool.QueryRow(ctx, `SELECT count(*) FROM assoc_election_ballots_cast WHERE election_id=$1`, f.electionID).Scan(&casts)
	if casts != 0 {
		t.Fatalf("ineligible attempts recorded %d ballots (want 0)", casts)
	}
}

func TestLiveDB_Election_VotingWindow_FailClosed(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	org := seedOrganisation(t, ctx, pool, "WinOrg "+uuid.New().String())
	officer := seedAdminRole(t, ctx, pool, org, "NATIONAL_ADMIN")
	_, candM := seedActiveMembership(t, ctx, pool, org)
	electionID, err := svc.CreateElection(ctx, officer, "", association.CreateElectionInput{
		Title: "Windowed", Positions: []association.CreatePositionInput{{Title: "Sec", Seats: 1}},
	})
	if err != nil {
		t.Fatalf("CreateElection: %v", err)
	}
	var pid string
	pool.QueryRow(ctx, `SELECT id FROM assoc_election_positions WHERE election_id=$1`, electionID).Scan(&pid)
	cand, _ := svc.AddCandidate(ctx, officer, electionID, association.AddCandidateInput{PositionID: pid, MembershipID: candM})
	voter, _ := seedActiveMembership(t, ctx, pool, org)

	// DRAFT (not opened) → voting closed.
	if _, err := svc.CastVote(ctx, voter, electionID, association.CastVoteInput{PositionID: pid, CandidateID: cand}); err == nil {
		t.Fatal("vote accepted while election is DRAFT (want closed)")
	}
	// Opened but window already elapsed → closed.
	if err := svc.OpenElection(ctx, officer, electionID); err != nil {
		t.Fatalf("OpenElection: %v", err)
	}
	execE(t, ctx, pool, `UPDATE assoc_elections SET voting_closes_at = now() - interval '1 hour' WHERE id=$1`, electionID)
	if _, err := svc.CastVote(ctx, voter, electionID, association.CastVoteInput{PositionID: pid, CandidateID: cand}); err == nil {
		t.Fatal("vote accepted after window closed (want closed)")
	}
	// Closed election → closed.
	execE(t, ctx, pool, `UPDATE assoc_elections SET voting_closes_at = NULL, status='CLOSED' WHERE id=$1`, electionID)
	if _, err := svc.CastVote(ctx, voter, electionID, association.CastVoteInput{PositionID: pid, CandidateID: cand}); err == nil {
		t.Fatal("vote accepted while CLOSED (want closed)")
	}
}

func TestLiveDB_Election_OfficerOnly_Authz(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()
	f := buildOpenElection(t, ctx, pool, svc)

	// Plain member of the org cannot administer.
	plain, _ := seedActiveMembership(t, ctx, pool, f.org)
	if _, err := svc.CreateElection(ctx, plain, "", association.CreateElectionInput{Title: "X", Positions: []association.CreatePositionInput{{Title: "P"}}}); err == nil {
		t.Fatal("plain member created an election (want forbidden)")
	}
	if _, err := svc.Tally(ctx, plain, f.electionID); err == nil {
		t.Fatal("plain member read the live tally (want forbidden)")
	}
	if err := svc.CloseElection(ctx, plain, f.electionID); err == nil {
		t.Fatal("plain member closed the election (want forbidden)")
	}
	// Admin of a DIFFERENT org cannot administer this election.
	otherOrg := seedOrganisation(t, ctx, pool, "OtherAdminOrg "+uuid.New().String())
	foreignOfficer := seedAdminRole(t, ctx, pool, otherOrg, "NATIONAL_ADMIN")
	if err := svc.CloseElection(ctx, foreignOfficer, f.electionID); err == nil {
		t.Fatal("foreign-org officer closed this election (want forbidden)")
	}
	if _, err := svc.Tally(ctx, foreignOfficer, f.electionID); err == nil {
		t.Fatal("foreign-org officer read this tally (want forbidden)")
	}
}
