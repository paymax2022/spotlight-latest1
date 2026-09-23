package voting_test

// UAT Batch 3 — TS-11 NF-004 (Service/DB failover without vote loss).
//
// HONESTY NOTE (see docs/qa/voting-contest-test-plan.md NF-004 status): true
// infra failover — killing the DB connection or the process mid-transaction —
// is not something this environment can safely simulate (no chaos-engineering
// harness, no ability to sever a live Postgres connection at an exact byte
// offset). What CAN be verified directly is the structural guarantee that
// makes failover safe IF it happens: claim_free_vote, credit_paid_vote_transaction
// and Repository.ClaimFreeVote each do their entire lock -> check -> write
// sequence inside ONE database transaction (a single PL/pgSQL function call,
// or a single explicit BEGIN...COMMIT in Go). Postgres guarantees that if a
// transaction never reaches COMMIT — whether because the connection dropped,
// the process crashed, or (as tested here) a later statement in the same
// transaction raised an error — every write it made is rolled back as if it
// never happened. A crash immediately before commit and a forced in-transaction
// error immediately before commit are indistinguishable from the database's
// point of view: both leave zero side effects. That equivalence is what these
// tests exercise, not a literal kill -9 against the connection.
//
// Each test forces a real Postgres error partway through one of the three
// atomic write paths and then asserts, by reading the database directly
// (not through the function's return value), that NOTHING from that attempt
// persisted — not even the part of the sequence that ran before the error.

import (
	"context"
	"testing"

	connectvoting "spotlight/backend/internal/connect/voting"
)

// TestNF004_CreditPaidVoteTransaction_FailurePartwayLeavesNoSideEffects forces
// the INSERT INTO votes step (which runs AFTER the UPDATE vote_transactions
// SET vote_credit_status='credited' step, inside the SAME function body/
// transaction) to violate a CHECK constraint, by seeding a transaction whose
// total_votes_to_credit is 0 (votes.vote_quantity has CHECK (vote_quantity <> 0)).
// If the transactional guarantee holds, the UPDATE that already ran must be
// rolled back along with the failed INSERT — vote_credit_status must still
// read 'pending' afterward, not 'credited' with a missing vote row.
func TestNF004_CreditPaidVoteTransaction_FailurePartwayLeavesNoSideEffects(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()

	contestID := newContest(t, ctx, pool, contestOpts{status: "open", paidVoteKobo: 10_000})
	contestantID := newContestant(t, ctx, pool, contestID)
	voter := anyVoter(t, ctx, pool)

	const ref = "zzgo-nf004-forced-failure-ref"
	var txID string
	err := pool.QueryRow(ctx, `
		INSERT INTO public.vote_transactions (
			contest_id, contestant_id, voter_user_id, payment_provider, payment_reference,
			amount_expected, votes_purchased, bonus_votes, total_votes_to_credit,
			payment_status, vote_credit_status, voter_email, voter_name)
		VALUES ($1,$2,$3,'paystack',$4, 0.00, 0, 0, 0, 'successful', 'pending', 'zz@example.com', 'ZZ')
		RETURNING id::text`,
		contestID, contestantID, voter, ref).Scan(&txID)
	if err != nil {
		t.Fatalf("seed zero-quantity vote_transaction: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.vote_transactions WHERE id=$1`, txID)
	})

	// This call MUST fail: total_votes_to_credit=0 makes the function's own
	// INSERT INTO votes (..., vote_quantity, ...) VALUES (..., 0, ...) violate
	// votes_vote_quantity_check. The UPDATE public.vote_transactions SET
	// vote_credit_status='credited' runs BEFORE that INSERT in the function body
	// — if it were not rolled back with everything after it, this would be
	// exactly the "credited but no vote row" corruption NF-004 is about.
	var alreadyCredited, refMismatch bool
	var voteID *string
	err = pool.QueryRow(ctx, `
		SELECT already_credited, reference_mismatch, vote_id
		FROM public.credit_paid_vote_transaction($1::uuid, $2, 0.00)`,
		txID, ref,
	).Scan(&alreadyCredited, &refMismatch, &voteID)
	if err == nil {
		t.Fatalf("expected credit_paid_vote_transaction to fail on a zero-quantity vote insert, got success (already_credited=%v)", alreadyCredited)
	}

	// Verify DIRECTLY against the table — not via the function's own report —
	// that nothing from the failed attempt survived.
	var creditStatus, paymentStatus string
	if err := pool.QueryRow(ctx,
		`SELECT vote_credit_status, payment_status FROM public.vote_transactions WHERE id=$1`,
		txID).Scan(&creditStatus, &paymentStatus); err != nil {
		t.Fatalf("read back vote_transactions: %v", err)
	}
	if creditStatus != "pending" {
		t.Fatalf("vote_credit_status=%q after a forced mid-transaction failure, want %q — "+
			"the UPDATE that ran before the failing INSERT was NOT rolled back (partial write survived)",
			creditStatus, "pending")
	}
	if paymentStatus != "successful" {
		// Sanity: confirm we're reading the ORIGINAL seeded row, not evidence the
		// row itself vanished or was mutated by something else.
		t.Fatalf("payment_status=%q, want the original seeded value %q — unexpected mutation", paymentStatus, "successful")
	}

	var voteRows int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM public.votes WHERE transaction_id=$1`, txID).Scan(&voteRows); err != nil {
		t.Fatalf("count votes: %v", err)
	}
	if voteRows != 0 {
		t.Fatalf("found %d votes row(s) for a transaction whose credit call FAILED — partial write survived a forced failure", voteRows)
	}

	var totalsRows int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM public.vote_totals WHERE contest_id=$1 AND contestant_id=$2`,
		contestID, contestantID).Scan(&totalsRows); err != nil {
		t.Fatalf("count vote_totals: %v", err)
	}
	if totalsRows != 0 {
		t.Fatalf("found %d vote_totals row(s) created by a FAILED credit call — the advisory-locked totals upsert was not rolled back", totalsRows)
	}
}

// TestNF004_ClaimFreeVote_GoConnect_FailurePartwayLeavesNoSideEffects forces
// Repository.ClaimFreeVote's own INSERT to fail (a pre-existing row using the
// SAME idempotency_key trips connect_votes' unique partial index), AFTER the
// function has already taken the advisory lock and read the used-count under
// it. If the Go-side `tx.Begin()/defer tx.Rollback()/tx.Commit()` guarantee
// holds, that read-then-decide work leaves no trace: the pre-existing row is
// the ONLY row for this (contest, voter) afterward — the failed attempt did
// not sneak in a second one before erroring.
func TestNF004_ClaimFreeVote_GoConnect_FailurePartwayLeavesNoSideEffects(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()

	contest := newContest(t, ctx, pool, contestOpts{status: "open", freeVotes: 5}) // allowance > 1 so the cap check passes and execution reaches the INSERT
	contestant := newContestant(t, ctx, pool, contest)
	voter := anyVoter(t, ctx, pool)

	const dupKey = "zzgo-nf004-dup-idem-key"
	var preexistingID string
	err := pool.QueryRow(ctx, `
		INSERT INTO connect_votes (contest_id, voter_id, option_ref, paid, quantity, amount_kobo, idempotency_key)
		VALUES ($1,$2,$3,false,1,0,$4)
		RETURNING id::text`,
		contest, voter, contestant, dupKey).Scan(&preexistingID)
	if err != nil {
		t.Fatalf("seed pre-existing connect_votes row: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM connect_votes WHERE id=$1`, preexistingID)
	})

	repo := connectvoting.NewRepository(pool)
	_, ok, err := repo.ClaimFreeVote(ctx, &connectvoting.Vote{
		ContestID:      contest,
		VoterID:        voter,
		OptionRef:      contestant,
		Paid:           false,
		Quantity:       1,
		IdempotencyKey: strPtr(dupKey), // forces a unique_violation on INSERT
	}, 5)
	if err == nil {
		t.Fatalf("expected ClaimFreeVote to fail on a duplicate idempotency_key, got ok=%v err=nil", ok)
	}

	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM connect_votes WHERE contest_id=$1 AND voter_id=$2`,
		contest, voter).Scan(&rows); err != nil {
		t.Fatalf("count votes: %v", err)
	}
	if rows != 1 {
		t.Fatalf("expected exactly 1 connect_votes row (the pre-existing one) after a forced mid-transaction failure, found %d — "+
			"the failed attempt's work was not fully rolled back", rows)
	}
}

func strPtr(s string) *string { return &s }
