package voting_test

// UAT Batch 3 — TS-11 NF-005 (Idempotency under retry storm).
//
// Goes further than the existing coverage this batch checked first:
//   - backend/tests/voting/connect_tally_live_db_test.go proves the tally
//     PROJECTION follows vote_credit_status, not concurrency of the credit call.
//   - frontend-web/tests/unit/voting/paid-vote-concurrency.spec.ts proves the
//     BRIDGE's TypeScript wrapper calls the right RPC and handles each of its
//     responses correctly — but it mocks Supabase, so it cannot and does not
//     prove the RPC itself is safe under real concurrent replay.
//   - backend/tests/voting/free_vote_atomicity_live_db_test.go (D-010) and this
//     package's surge_concurrency_live_db_test.go (NF-001) prove DIFFERENT
//     voters/transactions don't race each other and one voter can't exceed
//     their cap — not that the SAME logical request replayed many times
//     collapses to exactly one effect.
//
// This file fires N concurrent copies of the SAME logical request — same
// transaction id + payment reference for the bridge's paid-vote credit RPC,
// same Idempotency-Key for Go Connect's PaidVote — the retry-storm shape (a
// client retrying a slow request, a webhook firing alongside a redirect,
// a proxy replaying a request it never got a response for) and confirms
// exactly one effect lands: one credited vote, one wallet debit, never more.
//
// HONESTY NOTE: same caveat as NF-001 — 100-150 concurrent goroutines against
// local Postgres is real concurrency, not a production-scale retry storm
// (thousands of clients, real network jitter, a real load balancer).

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	connectvoting "spotlight/backend/internal/connect/voting"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
)

// TestNF005_CreditPaidVoteTransaction_TSBridge_RetryStorm replays the SAME
// (transaction id, payment reference) 120 times concurrently — the bridge
// calling credit_paid_vote_transaction once for a webhook delivery and once
// for a browser redirect is the documented PV-005 case; this is that same
// call replayed 6x the scale of the existing 20-way proof cited in the test
// plan, to see whether the guarantee holds under a genuine retry storm and
// not just a two-way race.
func TestNF005_CreditPaidVoteTransaction_TSBridge_RetryStorm(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()

	contestID := newContest(t, ctx, pool, contestOpts{status: "open", paidVoteKobo: 10_000})
	contestantID := newContestant(t, ctx, pool, contestID)
	voter := anyVoter(t, ctx, pool)

	const ref = "zzgo-nf005-retry-storm-ref"
	var txID string
	err := pool.QueryRow(ctx, `
		INSERT INTO public.vote_transactions (
			contest_id, contestant_id, voter_user_id, payment_provider, payment_reference,
			amount_expected, votes_purchased, bonus_votes, total_votes_to_credit,
			payment_status, vote_credit_status, voter_email, voter_name)
		VALUES ($1,$2,$3,'paystack',$4, 500.00, 5, 0, 5, 'successful', 'pending', 'zz@example.com', 'ZZ')
		RETURNING id::text`,
		contestID, contestantID, voter, ref).Scan(&txID)
	if err != nil {
		t.Fatalf("seed vote_transaction: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.vote_transactions WHERE id=$1`, txID)
	})

	const attempts = 120
	var wg sync.WaitGroup
	var mu sync.Mutex
	wins, replays, errs := 0, 0, 0
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var alreadyCredited, refMismatch bool
			var voteID *string
			err := pool.QueryRow(ctx, `
				SELECT already_credited, reference_mismatch, vote_id
				FROM public.credit_paid_vote_transaction($1::uuid, $2, 500.00)`,
				txID, ref,
			).Scan(&alreadyCredited, &refMismatch, &voteID)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs++
				t.Errorf("replay: unexpected error: %v", err)
				return
			}
			if refMismatch {
				errs++
				t.Errorf("replay: unexpected reference_mismatch")
				return
			}
			if alreadyCredited {
				replays++
			} else if voteID != nil {
				wins++
			}
		}()
	}
	wg.Wait()

	if errs != 0 {
		t.Fatalf("%d of %d replays errored unexpectedly", errs, attempts)
	}
	if wins != 1 {
		t.Fatalf("expected exactly 1 winning credit out of %d replayed requests, got %d", attempts, wins)
	}
	if replays != attempts-1 {
		t.Fatalf("expected %d safe already_credited replays, got %d", attempts-1, replays)
	}

	var voteRows int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM public.votes WHERE transaction_id=$1`, txID).Scan(&voteRows); err != nil {
		t.Fatalf("count votes: %v", err)
	}
	if voteRows != 1 {
		t.Fatalf("expected exactly 1 votes row after %d replayed requests, found %d — the retry storm double-credited", attempts, voteRows)
	}

	var paidVotes int64
	if err := pool.QueryRow(ctx,
		`SELECT paid_votes FROM public.vote_totals WHERE contest_id=$1 AND contestant_id=$2 AND round_id IS NULL`,
		contestID, contestantID).Scan(&paidVotes); err != nil {
		t.Fatalf("read vote_totals: %v", err)
	}
	if paidVotes != 5 {
		t.Fatalf("vote_totals.paid_votes=%d after %d replayed requests, want 5 (credited exactly once) — the retry storm inflated the tally", paidVotes, attempts)
	}
}

// ── Go Connect engine: PaidVote end-to-end retry storm ─────────────────────

// noopAuditor discards audit writes — this test isolates the idempotency
// guarantee under test (the wallet debit + immutable vote insert), not the
// audit log, which is explicitly best-effort/non-transactional elsewhere in
// this codebase.
type noopAuditor struct{}

func (noopAuditor) WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error {
	return nil
}

// revenueAccountAdapter satisfies connectvoting.RevenueAccountResolver over a
// real ledger.Service — the same standing-account pattern wallet.VoteDebit
// uses for AccountCommission, but voting's own PaidVote resolves revenue via
// this seam (app-wiring's production adapter does the same thing with a
// couple more layers; this is the minimal live equivalent for a test).
type revenueAccountAdapter struct{ ledger *ledger.Service }

func (r revenueAccountAdapter) RevenueAccountID(ctx context.Context) (string, error) {
	acc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

// tier3Voter borrows an existing auth.users row whose user_profiles.kyc_tier
// is already 3 (full KYC, unlimited daily debit — see tiers/model.go), so the
// wallet debit under test is never rejected by the tier daily-limit gate.
// It does NOT mutate any user_profiles row — local dev Postgres already has
// thousands of tier-3 fixture profiles to borrow, the same "borrow, don't
// seed or mutate" discipline anyVoter() documents in fixtures_test.go.
func tier3Voter(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(ctx,
		`SELECT id::text FROM public.user_profiles WHERE kyc_tier = 3 LIMIT 1`).Scan(&id)
	if err != nil {
		t.Fatalf("no tier-3 user_profiles row to borrow: %v", err)
	}
	return id
}

// TestNF005_PaidVote_GoConnect_RetryStorm fires 100 concurrent PaidVote calls
// for the SAME (contest, voter, Idempotency-Key) — the retry-storm shape for
// the wallet-funded engine, which has no external payment gateway step (the
// debit IS the payment). Proves the whole vertical — tier check, wallet
// debit, ledger posting, immutable vote insert — collapses a replayed
// request to exactly one wallet debit and exactly one vote, using the SAME
// production wiring (ledger.Service + wallet.Service + connectvoting.Service)
// the real handler uses, with Redis deliberately nil so the durable DB-level
// guarantee is what's under test, not the Redis fast-path cache (mirrors the
// documented choice in backend/tests/utilitybills/live_db_test.go).
func TestNF005_PaidVote_GoConnect_RetryStorm(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()

	contest := newContest(t, ctx, pool, contestOpts{status: "open", paidVoteKobo: 100})
	contestant := newContestant(t, ctx, pool, contest)
	voter := tier3Voter(t, ctx, pool)

	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)

	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}
	// Unique per run (not just per voter): the borrowed tier-3 voter is
	// deterministic (SELECT ... LIMIT 1), so a run-scoped suffix stops a
	// second test run from colliding with a still-posted ledger entry from a
	// prior run and getting ErrDuplicate on funding instead of on the thing
	// actually under test.
	fundRef := fmt.Sprintf("zzgo-nf005-fund-%s-%s", voter, uuid.NewString())
	if err := ledgerSvc.Credit(ctx, voter, fundRef, fundRef, clearing.ID, 100_000); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
	balBefore, err := ledgerSvc.GetBalance(ctx, voter)
	if err != nil {
		t.Fatalf("read starting balance: %v", err)
	}

	repo := connectvoting.NewRepository(pool)
	svc := connectvoting.NewService(repo, walletSvc, revenueAccountAdapter{ledgerSvc}, noopAuditor{}, nil)

	const attempts = 100
	idemKey := fmt.Sprintf("zzgo-nf005-idem-%s-%s", contest, voter)

	var wg sync.WaitGroup
	var mu sync.Mutex
	successes, dupErrors, otherErrors := 0, 0, 0
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.PaidVote(ctx, contest, voter, idemKey, connectvoting.PaidVoteRequest{
				OptionRef: contestant,
				Quantity:  1,
			})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				successes++
			case errors.Is(err, ledger.ErrDuplicate):
				dupErrors++
			default:
				// The connect_votes unique index on idempotency_key is the other
				// valid way a replay can be rejected (see repo.go InsertVote): a
				// duplicate-key error surfaces as a plain wrapped error, not
				// ledger.ErrDuplicate, because it comes from the voting repo's
				// INSERT, not the ledger's.
				otherErrors++
			}
		}()
	}
	wg.Wait()

	if successes != 1 {
		t.Fatalf("expected exactly 1 successful PaidVote out of %d concurrent identical requests, got %d (dupErrors=%d otherErrors=%d)",
			attempts, successes, dupErrors, otherErrors)
	}
	if got := dupErrors + otherErrors; got != attempts-1 {
		t.Fatalf("expected the other %d requests to be rejected as duplicates, got %d rejected (successes=%d)", attempts-1, got, successes)
	}

	var voteRows int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM connect_votes WHERE contest_id=$1 AND voter_id=$2 AND paid=true`,
		contest, voter).Scan(&voteRows); err != nil {
		t.Fatalf("count votes: %v", err)
	}
	if voteRows != 1 {
		t.Fatalf("expected exactly 1 paid connect_votes row after %d identical concurrent requests, found %d — the retry storm double-voted", attempts, voteRows)
	}

	balAfter, err := ledgerSvc.GetBalance(ctx, voter)
	if err != nil {
		t.Fatalf("read final balance: %v", err)
	}
	if wantDebit, gotDebit := int64(100), balBefore-balAfter; gotDebit != wantDebit {
		t.Fatalf("wallet was debited %d kobo across %d identical concurrent requests, want exactly %d (charged once) — the retry storm double-charged the wallet",
			gotDebit, attempts, wantDebit)
	}
}
