package voting_test

// UAT Batch 3 — TS-11 NF-001 (Voting surge at poll close).
//
// D-010, D-002/D-003 and PV-005 each closed a specific race in one of the
// three voting rails (Go Connect's ClaimFreeVote, the TS bridge's
// claim_free_vote RPC, and the TS bridge's credit_paid_vote_transaction RPC)
// by proving correctness at ~20 concurrent goroutines against a real local
// Postgres. NF-001 asks for something bigger: does the SAME guarantee still
// hold at a scale closer to a real poll-close surge, across all three rails,
// including many DIFFERENT voters hitting the SAME contest/contestant at
// once (the actual "viral contest" shape), not just one voter retrying?
//
// HONESTY NOTE (see docs/qa/voting-contest-test-plan.md NF-001 status): this
// is 100-200 concurrent goroutines against a local Supabase Postgres on one
// laptop. It is real evidence that the locking design (row locks / advisory
// locks scoped correctly) does not fall over under genuine concurrency and
// does not lose or duplicate a single vote at this scale. It is NOT a
// production-scale load test — no k6/JMeter, no thousands of req/s, no
// staging network, no HTTP/API layer, no connection-pool exhaustion at prod
// concurrency. That requires load-test infrastructure this environment does
// not have.

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	connectvoting "spotlight/backend/internal/connect/voting"
)

// manyVoters borrows N distinct existing auth.users rows (oldest first, so the
// result is stable across runs). Local dev Postgres has 10k+ seeded users, so
// this comfortably covers the scale used here without seeding new fixture
// users (which would spray rows across three RBAC/profile triggers — see
// anyVoter's doc comment in fixtures_test.go).
func manyVoters(t *testing.T, ctx context.Context, pool *pgxpool.Pool, n int) []string {
	t.Helper()
	rows, err := pool.Query(ctx, `SELECT id::text FROM auth.users ORDER BY created_at LIMIT $1`, n)
	if err != nil {
		t.Fatalf("borrow voters: %v", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan voter: %v", err)
		}
		out = append(out, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate voters: %v", err)
	}
	if len(out) < n {
		t.Fatalf("need %d distinct auth.users rows to borrow, only found %d", n, len(out))
	}
	return out
}

// ── Go Connect engine (ClaimFreeVote) ───────────────────────────────────────

// TestNF001_ClaimFreeVote_GoConnect_HighScaleSameVoter is the D-010 test at
// ~9x the scale (180 vs 20 concurrent attempts), same voter hammering the
// same cap.
func TestNF001_ClaimFreeVote_GoConnect_HighScaleSameVoter(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()

	const allowance = 5
	contest := newContest(t, ctx, pool, contestOpts{status: "open", freeVotes: allowance})
	contestant := newContestant(t, ctx, pool, contest)
	voter := anyVoter(t, ctx, pool)

	const attempts = 180
	granted := runConcurrentFreeVoteClaims(t, ctx, pool, contest, voter, allowance, attempts,
		func(int) string { return contestant })

	if granted != allowance {
		t.Fatalf("expected exactly %d granted claims out of %d concurrent attempts, got %d", allowance, attempts, granted)
	}
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM connect_votes WHERE contest_id=$1 AND voter_id=$2 AND paid=false`,
		contest, voter).Scan(&rows); err != nil {
		t.Fatalf("count votes: %v", err)
	}
	if rows != allowance {
		t.Fatalf("expected %d connect_votes rows, found %d — surge-scale cap was bypassed", allowance, rows)
	}
}

// TestNF001_ClaimFreeVote_GoConnect_ManyDistinctVoters is the realistic
// "viral contest at poll close" shape: 150 DIFFERENT voters, not one voter
// retrying, all casting their one free vote on the same contestant at the
// same instant. Proves no lost votes (every distinct voter's vote lands) and
// no duplicate/extra votes under real concurrent write pressure on the same
// contestant row.
func TestNF001_ClaimFreeVote_GoConnect_ManyDistinctVoters(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()

	const n = 150
	contest := newContest(t, ctx, pool, contestOpts{status: "open", freeVotes: 1})
	contestant := newContestant(t, ctx, pool, contest)
	voters := manyVoters(t, ctx, pool, n)
	repo := connectvoting.NewRepository(pool)

	var wg sync.WaitGroup
	var mu sync.Mutex
	granted := 0
	errs := 0
	for _, v := range voters {
		wg.Add(1)
		go func(voterID string) {
			defer wg.Done()
			_, ok, err := repo.ClaimFreeVote(ctx, &connectvoting.Vote{
				ContestID: contest,
				VoterID:   voterID,
				OptionRef: contestant,
				Paid:      false,
				Quantity:  1,
			}, 1)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs++
				t.Errorf("voter %s: unexpected error: %v", voterID, err)
				return
			}
			if ok {
				granted++
			}
		}(v)
	}
	wg.Wait()

	if errs != 0 {
		t.Fatalf("%d of %d distinct-voter claims errored", errs, n)
	}
	if granted != n {
		t.Fatalf("expected all %d distinct voters granted (no lost votes), got %d", n, granted)
	}
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM connect_votes WHERE contest_id=$1 AND option_ref=$2 AND paid=false`,
		contest, contestant).Scan(&rows); err != nil {
		t.Fatalf("count votes: %v", err)
	}
	if rows != n {
		t.Fatalf("expected exactly %d connect_votes rows (one per distinct voter), found %d", n, rows)
	}
}

// ── TS bridge engine (claim_free_vote / credit_paid_vote_transaction RPCs) ──
//
// These call the SAME Postgres functions the bridge's Supabase RPC calls
// invoke, directly via SQL — the pattern this package already uses (see
// fixtures_test.go's "WHY THIS PACKAGE EXISTS") because integration-verify's
// bare-Postgres CI lane has no PostgREST for supabase-js to speak to. The
// function bodies are schema, not application code; calling them directly is
// calling the real atomic unit under test, not a re-implementation of it.

type claimFreeVoteResult struct {
	granted   int
	totalUsed int
	cap       int
	voteID    *string
	status    *string
}

func callClaimFreeVote(ctx context.Context, pool *pgxpool.Pool, contestID, contestantID, voter string, cap int) (claimFreeVoteResult, error) {
	var r claimFreeVoteResult
	err := pool.QueryRow(ctx, `
		SELECT granted, total_used, cap, vote_id, vote_status
		FROM public.claim_free_vote(
			p_contest_id    => $1,
			p_contestant_id => $2,
			p_voter         => $3,
			p_voter_type    => 'user',
			p_vote_date     => CURRENT_DATE,
			p_cap           => $4,
			p_qty           => 1,
			p_voter_user_id => $5,
			p_source        => 'web'
		)`,
		contestID, contestantID, voter, cap, voter,
	).Scan(&r.granted, &r.totalUsed, &r.cap, &r.voteID, &r.status)
	return r, err
}

// TestNF001_ClaimFreeVote_TSBridge_HighScaleSameVoter is the bridge-side
// counterpart to the Go-engine high-scale test above: one voter, 180
// concurrent claim_free_vote calls, cap of 5.
func TestNF001_ClaimFreeVote_TSBridge_HighScaleSameVoter(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()

	// claim_free_vote's FK target (contests.id) is satisfied by the legacy row
	// the connect_contests mirror trigger creates with the SAME id — the same
	// pattern connect_tally_live_db_test.go's tallyFixture relies on.
	contestID := newContest(t, ctx, pool, contestOpts{status: "open"})
	contestantID := newContestant(t, ctx, pool, contestID)
	voter := anyVoter(t, ctx, pool)

	const cap = 5
	const attempts = 180

	var wg sync.WaitGroup
	var mu sync.Mutex
	granted := 0
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, err := callClaimFreeVote(ctx, pool, contestID, contestantID, voter, cap)
			if err != nil {
				t.Errorf("claim_free_vote: unexpected error: %v", err)
				return
			}
			mu.Lock()
			granted += r.granted
			mu.Unlock()
		}()
	}
	wg.Wait()

	if granted != cap {
		t.Fatalf("expected exactly %d free votes granted out of %d concurrent attempts, got %d", cap, attempts, granted)
	}
	var used int
	if err := pool.QueryRow(ctx,
		`SELECT free_votes_used FROM public.voter_contestant_daily_limits
		 WHERE contest_id=$1 AND contestant_id=$2 AND voter_identifier=$3 AND voter_identifier_type='user' AND vote_date=CURRENT_DATE`,
		contestID, contestantID, voter).Scan(&used); err != nil {
		t.Fatalf("read cap row: %v", err)
	}
	if used != cap {
		t.Fatalf("cap row shows %d used, want %d — surge-scale cap was bypassed", used, cap)
	}
}

// TestNF001_ClaimFreeVote_TSBridge_ManyDistinctVoters mirrors the Go-engine
// distinct-voters surge test for the bridge's RPC: 150 different voters,
// each entitled to exactly one free vote, all claiming at once.
func TestNF001_ClaimFreeVote_TSBridge_ManyDistinctVoters(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()

	const n = 150
	contestID := newContest(t, ctx, pool, contestOpts{status: "open"})
	contestantID := newContestant(t, ctx, pool, contestID)
	voters := manyVoters(t, ctx, pool, n)

	var wg sync.WaitGroup
	var mu sync.Mutex
	granted := 0
	errs := 0
	for _, v := range voters {
		wg.Add(1)
		go func(voterID string) {
			defer wg.Done()
			r, err := callClaimFreeVote(ctx, pool, contestID, contestantID, voterID, 1)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs++
				t.Errorf("voter %s: %v", voterID, err)
				return
			}
			granted += r.granted
		}(v)
	}
	wg.Wait()

	if errs != 0 {
		t.Fatalf("%d of %d distinct-voter claims errored", errs, n)
	}
	if granted != n {
		t.Fatalf("expected all %d distinct voters granted, got %d — lost votes under surge", n, granted)
	}
	var totalConfirmed int64
	if err := pool.QueryRow(ctx,
		`SELECT total_confirmed_votes FROM public.vote_totals WHERE contest_id=$1 AND contestant_id=$2 AND round_id IS NULL`,
		contestID, contestantID).Scan(&totalConfirmed); err != nil {
		t.Fatalf("read vote_totals: %v", err)
	}
	if totalConfirmed != int64(n) {
		t.Fatalf("vote_totals.total_confirmed_votes=%d, want %d — tally drifted from the vote log under surge", totalConfirmed, n)
	}
}

// TestNF001_CreditPaidVoteTransaction_ManyDistinctTransactions surges the
// paid-vote credit RPC with many DIFFERENT transactions all crediting the
// SAME contestant concurrently — the worst case for the shared vote_totals
// row, which credit_paid_vote_transaction serializes via an advisory lock
// (see 20270211000000_vote_bridge_paid_vote_atomic_credit.sql). Proves the
// totals upsert doesn't lose an update under concurrent write pressure.
func TestNF001_CreditPaidVoteTransaction_ManyDistinctTransactions(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()

	const n = 120
	contestID := newContest(t, ctx, pool, contestOpts{status: "open"})
	contestantID := newContestant(t, ctx, pool, contestID)
	voters := manyVoters(t, ctx, pool, n)

	type tx struct{ id, ref string }
	txs := make([]tx, n)
	for i, v := range voters {
		ref := fmt.Sprintf("zzgo-surge-ref-%d-%s", i, contestID[:8])
		var id string
		err := pool.QueryRow(ctx, `
			INSERT INTO public.vote_transactions (
				contest_id, contestant_id, voter_user_id, payment_provider, payment_reference,
				amount_expected, votes_purchased, bonus_votes, total_votes_to_credit,
				payment_status, vote_credit_status, voter_email, voter_name)
			VALUES ($1,$2,$3,'paystack',$4, 500.00, 5, 0, 5, 'successful', 'pending', 'zz@example.com', 'ZZ')
			RETURNING id::text`,
			contestID, contestantID, v, ref).Scan(&id)
		if err != nil {
			t.Fatalf("seed vote_transaction %d: %v", i, err)
		}
		t.Cleanup(func(id string) func() {
			return func() { _, _ = pool.Exec(context.Background(), `DELETE FROM public.vote_transactions WHERE id=$1`, id) }
		}(id))
		txs[i] = tx{id: id, ref: ref}
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	credited := 0
	errs := 0
	for _, tr := range txs {
		wg.Add(1)
		go func(id, ref string) {
			defer wg.Done()
			var alreadyCredited, refMismatch bool
			var voteID *string
			err := pool.QueryRow(ctx, `
				SELECT already_credited, reference_mismatch, vote_id
				FROM public.credit_paid_vote_transaction($1::uuid, $2, 500.00)`,
				id, ref).Scan(&alreadyCredited, &refMismatch, &voteID)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs++
				t.Errorf("tx %s: %v", id, err)
				return
			}
			if refMismatch {
				errs++
				t.Errorf("tx %s: unexpected reference_mismatch", id)
				return
			}
			if !alreadyCredited && voteID != nil {
				credited++
			}
		}(tr.id, tr.ref)
	}
	wg.Wait()

	if errs != 0 {
		t.Fatalf("%d of %d distinct-transaction credits errored", errs, n)
	}
	if credited != n {
		t.Fatalf("expected all %d distinct transactions credited, got %d — lost paid votes under surge", n, credited)
	}
	var paidVotes int64
	if err := pool.QueryRow(ctx,
		`SELECT paid_votes FROM public.vote_totals WHERE contest_id=$1 AND contestant_id=$2 AND round_id IS NULL`,
		contestID, contestantID).Scan(&paidVotes); err != nil {
		t.Fatalf("read vote_totals: %v", err)
	}
	if want := int64(n * 5); paidVotes != want {
		t.Fatalf("vote_totals.paid_votes=%d, want %d — a concurrent totals update was lost under surge", paidVotes, want)
	}
}
