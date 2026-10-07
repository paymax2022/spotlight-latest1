package ledger_test

// LIVE-DB regression test for the strengthened replay check in
// Repository.DebitWithBalanceCheck (money-rail audit S2): ON CONFLICT DO
// NOTHING used to be verified by AMOUNT alone — a key already claimed by a
// different journal (different account or reference, same amount) was silently
// absorbed as a no-op, which is exactly how a cross-rail idempotency-key
// collision produced paid rows with no money behind them. A replay is now a
// true duplicate only when account_id AND reference AND amount all match the
// existing row; anything else under the same key returns ErrDuplicate.
//
// SKIPPED whenever TEST_DATABASE_URL is unset — same gate as the other
// live-DB suites in this package:
//
//	export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//	go test ./internal/finance/ledger/ -run TestLiveDB_DebitReplay -v

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

func seedVerifyReplayUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		id, "ledger-verify-replay-"+id+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

func TestLiveDB_DebitReplay_VerifiesAccountAndReference(t *testing.T) {
	pool := mustLiveTxPool(t)
	ctx := context.Background()
	repo := ledger.NewRepository(pool)
	svc := ledger.NewService(repo, nil)

	user := seedVerifyReplayUser(t, pool)
	revenue, err := svc.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("revenue account: %v", err)
	}
	commission, err := svc.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		t.Fatalf("commission account: %v", err)
	}
	clearing, err := svc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}

	// Fund the wallet with enough headroom that every replay attempt reaches
	// the insert/conflict stage (the in-tx balance check runs first).
	fundKey := "test:vr-fund:" + uuid.NewString()
	if err := svc.Credit(ctx, user, fundKey, fundKey, clearing.ID, 500_000); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
	bal0, err := svc.GetBalance(ctx, user)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}

	key := "zzvr-" + uuid.NewString()
	ref := "zzvr:original"

	// First posting — real debit.
	if err := svc.Debit(ctx, user, ref, key, revenue.ID, 10_000); err != nil {
		t.Fatalf("first debit: %v", err)
	}

	// Identical replay (same account + reference + amount): a true duplicate —
	// verified no-op, no error.
	if err := svc.Debit(ctx, user, ref, key, revenue.ID, 10_000); err != nil {
		t.Fatalf("identical replay must be a no-op, got %v", err)
	}

	// Same key + amount but a DIFFERENT credit account: before the fix this was
	// a silent no-op (amount matched); the phantom rail then recorded its row
	// with no posting behind it. Now it must fail closed.
	if err := svc.Debit(ctx, user, ref, key, commission.ID, 10_000); !errors.Is(err, ledger.ErrDuplicate) {
		t.Fatalf("foreign-account replay must return ErrDuplicate, got %v", err)
	}

	// Same key + account but a DIFFERENT reference: also a foreign claim.
	if err := svc.Debit(ctx, user, "zzvr:different-ref", key, revenue.ID, 10_000); !errors.Is(err, ledger.ErrDuplicate) {
		t.Fatalf("foreign-reference replay must return ErrDuplicate, got %v", err)
	}

	// Same key, different amount: still a tampered replay (unchanged rule).
	if err := svc.Debit(ctx, user, ref, key, revenue.ID, 20_000); !errors.Is(err, ledger.ErrDuplicate) {
		t.Fatalf("different-amount replay must return ErrDuplicate, got %v", err)
	}

	// Only the first debit ever posted: the wallet is down exactly once.
	bal1, err := svc.GetBalance(ctx, user)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if bal0-bal1 != 10_000 {
		t.Fatalf("wallet debited %d across replay attempts, want exactly 10000", bal0-bal1)
	}
}
