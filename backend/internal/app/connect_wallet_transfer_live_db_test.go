package app

// LIVE-DB regression test for the connectWalletTransferAdapter TOCTOU fix
// (money-rail audit S6): the adapter used to run GetBalance on the pool and
// then PostJournal in a second step — two concurrent transfers could both
// pass an unlocked balance check and both post, overdrawing the sender's
// wallet. The adapter now routes through ledger.Service.Debit
// (Repository.DebitWithBalanceCheck): one tx, the sender's
// pg_advisory_xact_lock("wallet:"+userID), balance re-projected INSIDE the
// lock, balanced pair inserted atomically.
//
// This exercises the REAL adapter (not a test twin) against real Postgres
// concurrency.
//
// GATED ON TEST_DATABASE_URL only — never DATABASE_URL (production pooler):
//
//	export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//	go test ./internal/app/ -run TestLiveDB_ConnectWalletTransfer -v

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
	"spotlight/backend/internal/testsupport"
)

func connectTransferTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB connect transfer test")
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

func connectTransferUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		id, "connect-transfer-test-"+id+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

func connectTransferFund(t *testing.T, ledgerSvc *ledger.Service, userID string, amountKobo int64) {
	t.Helper()
	ctx := context.Background()
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}
	key := "test:fund:" + uuid.NewString()
	if err := ledgerSvc.Credit(ctx, userID, key, key, clearing.ID, amountKobo); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
}

// TestLiveDB_ConnectWalletTransfer_ConcurrentCannotOverdraw fires N concurrent
// transfers from ONE sender, distinct idempotency keys, each larger than the
// balance remaining after the first — exactly one may win. Under the old
// read-then-post adapter every caller saw the pre-debit balance and posted.
func TestLiveDB_ConnectWalletTransfer_ConcurrentCannotOverdraw(t *testing.T) {
	pool := connectTransferTestPool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	adapter := &connectWalletTransferAdapter{ledger: ledgerSvc}

	sender := connectTransferUser(t, pool)
	recipient := connectTransferUser(t, pool)
	// The adapter debits via DebitGated (F7-serialised strict tier gate), so
	// the sender fixture must hold a wallet-enabled KYC tier — seeded users
	// default to Tier 0 = wallet disabled.
	testsupport.SetKycTier(t, ctx, pool, sender, testsupport.KycTierUnlimited)
	connectTransferFund(t, ledgerSvc, sender, 100_000)

	const attempts = 8
	var wg sync.WaitGroup
	var mu sync.Mutex
	var succeeded, insufficient int
	for i := range attempts {
		wg.Go(func() {
			err := adapter.Transfer(ctx, sender, recipient,
				fmt.Sprintf("zzrail-conc-%d", i), "zzrail-conc-"+uuid.NewString(), 60_000)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				succeeded++
			case errors.Is(err, ledger.ErrInsufficientFunds):
				insufficient++
			default:
				t.Errorf("transfer %d: unexpected error: %v", i, err)
			}
		})
	}
	wg.Wait()

	if succeeded != 1 {
		t.Fatalf("concurrent transfers exceeding the balance must collapse to one winner; "+
			"got %d successes (insufficient=%d) — check+debit is not atomic", succeeded, insufficient)
	}
	bal, err := ledgerSvc.GetBalance(ctx, sender)
	if err != nil {
		t.Fatalf("final balance: %v", err)
	}
	if bal != 40_000 {
		t.Fatalf("sender balance = %d after %d concurrent 60000 transfers on 100000 — overdraw", bal, attempts)
	}
	rBal, err := ledgerSvc.GetBalance(ctx, recipient)
	if err != nil {
		t.Fatalf("recipient balance: %v", err)
	}
	if rBal != 60_000 {
		t.Fatalf("recipient balance = %d, want exactly 60000 (one settled transfer)", rBal)
	}
}

// TestLiveDB_ConnectWalletTransfer_SameKeyReplayIsNoop: the second call under
// the same idempotency key (a genuine client retry) must be a no-op — the
// ledger ON CONFLICT + replay verification path — never a second debit.
func TestLiveDB_ConnectWalletTransfer_SameKeyReplayIsNoop(t *testing.T) {
	pool := connectTransferTestPool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	adapter := &connectWalletTransferAdapter{ledger: ledgerSvc}

	sender := connectTransferUser(t, pool)
	recipient := connectTransferUser(t, pool)
	testsupport.SetKycTier(t, ctx, pool, sender, testsupport.KycTierUnlimited)
	// Fund enough that the replay's pre-insert balance check still passes and
	// the dedup path is what runs — the balance check fires before the key
	// conflict is discovered, by design.
	connectTransferFund(t, ledgerSvc, sender, 200_000)

	key := "zzrail-replay-" + uuid.NewString()
	if err := adapter.Transfer(ctx, sender, recipient, "zzrail-replay", key, 60_000); err != nil {
		t.Fatalf("first transfer: %v", err)
	}
	// Identical journal under the same key: verified no-op, no error, no debit.
	if err := adapter.Transfer(ctx, sender, recipient, "zzrail-replay", key, 60_000); err != nil {
		t.Fatalf("identical replay must be a no-op, got %v", err)
	}
	// Same key, different amount: a foreign claim — must fail closed.
	if err := adapter.Transfer(ctx, sender, recipient, "zzrail-replay", key, 40_000); !errors.Is(err, ledger.ErrDuplicate) {
		t.Fatalf("replayed key with different amount must return ErrDuplicate, got %v", err)
	}
	// Same key, same amount, different reference: also a foreign claim.
	if err := adapter.Transfer(ctx, sender, recipient, "zzrail-other-ref", key, 60_000); !errors.Is(err, ledger.ErrDuplicate) {
		t.Fatalf("replayed key with different reference must return ErrDuplicate, got %v", err)
	}

	bal, _ := ledgerSvc.GetBalance(ctx, sender)
	if bal != 140_000 {
		t.Fatalf("sender balance = %d, want 140000 — replays must not double-debit", bal)
	}
}
