package adminext

// LIVE-DB coverage for verifyPayoutLegs' branches — in-package because the
// ErrDuplicate→verify path through ApproveWithdrawal is only reachable when a
// Redis lock or a foreign/partial claim holds the key (with no Redis wired,
// an identical committed journal returns nil from DebitGated's in-tx replay,
// never ErrDuplicate). The external live tests already pin the end-to-end
// phantom/foreign cases through ApproveWithdrawal; this file pins the
// verifier itself, including the SUCCESS branch: a durable journal whose
// legs are exactly the payout's must return nil so the COMPLETED flip may
// proceed (R-8).
// SKIPPED whenever TEST_DATABASE_URL is unset.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_VerifyPayoutLegs_Branches(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)

	led := financeledger.NewService(financeledger.NewRepository(pool), nil)
	svc := &Service{ledger: led}

	creator := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		creator, creator+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, creator)
	testsupport.SetKycTier(t, ctx, pool, creator, testsupport.KycTierUnlimited)

	clearing, err := led.GetOrCreateStandingAccount(ctx, financeledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}
	reference := "wd-" + uuid.NewString()[:8]
	amount := int64(500_000)

	// 1) No legs at all → ErrWithdrawalPayoutPending (retryable).
	payoutIdem := "cf:withdraw:payout:" + uuid.NewString()
	if err := svc.verifyPayoutLegs(ctx, creator, reference, payoutIdem, clearing.ID, amount); !errors.Is(err, ErrWithdrawalPayoutPending) {
		t.Fatalf("no legs must answer ErrWithdrawalPayoutPending, got %v", err)
	}

	// 2) SUCCESS branch: plant the exact payout journal (fund the wallet
	//    first so the gated debit posts) → verify returns nil.
	if err := led.Credit(ctx, creator, "seed", "seed:"+uuid.NewString(), clearing.ID, amount); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
	if err := led.DebitGated(ctx, creator, "cf:withdraw:"+reference, payoutIdem, clearing.ID, amount); err != nil {
		t.Fatalf("plant payout journal: %v", err)
	}
	if err := svc.verifyPayoutLegs(ctx, creator, reference, payoutIdem, clearing.ID, amount); err != nil {
		t.Fatalf("durable identical journal must verify nil, got %v", err)
	}

	// 3) Foreign journal under the key (different reference) → ErrDuplicate
	//    wrapped conflict — never adopted as this payout's legs.
	foreignIdem := "cf:withdraw:payout:" + uuid.NewString()
	if err := led.Credit(ctx, creator, "cf:withdraw:DIFFERENT-REF", foreignIdem, clearing.ID, amount); err != nil {
		t.Fatalf("plant foreign journal: %v", err)
	}
	if err := svc.verifyPayoutLegs(ctx, creator, reference, foreignIdem, clearing.ID, amount); !errors.Is(err, financeledger.ErrDuplicate) {
		t.Fatalf("foreign journal must answer ErrDuplicate conflict, got %v", err)
	}
}
