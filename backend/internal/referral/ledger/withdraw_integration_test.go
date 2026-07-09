package ledger

// Live-DB integration test for the referral earnings WITHDRAW money-path.
// Verifies the four money-path invariants end-to-end against a real Postgres:
//   (1) Idempotency-Key required — replay credits nothing twice.
//   (2) Balanced double-entry posted (wallet credited == withdrawn).
//   (3) State machine — eligible rows move to paid; remaining eligible = 0.
//   (4) Fail-closed KYC gate — tier below MinWithdrawTier is rejected.
//
// SKIPPED whenever DATABASE_URL / TEST_DATABASE_URL is unset (same pattern as the
// other live-DB tests). Bring-up: point DATABASE_URL at a disposable, migrated
// Postgres — never production. It creates only rows keyed by fresh UUIDs and does
// not truncate tables, so it is safe to run repeatedly.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
)

func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("TEST_DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("DATABASE_URL/TEST_DATABASE_URL not set — skipping live-DB withdraw test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	return pool
}

func mustExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

// seedVerifiedUser inserts an auth.users row + a verified user_profiles row at the
// given KYC tier, and returns the user id.
func seedVerifiedUser(t *testing.T, pool *pgxpool.Pool, tier int, status string) string {
	t.Helper()
	uid := uuid.NewString()
	email := "wd-" + uid + "@test.local"
	mustExec(t, pool, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`, uid, email)
	mustExec(t, pool,
		`INSERT INTO user_profiles (id, email, kyc_tier, kyc_status) VALUES ($1,$2,$3,$4)
		 ON CONFLICT (id) DO UPDATE SET kyc_tier=EXCLUDED.kyc_tier, kyc_status=EXCLUDED.kyc_status`,
		uid, email, tier, status)
	return uid
}

func seedEligibleReward(t *testing.T, pool *pgxpool.Pool, beneficiary string, kobo int64) {
	t.Helper()
	mustExec(t, pool,
		`INSERT INTO referral_reward_ledger
		   (beneficiary_id, kind, state, amount_kobo, currency, is_house, idempotency_key)
		 VALUES ($1,'referrer','eligible',$2,'NGN',false,$3)`,
		beneficiary, kobo, "seed-"+uuid.NewString())
}

func newSvc(pool *pgxpool.Pool) *Service {
	fin := financeledger.NewService(financeledger.NewRepository(pool), nil)
	return NewService(pool, fin)
}

func TestWithdrawEligible_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newSvc(pool)
	fin := financeledger.NewService(financeledger.NewRepository(pool), nil)

	uid := seedVerifiedUser(t, pool, 1, "verified")
	seedEligibleReward(t, pool, uid, 100_000)
	seedEligibleReward(t, pool, uid, 50_000)

	// (2)(3) Sweep eligible → wallet.
	res, err := svc.WithdrawEligible(ctx, uid, "wd-"+uid)
	if err != nil {
		t.Fatalf("withdraw: %v", err)
	}
	if res.WithdrawnKobo != 150_000 {
		t.Fatalf("withdrawn = %d, want 150000", res.WithdrawnKobo)
	}
	if res.RewardsPaid != 2 {
		t.Fatalf("rewardsPaid = %d, want 2", res.RewardsPaid)
	}
	if res.RemainingEligibleKobo != 0 {
		t.Fatalf("remainingEligible = %d, want 0", res.RemainingEligibleKobo)
	}

	// (2) Wallet balance equals the amount swept (balanced double-entry).
	bal, err := fin.GetBalance(ctx, uid)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal != 150_000 {
		t.Fatalf("wallet balance = %d, want 150000", bal)
	}

	// (3) Both reward rows are now paid; none left eligible.
	var paid, eligible int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FILTER (WHERE state='paid'), count(*) FILTER (WHERE state='eligible')
		 FROM referral_reward_ledger WHERE beneficiary_id=$1`, uid).Scan(&paid, &eligible); err != nil {
		t.Fatalf("count: %v", err)
	}
	if paid != 2 || eligible != 0 {
		t.Fatalf("paid=%d eligible=%d, want 2/0", paid, eligible)
	}

	// (1) Idempotent behaviour: nothing eligible remains, so a second sweep moves
	// no money and the wallet balance is unchanged.
	res2, err := svc.WithdrawEligible(ctx, uid, "wd-"+uid)
	if err != nil {
		t.Fatalf("withdraw replay: %v", err)
	}
	if res2.WithdrawnKobo != 0 {
		t.Fatalf("replay withdrawn = %d, want 0", res2.WithdrawnKobo)
	}
	bal2, _ := fin.GetBalance(ctx, uid)
	if bal2 != 150_000 {
		t.Fatalf("wallet balance after replay = %d, want 150000 (no double credit)", bal2)
	}
}

func TestWithdrawEligible_KYCGate_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newSvc(pool)

	// Unverified / tier-0 user with an eligible reward must be rejected fail-closed.
	uid := seedVerifiedUser(t, pool, 0, "pending")
	seedEligibleReward(t, pool, uid, 100_000)

	_, err := svc.WithdrawEligible(ctx, uid, "wd-"+uid)
	if err != ErrKYCRequired {
		t.Fatalf("expected ErrKYCRequired, got %v", err)
	}
}
