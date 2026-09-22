package voting_test

// D-010: the Connect free-vote engine's cap check ("has this voter already
// used their free vote(s) in this contest?") and the vote insert used to be
// two separate statements — CountFreeVotes then InsertVote — so two
// concurrent free-vote requests from the SAME voter could both read a count
// below the cap before either had inserted, and both got voted. This test
// proves the fix (Repository.ClaimFreeVote, a single transaction serialized
// by an advisory lock per (contest, voter)) actually closes that window,
// the same way the sibling engines' D-002/PV-005 fixes were proven here —
// by firing genuinely concurrent goroutines at a real Postgres instance and
// checking what actually landed, not by asserting a mock was called.

import (
	"context"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	connectvoting "spotlight/backend/internal/connect/voting"
)

// runConcurrentFreeVoteClaims fires n goroutines at ClaimFreeVote for the same
// (contest, voter), each targeting its own contestant option, and returns how
// many actually got granted a vote.
func runConcurrentFreeVoteClaims(t *testing.T, ctx context.Context, pool *pgxpool.Pool,
	contestID, voterID string, allowance, n int, optionRef func(i int) string) int {
	t.Helper()

	repo := connectvoting.NewRepository(pool)

	var wg sync.WaitGroup
	var mu sync.Mutex
	granted := 0

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, ok, err := repo.ClaimFreeVote(ctx, &connectvoting.Vote{
				ContestID: contestID,
				VoterID:   voterID,
				OptionRef: optionRef(i),
				Paid:      false,
				Quantity:  1,
			}, allowance)
			if err != nil {
				t.Errorf("claim %d: unexpected error: %v", i, err)
				return
			}
			if ok {
				mu.Lock()
				granted++
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	return granted
}

// TestClaimFreeVote_ConcurrencyRespectsCapOfOne is the default-allowance case
// (FreeVotesPerUser=0 -> allowance defaults to 1 in the service layer; here we
// test the repository directly against an explicit allowance of 1, which is
// the value FreeVote() would pass through in that default case).
func TestClaimFreeVote_ConcurrencyRespectsCapOfOne(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()

	contest := newContest(t, ctx, pool, contestOpts{status: "open", freeVotes: 1})
	contestant := newContestant(t, ctx, pool, contest)
	voter := anyVoter(t, ctx, pool)

	const attempts = 20
	granted := runConcurrentFreeVoteClaims(t, ctx, pool, contest, voter, 1, attempts,
		func(int) string { return contestant })

	if granted != 1 {
		t.Fatalf("expected exactly 1 granted claim out of %d concurrent attempts, got %d", attempts, granted)
	}

	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM connect_votes WHERE contest_id = $1 AND voter_id = $2 AND paid = false`,
		contest, voter).Scan(&rows); err != nil {
		t.Fatalf("count votes: %v", err)
	}
	if rows != 1 {
		t.Fatalf("expected exactly 1 connect_votes row, found %d — the cap was bypassed", rows)
	}
}

// TestClaimFreeVote_ConcurrencyRespectsCapAboveOne proves the fix also holds
// when a contest allows more than one free vote per voter (FreeVotesPerUser
// > 1) — the cap is "at most N", not "at most 1", and a naive fix (e.g. a
// bare UNIQUE(contest_id, voter_id) constraint) would have broken this case
// even though it would have looked correct for the cap-of-1 test above.
func TestClaimFreeVote_ConcurrencyRespectsCapAboveOne(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()

	const allowance = 3
	contest := newContest(t, ctx, pool, contestOpts{status: "open", freeVotes: allowance})
	contestant := newContestant(t, ctx, pool, contest)
	voter := anyVoter(t, ctx, pool)

	const attempts = 20
	granted := runConcurrentFreeVoteClaims(t, ctx, pool, contest, voter, allowance, attempts,
		func(int) string { return contestant })

	if granted != allowance {
		t.Fatalf("expected exactly %d granted claims out of %d concurrent attempts, got %d", allowance, attempts, granted)
	}

	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM connect_votes WHERE contest_id = $1 AND voter_id = $2 AND paid = false`,
		contest, voter).Scan(&rows); err != nil {
		t.Fatalf("count votes: %v", err)
	}
	if rows != allowance {
		t.Fatalf("expected exactly %d connect_votes rows, found %d — the cap was bypassed", allowance, rows)
	}
}

// TestClaimFreeVote_CapIsPerVoterNotPerContestant proves the cap is scoped to
// (contest, voter) regardless of which contestant each attempt targets —
// matching CountFreeVotes' original semantics (COUNT(*) WHERE contest_id=...
// AND voter_id=..., no option_ref filter). A voter spreading concurrent
// claims across many contestants must still be capped at their contest-wide
// allowance, not get one free vote per contestant they target.
func TestClaimFreeVote_CapIsPerVoterNotPerContestant(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()

	contest := newContest(t, ctx, pool, contestOpts{status: "open", freeVotes: 1})
	voter := anyVoter(t, ctx, pool)

	const attempts = 10
	contestants := make([]string, attempts)
	for i := range contestants {
		contestants[i] = newContestant(t, ctx, pool, contest)
	}

	granted := runConcurrentFreeVoteClaims(t, ctx, pool, contest, voter, 1, attempts,
		func(i int) string { return contestants[i] })

	if granted != 1 {
		t.Fatalf("expected exactly 1 granted claim across %d different contestants, got %d", attempts, granted)
	}
}
