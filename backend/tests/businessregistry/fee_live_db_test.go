package businessregistry_test

// ---------------------------------------------------------------------------
// LIVE-DB money-path test for the CAC business-registry FEE DEBIT (the funded
// happy path the live-HTTP campaign couldn't reach without funding a wallet):
// register_new → name-check → reserve → PAY FEE (real wallet debit) → submit.
//
// Asserts the money invariant: the fee is debited EXACTLY once (idempotent
// replay posts no second debit), and — when the sandbox provider registers —
// the profile reaches a verified/registered state that satisfies the
// merchant-upgrade gate (HasVerifiedBusiness). Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/business"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/provider/cac"
)

func liveDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping CAC fee-debit live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	return pool
}

func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return id
}

func balance(t *testing.T, ctx context.Context, w *wallet.Service, uid string) int64 {
	t.Helper()
	b, err := w.GetBalance(ctx, uid)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	return b.BalanceKobo
}

func TestLiveDB_CACFeeDebit_FundedHappyPath(t *testing.T) {
	pool := liveDB(t)
	defer pool.Close()
	ctx := context.Background()

	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	tierSvc := tiers.NewService(pool)
	wal := wallet.NewService(led, tierSvc)
	svc := business.NewService(business.Deps{
		Repo:     business.NewRepository(pool),
		Ledger:   led,
		Wallet:   wal,
		Provider: cac.New(cac.Config{}), // empty config → deterministic sandbox
		// FeeKobo/PlatformFeeKobo zero → defaults (1_500_000 + 200_000).
	})
	const totalFee int64 = business.DefaultRegistrationFeeKobo + business.DefaultPlatformFeeKobo

	user := seedUser(t, ctx, pool)
	// Give the wallet more than the fee. tiers: lift the user so the debit limit
	// clears the fee (a fresh user may be tier 0 with a low cap).
	pool.Exec(ctx, `UPDATE public.users SET kyc_tier=3 WHERE id=$1`, user)
	pool.Exec(ctx, `UPDATE public.user_profiles SET kyc_tier=3 WHERE id=$1`, user)
	if err := wal.Credit(ctx, user, "cac-fee-test-fund", "fund-"+user, totalFee+500_000); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
	if got := balance(t, ctx, wal, user); got != totalFee+500_000 {
		t.Fatalf("funded balance = %d, want %d", got, totalFee+500_000)
	}

	// register_new → draft → name-check → reserve
	prof, err := svc.StartRegisterNew(ctx, user, business.RegisterNewRequest{
		EntityType: business.EntityBusinessName, ProposedName: "Blue Yam Foods " + uuid.New().String()[:8], LineOfBusiness: "Food",
	})
	if err != nil {
		t.Fatalf("StartRegisterNew: %v", err)
	}
	bizID := prof.ID
	if _, err := svc.CheckName(ctx, user, business.NameCheckRequest{BusinessID: bizID, ProposedName: prof.ProposedName}); err != nil {
		t.Fatalf("CheckName: %v", err)
	}
	if rp, err := svc.ReserveName(ctx, user, user+"@seed.test", "", bizID); err != nil {
		t.Fatalf("ReserveName: %v", err)
	} else if rp.Status != business.StatusNameReserved {
		t.Fatalf("after reserve: status=%s, want name_reserved", rp.Status)
	}

	// No debit has happened yet.
	if got := balance(t, ctx, wal, user); got != totalFee+500_000 {
		t.Fatalf("balance before pay-fee = %d, want unchanged %d", got, totalFee+500_000)
	}

	// PAY FEE — the real wallet debit.
	idem := "cacfee-" + uuid.New().String()
	if _, err := svc.PayRegistrationFee(ctx, user, bizID, idem); err != nil {
		t.Fatalf("PayRegistrationFee: %v", err)
	}
	afterPay := balance(t, ctx, wal, user)
	if afterPay != 500_000 {
		t.Fatalf("balance after fee = %d, want %d (funded − totalFee %d)", afterPay, 500_000, totalFee)
	}

	// Idempotent replay of pay-fee (same key) — NO second debit.
	if _, err := svc.PayRegistrationFee(ctx, user, bizID, idem); err != nil {
		t.Fatalf("PayRegistrationFee replay: %v", err)
	}
	if got := balance(t, ctx, wal, user); got != afterPay {
		t.Fatalf("balance changed on fee replay: %d → %d (double debit!)", afterPay, got)
	}

	// Submit → the sandbox provider registers the business.
	fin, err := svc.SubmitRegistration(ctx, user, bizID, "cacsub-"+uuid.New().String())
	if err != nil {
		t.Fatalf("SubmitRegistration: %v", err)
	}
	t.Logf("status after submit: %s (register_new awaits admin approval)", fin.Status)
	if fin.Status != business.StatusRegistered && fin.Status != business.StatusUnderReview {
		t.Fatalf("after submit: status=%s, want registered or under_review", fin.Status)
	}
	// Before approval the gate must NOT yet recognize the (still under_review) business.
	if fin.Status == business.StatusUnderReview && svc.HasVerifiedBusiness(ctx, user) {
		t.Fatal("HasVerifiedBusiness=true before approval — under_review must not count")
	}

	// Admin approves → register_new reaches the terminal REGISTERED state.
	admin := seedUser(t, ctx, pool)
	reg, err := svc.AdminApprove(ctx, admin, bizID)
	if err != nil {
		t.Fatalf("AdminApprove: %v", err)
	}
	if reg.Status != business.StatusRegistered {
		t.Fatalf("after admin approve: status=%s, want registered", reg.Status)
	}
	// Now the merchant-upgrade gate must accept the registered CAC identity.
	if !svc.HasVerifiedBusiness(ctx, user) {
		t.Fatal("HasVerifiedBusiness=false after registered — the gate must accept a registered business")
	}
}
