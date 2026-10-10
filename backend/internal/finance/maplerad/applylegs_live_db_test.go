package maplerad

// LIVE-DB regression for the F-4 re-audit finding: applyLegs used to swallow
// ledger.ErrDuplicate unconditionally — key existence treated as proof the
// planned leg posted. A bare duplicate claim (lone/partial legs, or a foreign
// journal under the same key) would let the money path proceed on phantom
// postings. The leg executor now re-proves the claim against the durable
// ledger:
//   - no durable legs behind the claim       → ErrLedgerReconPending (retry);
//   - legs exist but are a different journal → ErrDuplicate-wrapped refuse;
//   - the exact intended journal committed   → benign replay, no double-post.
// SKIPPED whenever TEST_DATABASE_URL is unset.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/testsupport"
)

func legsPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping TEST_DATABASE_URL: %v", err)
	}
	return pool
}

func seedLegsUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, userID)
	testsupport.SetKycTier(t, ctx, pool, userID, testsupport.KycTierUnlimited)
}

// Phantom claim: a lone ":debit" entry holds the journal key with no balanced
// pair behind it (the shape a bare Redis-lock duplicate leaves when the post
// died inside the TTL window). applyLegs must surface the RETRYABLE pending
// error — never proceed as though the leg posted.
func TestLiveDB_ApplyLegs_PhantomDuplicate_RefusesPending(t *testing.T) {
	ctx := context.Background()
	pool := legsPool(t)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := NewService(Deps{Pool: pool, Ledger: ledgerSvc})

	user := uuid.NewString()
	seedLegsUser(t, ctx, pool, user)

	escrowAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	ref := "mpl-xfer-" + uuid.NewString()
	key := LegKey(ref, LegHold)
	// Plant ONLY the debit leg under the journal key — a partial claim.
	if _, err := pool.Exec(ctx,
		`INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		 VALUES ($1,'DEBIT',1,'foreign:partial',$2)`,
		escrowAcc.ID, key+":debit"); err != nil {
		t.Fatalf("plant partial leg: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM ledger_entries WHERE idempotency_key=$1`, key+":debit")
	})

	err = svc.applyLegs(ctx, user, ref, PlanHold(ref, 500_000))
	if !errors.Is(err, ErrLedgerReconPending) {
		t.Fatalf("phantom duplicate must surface ErrLedgerReconPending, got %v", err)
	}
}

// Foreign claim: a DIFFERENT balanced journal already holds the key (other
// accounts, other amount, other reference). applyLegs must fail closed —
// an ErrDuplicate-wrapped conflict, not retryable pending.
func TestLiveDB_ApplyLegs_ForeignJournal_Refuses(t *testing.T) {
	ctx := context.Background()
	pool := legsPool(t)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := NewService(Deps{Pool: pool, Ledger: ledgerSvc})

	user := uuid.NewString()
	seedLegsUser(t, ctx, pool, user)

	escrowAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	revAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	ref := "mpl-xfer-" + uuid.NewString()
	key := LegKey(ref, LegHold)
	if err := ledgerSvc.PostJournal(ctx, ledger.JournalEntry{
		Reference:       "foreign:journal",
		IdempotencyKey:  key,
		AmountKobo:      4242,
		DebitAccountID:  escrowAcc.ID,
		CreditAccountID: revAcc.ID,
	}); err != nil {
		t.Fatalf("post foreign journal: %v", err)
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM ledger_entries WHERE idempotency_key IN ($1,$2)`,
			key+":debit", key+":credit")
	})

	err = svc.applyLegs(ctx, user, ref, PlanHold(ref, 500_000))
	if err == nil {
		t.Fatal("a foreign journal under the leg key must fail closed")
	}
	if errors.Is(err, ErrLedgerReconPending) {
		t.Fatal("a foreign claim is a permanent conflict, not retryable pending")
	}
	if !errors.Is(err, ledger.ErrDuplicate) {
		t.Fatalf("want ErrDuplicate-wrapped conflict, got %v", err)
	}
}

// Genuine replay: the same planned leg applied twice posts exactly once — the
// second call must converge (verified duplicate), never double-post and never
// refuse. Exercises the wallet-debit path (PostJournalGated) end-to-end.
func TestLiveDB_ApplyLegs_TrueReplay_ConvergesOnce(t *testing.T) {
	ctx := context.Background()
	pool := legsPool(t)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	// Wire the strict in-tx debit guard so the gated wallet journal has its
	// authority — the fixture user is tier-3 (uncapped) so the hold posts.
	ledgerSvc.SetDebitGuard(tiers.NewService(pool).EnforceWalletDebitLimitTx)
	svc := NewService(Deps{Pool: pool, Ledger: ledgerSvc})

	user := uuid.NewString()
	seedLegsUser(t, ctx, pool, user)

	revAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := ledgerSvc.Credit(ctx, user, "seed-fund", "legsfund-"+user, revAcc.ID, 5_000_000); err != nil {
		t.Fatalf("fund user: %v", err)
	}

	ref := "mpl-xfer-" + uuid.NewString()
	legs := PlanHold(ref, 500_000)
	if err := svc.applyLegs(ctx, user, ref, legs); err != nil {
		t.Fatalf("first applyLegs: %v", err)
	}
	if err := svc.applyLegs(ctx, user, ref, legs); err != nil {
		t.Fatalf("replay applyLegs must converge, got %v", err)
	}

	key := LegKey(ref, LegHold)
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM ledger_entries WHERE idempotency_key IN ($1,$2)`,
		key+":debit", key+":credit").Scan(&n); err != nil {
		t.Fatalf("count legs: %v", err)
	}
	if n != 2 {
		t.Fatalf("replay must post exactly one balanced pair, got %d legs", n)
	}
}

// Reversal phantom: a lone ":rev_credit" claim forces PostReversal's unique
// constraint, but the rolled-back tx leaves ":rev_debit" absent — verify must
// surface ErrLedgerReconPending, not treat the claim as posted.
func TestLiveDB_ApplyLegs_ReversalPhantom_RefusesPending(t *testing.T) {
	ctx := context.Background()
	pool := legsPool(t)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := NewService(Deps{Pool: pool, Ledger: ledgerSvc})

	user := uuid.NewString()
	seedLegsUser(t, ctx, pool, user)

	suspAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountFailedTransferSusp)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	ref := "mpl-xfer-" + uuid.NewString()
	key := LegKey(ref, LegReversal)
	// Plant ONLY the rev_credit leg — the reversal pair's second insert collides
	// inside its tx, rolls back its own rev_debit, and reports ErrDuplicate.
	if _, err := pool.Exec(ctx,
		`INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		 VALUES ($1,'REVERSAL_CREDIT',1,'foreign:partial',$2)`,
		suspAcc.ID, key+":rev_credit"); err != nil {
		t.Fatalf("plant partial reversal leg: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM ledger_entries WHERE idempotency_key=$1`, key+":rev_credit")
	})

	err = svc.applyLegs(ctx, user, ref, PlanReverseHold(ref, 500_000))
	if !errors.Is(err, ErrLedgerReconPending) {
		t.Fatalf("phantom reversal duplicate must surface ErrLedgerReconPending, got %v", err)
	}
}
