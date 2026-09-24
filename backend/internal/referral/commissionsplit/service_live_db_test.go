package commissionsplit_test

// ---------------------------------------------------------------------------
// LIVE-DB suite for the referral purchase-commission-split engine: a referrer
// earns a flat 20% of Spotlight's realized commission on every purchase made
// by someone they referred, capped per referral CODE (shared across every
// person that code referred), defaulting silently to Admin (no payout, no
// record) once retired or when the payer has no human referrer.
//
// SKIPPED whenever TEST_DATABASE_URL is unset, so `go test ./...` without a DB
// stays green.
//
// Bring-up:
//   export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//   cd backend && go test ./internal/referral/commissionsplit/... -v -count=1
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/referral/commissionsplit"
)

func mustLivePool(t *testing.T) *pgxpool.Pool {
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

func seedUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	userID := uuid.NewString()
	email := "commsplit-" + uuid.NewString()[:8] + "@commission-split-fixture.test"
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, email); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_profiles WHERE id = $1`, userID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id = $1`, userID)
	})
	return userID
}

// seedReferralLink gives referrerID an active code, optionally pre-setting
// reward_count/reward_cap (0/100 if either is <0, meaning "use the default").
func seedReferralLink(t *testing.T, pool *pgxpool.Pool, referrerID string, rewardCount, rewardCap int) {
	t.Helper()
	ctx := context.Background()
	code := "TST" + uuid.NewString()[:5]
	if rewardCount < 0 {
		rewardCount = 0
	}
	if rewardCap < 0 {
		rewardCap = 100
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.referral_links (referrer_id, code, reward_count, reward_cap)
		VALUES ($1, $2, $3, $4)`,
		referrerID, code, rewardCount, rewardCap); err != nil {
		t.Fatalf("seed referral_links: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.referral_links WHERE referrer_id = $1`, referrerID)
	})
}

// seedAttribution attributes referredID to referrerID (isHouse=false) or to
// the house (isHouse=true, referrerID ignored).
func seedAttribution(t *testing.T, pool *pgxpool.Pool, referredID, referrerID string, isHouse bool) {
	t.Helper()
	ctx := context.Background()
	var err error
	if isHouse {
		_, err = pool.Exec(ctx, `
			INSERT INTO public.referral_attributions (referred_user_id, attribution_type, is_house)
			VALUES ($1, 'global_house', true)`, referredID)
	} else {
		_, err = pool.Exec(ctx, `
			INSERT INTO public.referral_attributions (referred_user_id, referrer_id, attribution_type, is_house)
			VALUES ($1, $2, 'code', false)`, referredID, referrerID)
	}
	if err != nil {
		t.Fatalf("seed referral_attributions: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.referral_attributions WHERE referred_user_id = $1`, referredID)
	})
}

func cleanupRewards(t *testing.T, pool *pgxpool.Pool, referrerID string) {
	t.Helper()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.referral_rewards WHERE referrer_id = $1`, referrerID)
	})
}

func earningFor(userID, module string, spotlightRevenueKobo int64) commission.Earning {
	return commission.Earning{
		ID:                   uuid.NewString(),
		ServiceCategory:      "test",
		Service:              "test",
		ServiceSubtype:       "test",
		GrossAmountKobo:      spotlightRevenueKobo * 10, // arbitrary — not used by commissionsplit
		SpotlightRevenueKobo: spotlightRevenueKobo,
		Currency:             "NGN",
		SourceModule:         module,
		SourceRef:            "ref-" + uuid.NewString()[:8],
		UserID:               &userID,
	}
}

func TestOnEarningRecorded_PaysReferrerTwentyPercent(t *testing.T) {
	pool := mustLivePool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	referrer := seedUser(t, pool)
	referred := seedUser(t, pool)
	seedReferralLink(t, pool, referrer, -1, -1)
	seedAttribution(t, pool, referred, referrer, false)
	cleanupRewards(t, pool, referrer)

	before, err := ledgerSvc.GetBalance(ctx, referrer)
	if err != nil {
		t.Fatalf("GetBalance before: %v", err)
	}

	svc := commissionsplit.NewService(pool, ledgerSvc, true)
	svc.OnEarningRecorded(ctx, earningFor(referred, "utility", 100_000)) // ₦1,000 commission

	after, err := ledgerSvc.GetBalance(ctx, referrer)
	if err != nil {
		t.Fatalf("GetBalance after: %v", err)
	}
	if got, want := after-before, int64(20_000); got != want { // 20% of ₦1,000
		t.Fatalf("referrer balance delta = %d, want %d", got, want)
	}

	var rewardCount int
	if err := pool.QueryRow(ctx, `SELECT reward_count FROM public.referral_links WHERE referrer_id = $1`, referrer).Scan(&rewardCount); err != nil {
		t.Fatalf("read reward_count: %v", err)
	}
	if rewardCount != 1 {
		t.Fatalf("reward_count = %d, want 1", rewardCount)
	}

	var status string
	var appliedRate float64
	if err := pool.QueryRow(ctx,
		`SELECT status, applied_rate FROM public.referral_rewards WHERE referrer_id = $1 AND referred_user_id = $2`,
		referrer, referred,
	).Scan(&status, &appliedRate); err != nil {
		t.Fatalf("read referral_rewards row: %v", err)
	}
	if status != "CREDITED" {
		t.Fatalf("reward status = %q, want CREDITED (the ledger credit succeeded, so the record must say so honestly)", status)
	}
	if appliedRate != 0.20 {
		t.Fatalf("applied_rate = %v, want 0.20 (flat, never tiered)", appliedRate)
	}
}

func TestOnEarningRecorded_HouseAttributedPayerEarnsNoOneAnything(t *testing.T) {
	pool := mustLivePool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	referred := seedUser(t, pool)
	seedAttribution(t, pool, referred, "", true) // house

	svc := commissionsplit.NewService(pool, ledgerSvc, true)
	svc.OnEarningRecorded(ctx, earningFor(referred, "utility", 100_000))

	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.referral_rewards WHERE referred_user_id = $1`, referred).Scan(&count); err != nil {
		t.Fatalf("count referral_rewards: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected zero reward rows for a house-attributed payer, got %d", count)
	}
}

func TestOnEarningRecorded_DefaultsToAdminOnceCodeIsRetired(t *testing.T) {
	pool := mustLivePool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	referrer := seedUser(t, pool)
	seedReferralLink(t, pool, referrer, 0, 2) // cap of 2, for a fast test
	cleanupRewards(t, pool, referrer)

	svc := commissionsplit.NewService(pool, ledgerSvc, true)

	// Three different referred users, all under the SAME code (the cap is
	// shared across everyone that code referred, not per referred user).
	referredA, referredB, referredC := seedUser(t, pool), seedUser(t, pool), seedUser(t, pool)
	seedAttribution(t, pool, referredA, referrer, false)
	seedAttribution(t, pool, referredB, referrer, false)
	seedAttribution(t, pool, referredC, referrer, false)

	before, _ := ledgerSvc.GetBalance(ctx, referrer)

	svc.OnEarningRecorded(ctx, earningFor(referredA, "utility", 100_000)) // #1 — rewarded
	svc.OnEarningRecorded(ctx, earningFor(referredB, "utility", 100_000)) // #2 — rewarded (hits cap)
	svc.OnEarningRecorded(ctx, earningFor(referredC, "utility", 100_000)) // #3 — retired, defaults to admin

	after, _ := ledgerSvc.GetBalance(ctx, referrer)
	if got, want := after-before, int64(40_000); got != want { // only 2 × 20% of ₦1,000
		t.Fatalf("referrer balance delta = %d, want %d (exactly 2 rewards, not 3)", got, want)
	}

	var rewardCount int
	if err := pool.QueryRow(ctx, `SELECT reward_count FROM public.referral_links WHERE referrer_id = $1`, referrer).Scan(&rewardCount); err != nil {
		t.Fatalf("read reward_count: %v", err)
	}
	if rewardCount != 2 {
		t.Fatalf("reward_count = %d, want 2 (capped, never exceeds reward_cap)", rewardCount)
	}

	var rewardRows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.referral_rewards WHERE referrer_id = $1`, referrer).Scan(&rewardRows); err != nil {
		t.Fatalf("count referral_rewards: %v", err)
	}
	if rewardRows != 2 {
		t.Fatalf("referral_rewards row count = %d, want 2 — the 3rd (retired) purchase must not write a reward row", rewardRows)
	}
}

func TestOnEarningRecorded_ReplayOfTheSameEarningNeverDoubleCredits(t *testing.T) {
	pool := mustLivePool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	referrer := seedUser(t, pool)
	referred := seedUser(t, pool)
	seedReferralLink(t, pool, referrer, -1, -1)
	seedAttribution(t, pool, referred, referrer, false)
	cleanupRewards(t, pool, referrer)

	svc := commissionsplit.NewService(pool, ledgerSvc, true)
	e := earningFor(referred, "utility", 100_000)

	before, _ := ledgerSvc.GetBalance(ctx, referrer)
	svc.OnEarningRecorded(ctx, e)
	svc.OnEarningRecorded(ctx, e) // exact replay — same e.ID, same everything
	after, _ := ledgerSvc.GetBalance(ctx, referrer)

	if got, want := after-before, int64(20_000); got != want {
		t.Fatalf("referrer balance delta = %d, want %d (a replay must never double-credit)", got, want)
	}

	var rewardCount int
	if err := pool.QueryRow(ctx, `SELECT reward_count FROM public.referral_links WHERE referrer_id = $1`, referrer).Scan(&rewardCount); err != nil {
		t.Fatalf("read reward_count: %v", err)
	}
	if rewardCount != 1 {
		t.Fatalf("reward_count = %d, want 1 (a replay must never re-increment the cap)", rewardCount)
	}
}

func TestOnEarningRecorded_DisabledFlagIsANoOp(t *testing.T) {
	pool := mustLivePool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	referrer := seedUser(t, pool)
	referred := seedUser(t, pool)
	seedReferralLink(t, pool, referrer, -1, -1)
	seedAttribution(t, pool, referred, referrer, false)

	svc := commissionsplit.NewService(pool, ledgerSvc, false) // disabled
	svc.OnEarningRecorded(ctx, earningFor(referred, "utility", 100_000))

	var rewardCount int
	if err := pool.QueryRow(ctx, `SELECT reward_count FROM public.referral_links WHERE referrer_id = $1`, referrer).Scan(&rewardCount); err != nil {
		t.Fatalf("read reward_count: %v", err)
	}
	if rewardCount != 0 {
		t.Fatalf("reward_count = %d, want 0 — a disabled hook must never touch anything", rewardCount)
	}
}
