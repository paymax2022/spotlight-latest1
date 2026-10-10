package tiers_test

// LIVE-DB regression test for F7 (escrow-ledger review): the KYC-tier daily
// debit cap used to be enforced ONLY by a pooled EnforceWalletDebitLimit read
// before the posting — two concurrent debits on the same wallet could each
// pass the check and then both post, blowing the daily cap. The authoritative
// check now runs INSIDE the debit transaction under
// pg_advisory_xact_lock("wallet:"+userID) (ledger.DebitGated /
// DebitWithGuard / PostJournalGated → tiers.EnforceWalletDebitLimitTx), so a
// burst of concurrent same-user debits serialises: the loser sees the
// winner's committed legs and is refused.
//
// What this pins, with REAL Postgres concurrency (no simulated interleavings):
//   - N concurrent distinct debits whose sum exceeds the Tier-1 daily cap
//     admit exactly the subset that fits — total posted <= cap;
//   - every loser fails on tiers.ErrDailyLimitExceeded (never a silent post);
//   - the durable daily-debit sum equals exactly the cap afterwards;
//   - a committed replay still converges after the cap is exhausted — the
//     in-tx guard runs AFTER replay verification, so a retry is not refused
//     by its own already-posted legs.
//
// GATED ON TEST_DATABASE_URL only — never DATABASE_URL (production pooler):
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:54322/postgres"
//	go test ./internal/finance/tiers/ -run TestLiveDB_ConcurrentDebits -v

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/testsupport"
)

func tiersConcurrencyPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB tier concurrency test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func tiersConcurrencyUser(t *testing.T, pool *pgxpool.Pool, kycTier int) string {
	t.Helper()
	ctx := context.Background()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		id, "tiers-conc-test-"+id+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	testsupport.SetKycTier(t, ctx, pool, id, kycTier)
	return id
}

func dailyDebitedTotal(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var total int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(le.amount_kobo), 0)
		FROM ledger_entries le
		JOIN ledger_accounts la ON la.id = le.account_id
		WHERE la.user_id = $1 AND la.type = 'user_wallet' AND le.type = 'DEBIT'
		  AND le.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`,
		userID).Scan(&total); err != nil {
		t.Fatalf("sum daily debits: %v", err)
	}
	return total
}

// TestLiveDB_ConcurrentDebits_NeverExceedDailyCap: 12 concurrent DebitGated
// calls of ₦10,000 each against a Tier-1 user (₦50,000/day) with a well-funded
// wallet. Attempted total = ₦120,000 > cap. Under the old pooled check every
// call could pass pre-flight and post; under the in-tx check exactly 5 may
// commit — the 6th onward must fail on ErrDailyLimitExceeded, and the durable
// daily-debit sum must equal exactly the cap, never more.
func TestLiveDB_ConcurrentDebits_NeverExceedDailyCap(t *testing.T) {
	pool := tiersConcurrencyPool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	userID := tiersConcurrencyUser(t, pool, 1) // Tier 1: ₦50,000/day strict cap
	const cap = int64(5_000_000)

	// Fund far more than the cap so the TIER check — not sufficiency — is the
	// binding constraint.
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}
	fundKey := "test:fund:" + uuid.NewString()
	if err := ledgerSvc.Credit(ctx, userID, fundKey, fundKey, clearing.ID, 50_000_000); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
	escrowAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow account: %v", err)
	}

	const (
		attempts = 12
		perDebit = int64(1_000_000) // ₦10,000 each — 5 fit under the cap, 7 must refuse
		wantWins = 5
	)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var succeeded, capRefused, insufficient int
	start := make(chan struct{})
	for i := range attempts {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start // release all goroutines together to maximise contention
			key := fmt.Sprintf("f7-conc-%d-%s", i, uuid.NewString())
			err := ledgerSvc.DebitGated(ctx, userID, "f7:concurrent", key, escrowAcc.ID, perDebit)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				succeeded++
			case errors.Is(err, tiers.ErrDailyLimitExceeded):
				capRefused++
			case errors.Is(err, ledger.ErrInsufficientFunds):
				insufficient++
			default:
				t.Errorf("debit %d: unexpected error class: %v", i, err)
			}
		}(i)
	}
	close(start)
	wg.Wait()

	if succeeded != wantWins {
		t.Fatalf("concurrent debits over the daily cap must collapse to %d winners; "+
			"got %d successes (capRefused=%d insufficient=%d) — the cap check is not serialised with the posting",
			wantWins, succeeded, capRefused, insufficient)
	}
	if insufficient != 0 {
		t.Fatalf("sufficiency must never bind before the cap here, got %d", insufficient)
	}

	posted := dailyDebitedTotal(t, ctx, pool, userID)
	if posted > cap {
		t.Fatalf("daily debited total %d exceeds Tier-1 cap %d — F7 regression", posted, cap)
	}
	if posted != cap {
		t.Fatalf("daily debited total = %d, want exactly %d (five committed ₦10,000 debits)", posted, cap)
	}
}

// TestLiveDB_ConcurrentDebits_ReplayAfterCapExhausted: a genuine replay of an
// already-committed debit must converge even when today's usage would now
// refuse the amount — the in-tx guard runs after replay verification, so a
// retry is never rejected by re-counting its own legs.
func TestLiveDB_ConcurrentDebits_ReplayAfterCapExhausted(t *testing.T) {
	pool := tiersConcurrencyPool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	userID := tiersConcurrencyUser(t, pool, 1)

	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}
	fundKey := "test:fund:" + uuid.NewString()
	if err := ledgerSvc.Credit(ctx, userID, fundKey, fundKey, clearing.ID, 50_000_000); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
	escrowAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow account: %v", err)
	}

	// Spend right up to the cap with one committed debit.
	key := "f7-replay-" + uuid.NewString()
	if err := ledgerSvc.DebitGated(ctx, userID, "f7:replay", key, escrowAcc.ID, 5_000_000); err != nil {
		t.Fatalf("initial debit: %v", err)
	}
	// A fresh debit must now be refused — the cap is fully consumed.
	if err := ledgerSvc.DebitGated(ctx, userID, "f7:replay", "f7-extra-"+uuid.NewString(), escrowAcc.ID, 1_000_000); !errors.Is(err, tiers.ErrDailyLimitExceeded) {
		t.Fatalf("debit beyond the cap must fail on ErrDailyLimitExceeded, got %v", err)
	}
	// But replaying the COMMITTED debit converges — the in-tx replay
	// verification runs before the guard.
	if err := ledgerSvc.DebitGated(ctx, userID, "f7:replay", key, escrowAcc.ID, 5_000_000); err != nil {
		t.Fatalf("replay of a committed debit must converge even at the cap, got %v", err)
	}

	posted := dailyDebitedTotal(t, ctx, pool, userID)
	if posted != 5_000_000 {
		t.Fatalf("daily debited = %d, want exactly 5_000_000 (the replay posted nothing)", posted)
	}
}

// TestLiveDB_ConcurrentDebits_CheckoutGuardSerialisesToo: the consumer-purchase
// path (DebitWithGuard + EnforceCheckoutDebitLimitTx) must serialise the same
// way — a Tier-0 customer with the checkout allowance enabled can buy up to the
// rolling-window cap, never more, under a concurrent burst.
func TestLiveDB_ConcurrentDebits_CheckoutGuardSerialisesToo(t *testing.T) {
	pool := tiersConcurrencyPool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool).WithCheckoutAllowance(true)

	userID := tiersConcurrencyUser(t, pool, 0) // Tier 0: checkout allowance ₦20,000/24h

	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}
	fundKey := "test:fund:" + uuid.NewString()
	if err := ledgerSvc.Credit(ctx, userID, fundKey, fundKey, clearing.ID, 50_000_000); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
	escrowAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow account: %v", err)
	}

	// ₦10,000 is the per-purchase max (CheckoutMaxSingleKobo); the ₦20,000
	// rolling allowance admits exactly two purchases under a burst.
	const (
		attempts = 8
		perDebit = int64(1_000_000)
		wantWins = 2
	)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var succeeded, refused int
	start := make(chan struct{})
	for i := range attempts {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			key := fmt.Sprintf("f7-checkout-%d-%s", i, uuid.NewString())
			err := ledgerSvc.DebitWithGuard(ctx, userID, "f7:checkout", key, escrowAcc.ID, perDebit,
				tiersSvc.EnforceCheckoutDebitLimitTx)
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				succeeded++
			} else {
				refused++
			}
		}(i)
	}
	close(start)
	wg.Wait()

	if succeeded != wantWins {
		t.Fatalf("checkout allowance burst must collapse to %d winners, got %d (refused=%d)",
			wantWins, succeeded, refused)
	}
	posted := dailyDebitedTotal(t, ctx, pool, userID)
	if posted != 2_000_000 {
		t.Fatalf("Tier-0 checkout debits = %d, want exactly the ₦20,000 rolling allowance", posted)
	}
}

// TestLiveDB_WalletDebit_ReplayThroughPooledGateAtCap proves the F2 fix at the
// ACTUAL call site: wallet.Service.Debit runs a pooled advisory
// EnforceWalletDebitLimit BEFORE ledger.DebitGated. Without the committed-key
// probe, a replay of a debit that already posted would be refused at that
// pooled read once today's usage is at the cap — wedging a retry whose money
// already moved (and inviting a fresh-key double-charge). The probe must skip
// the pooled gate for committed keys so the in-tx replay verification
// converges.
func TestLiveDB_WalletDebit_ReplayThroughPooledGateAtCap(t *testing.T) {
	pool := tiersConcurrencyPool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	ledgerSvc.SetDebitGuard(tiers.NewService(pool).EnforceWalletDebitLimitTx)
	walletSvc := wallet.NewService(ledgerSvc, tiers.NewService(pool))

	userID := tiersConcurrencyUser(t, pool, 1) // Tier 1: ₦50,000/day strict cap

	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}
	fundKey := "test:fund:" + uuid.NewString()
	if err := ledgerSvc.Credit(ctx, userID, fundKey, fundKey, clearing.ID, 50_000_000); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
	escrowAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow account: %v", err)
	}

	// Spend right up to the cap through the wallet service itself.
	key := "f2-wallet-" + uuid.NewString()
	if err := walletSvc.Debit(ctx, userID, "f2:wallet", key, escrowAcc.ID, 5_000_000); err != nil {
		t.Fatalf("initial wallet debit: %v", err)
	}
	// A fresh key must refuse at the pooled gate — cap consumed.
	if err := walletSvc.Debit(ctx, userID, "f2:wallet", "f2-fresh-"+uuid.NewString(), escrowAcc.ID, 1_000_000); !errors.Is(err, tiers.ErrDailyLimitExceeded) {
		t.Fatalf("fresh debit beyond the cap must fail on ErrDailyLimitExceeded, got %v", err)
	}
	// Replaying the COMMITTED key through wallet.Debit must converge — the
	// pooled gate is skipped for a key whose journal already posted (F2).
	if err := walletSvc.Debit(ctx, userID, "f2:wallet", key, escrowAcc.ID, 5_000_000); err != nil {
		t.Fatalf("wallet.Debit replay of a committed debit must converge even at the cap, got %v", err)
	}

	posted := dailyDebitedTotal(t, ctx, pool, userID)
	if posted != 5_000_000 {
		t.Fatalf("daily debited = %d, want exactly 5_000_000 (the replay posted nothing)", posted)
	}
}
