package commissionsplit_test

// LIVE-DB suite for the catch-up Sweep: commission_earnings rows that were
// written without passing through commission.Service (the frontend-web utility
// path upserts the row directly, so the ReferralHook never fires) must still
// pay the referrer exactly once. SKIPPED whenever TEST_DATABASE_URL is unset.

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/referral/commissionsplit"
)

// backdateAttribution makes referredID's attribution predate any earning the
// test inserts, the way a real signup precedes a purchase.
func backdateAttribution(t *testing.T, pool *pgxpool.Pool, referredID string, ago time.Duration) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE public.referral_attributions SET created_at = now() - make_interval(secs => $2) WHERE referred_user_id = $1`,
		referredID, ago.Seconds()); err != nil {
		t.Fatalf("backdate attribution: %v", err)
	}
}

// insertDirectEarning writes a commission_earnings row the way the frontend-web
// utility path does: straight into the table, no hook, ledger_ref NULL.
func insertDirectEarning(t *testing.T, pool *pgxpool.Pool, userID string, revenueKobo int64, ago time.Duration) string {
	t.Helper()
	id := uuid.NewString()
	ref := uuid.NewString()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO public.commission_earnings
			(id, service_category, service, service_subtype, gross_amount_kobo, commission_kobo,
			 spotlight_revenue_kobo, currency, source_module, source_ref, user_id, idempotency_key, created_at)
		VALUES ($1, 'utility', 'Airtime', 'MTN', $2, $3, $3, 'NGN', 'utility', $4, $5, $4,
		        now() - make_interval(secs => $6))`,
		id, revenueKobo*30, revenueKobo, ref, userID, ago.Seconds()); err != nil {
		t.Fatalf("insert commission_earnings: %v", err)
	}
	return id
}

func rewardRows(t *testing.T, pool *pgxpool.Pool, earningID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM public.referral_rewards WHERE source_transaction_id = $1`,
		"commission:"+earningID).Scan(&n); err != nil {
		t.Fatalf("count referral_rewards: %v", err)
	}
	return n
}

func sweepOpts() commissionsplit.SweepOptions {
	return commissionsplit.SweepOptions{MinAge: 2 * time.Minute, Lookback: 7 * 24 * time.Hour, Limit: 500}
}

func TestSweep_PaysAMissedEarningExactlyOnce(t *testing.T) {
	pool := mustLivePool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	referrer := seedUser(t, pool)
	referred := seedUser(t, pool)
	seedReferralLink(t, pool, referrer, -1, -1)
	seedAttribution(t, pool, referred, referrer, false)
	backdateAttribution(t, pool, referred, time.Hour)
	cleanupRewards(t, pool, referrer)
	earningID := insertDirectEarning(t, pool, referred, 15_000, 10*time.Minute)

	before, err := ledgerSvc.GetBalance(ctx, referrer)
	if err != nil {
		t.Fatalf("GetBalance before: %v", err)
	}

	svc := commissionsplit.NewService(pool, ledgerSvc, true)
	for i := 0; i < 3; i++ { // repeated sweeps must not pay again
		if _, err := svc.Sweep(ctx, sweepOpts()); err != nil {
			t.Fatalf("Sweep #%d: %v", i+1, err)
		}
	}

	after, err := ledgerSvc.GetBalance(ctx, referrer)
	if err != nil {
		t.Fatalf("GetBalance after: %v", err)
	}
	if got, want := after-before, int64(3_000); got != want { // 20% of ₦150
		t.Fatalf("referrer balance delta = %d, want %d", got, want)
	}
	if n := rewardRows(t, pool, earningID); n != 1 {
		t.Fatalf("referral_rewards rows = %d, want 1", n)
	}
	var status string
	if err := pool.QueryRow(ctx,
		`SELECT status FROM public.referral_rewards WHERE source_transaction_id = $1`,
		"commission:"+earningID).Scan(&status); err != nil {
		t.Fatalf("read reward: %v", err)
	}
	if status != "CREDITED" {
		t.Fatalf("reward status = %q, want CREDITED", status)
	}
	var rewardCount int
	if err := pool.QueryRow(ctx, `SELECT reward_count FROM public.referral_links WHERE referrer_id = $1`, referrer).Scan(&rewardCount); err != nil {
		t.Fatalf("read reward_count: %v", err)
	}
	if rewardCount != 1 {
		t.Fatalf("reward_count = %d, want 1 (repeat sweeps must not burn cap slots)", rewardCount)
	}
}

func TestSweep_LeavesAnAlreadyRewardedEarningAlone(t *testing.T) {
	pool := mustLivePool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	referrer := seedUser(t, pool)
	referred := seedUser(t, pool)
	seedReferralLink(t, pool, referrer, -1, -1)
	seedAttribution(t, pool, referred, referrer, false)
	backdateAttribution(t, pool, referred, time.Hour)
	cleanupRewards(t, pool, referrer)
	earningID := insertDirectEarning(t, pool, referred, 15_000, 10*time.Minute)

	svc := commissionsplit.NewService(pool, ledgerSvc, true)
	if _, err := svc.Sweep(ctx, sweepOpts()); err != nil {
		t.Fatalf("first Sweep: %v", err)
	}
	mid, _ := ledgerSvc.GetBalance(ctx, referrer)

	// A second, independent service instance (another replica) sweeping again.
	if _, err := commissionsplit.NewService(pool, ledgerSvc, true).Sweep(ctx, sweepOpts()); err != nil {
		t.Fatalf("second Sweep: %v", err)
	}
	after, _ := ledgerSvc.GetBalance(ctx, referrer)
	if after != mid {
		t.Fatalf("second sweep moved money: %d -> %d", mid, after)
	}
	if n := rewardRows(t, pool, earningID); n != 1 {
		t.Fatalf("referral_rewards rows = %d, want 1", n)
	}
}

func TestSweep_SkipsHouseAndUnattributedPayers(t *testing.T) {
	pool := mustLivePool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	house := seedUser(t, pool)
	seedAttribution(t, pool, house, "", true)
	backdateAttribution(t, pool, house, time.Hour)
	houseEarning := insertDirectEarning(t, pool, house, 15_000, 10*time.Minute)

	orphan := seedUser(t, pool)
	orphanEarning := insertDirectEarning(t, pool, orphan, 15_000, 10*time.Minute)

	if _, err := commissionsplit.NewService(pool, ledgerSvc, true).Sweep(ctx, sweepOpts()); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if n := rewardRows(t, pool, houseEarning); n != 0 {
		t.Fatalf("house earning got %d reward rows, want 0", n)
	}
	if n := rewardRows(t, pool, orphanEarning); n != 0 {
		t.Fatalf("unattributed earning got %d reward rows, want 0", n)
	}
}

func TestSweep_SkipsAPurchaseMadeBeforeTheReferral(t *testing.T) {
	pool := mustLivePool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	referrer := seedUser(t, pool)
	referred := seedUser(t, pool)
	seedReferralLink(t, pool, referrer, -1, -1)
	// Earning 2h ago, attribution only 1h ago: the referrer did not own this
	// payer when the purchase happened, so the sweep must not pay them for it.
	earningID := insertDirectEarning(t, pool, referred, 15_000, 2*time.Hour)
	seedAttribution(t, pool, referred, referrer, false)
	backdateAttribution(t, pool, referred, time.Hour)
	cleanupRewards(t, pool, referrer)

	if _, err := commissionsplit.NewService(pool, ledgerSvc, true).Sweep(ctx, sweepOpts()); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if n := rewardRows(t, pool, earningID); n != 0 {
		t.Fatalf("pre-referral earning got %d reward rows, want 0", n)
	}
}

func TestSweep_SkipsEarningsYoungerThanMinAge(t *testing.T) {
	pool := mustLivePool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	referrer := seedUser(t, pool)
	referred := seedUser(t, pool)
	seedReferralLink(t, pool, referrer, -1, -1)
	seedAttribution(t, pool, referred, referrer, false)
	backdateAttribution(t, pool, referred, time.Hour)
	cleanupRewards(t, pool, referrer)
	// 10 seconds old: the live hook may still be mid-flight for this row.
	earningID := insertDirectEarning(t, pool, referred, 15_000, 10*time.Second)

	if _, err := commissionsplit.NewService(pool, ledgerSvc, true).Sweep(ctx, sweepOpts()); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if n := rewardRows(t, pool, earningID); n != 0 {
		t.Fatalf("too-young earning got %d reward rows, want 0", n)
	}
}

func TestSweep_DisabledFlagIsANoOp(t *testing.T) {
	pool := mustLivePool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	referrer := seedUser(t, pool)
	referred := seedUser(t, pool)
	seedReferralLink(t, pool, referrer, -1, -1)
	seedAttribution(t, pool, referred, referrer, false)
	backdateAttribution(t, pool, referred, time.Hour)
	cleanupRewards(t, pool, referrer)
	earningID := insertDirectEarning(t, pool, referred, 15_000, 10*time.Minute)

	res, err := commissionsplit.NewService(pool, ledgerSvc, false).Sweep(ctx, sweepOpts())
	if err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if res.Scanned != 0 {
		t.Fatalf("disabled sweep scanned %d rows, want 0", res.Scanned)
	}
	if n := rewardRows(t, pool, earningID); n != 0 {
		t.Fatalf("disabled sweep wrote %d reward rows, want 0", n)
	}
}

func TestSweep_CreditsAStrandedPendingRewardWithoutClaimingAnotherSlot(t *testing.T) {
	pool := mustLivePool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	referrer := seedUser(t, pool)
	referred := seedUser(t, pool)
	seedReferralLink(t, pool, referrer, 1, -1) // the stranded reward already holds slot 1
	cleanupRewards(t, pool, referrer)
	// A reward the live hook reserved but whose ledger credit failed.
	sourceTxn := "commission:" + uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.referral_rewards
			(referrer_id, referred_user_id, source_transaction_id, module, margin_kobo, applied_rate, reward_kobo, status, config_version, created_at)
		VALUES ($1, $2, $3, 'utility', 15000, 0.20, 3000, 'PENDING', 0, now() - interval '10 minutes')`,
		referrer, referred, sourceTxn); err != nil {
		t.Fatalf("seed pending reward: %v", err)
	}

	before, _ := ledgerSvc.GetBalance(ctx, referrer)
	svc := commissionsplit.NewService(pool, ledgerSvc, true)
	for i := 0; i < 2; i++ {
		if _, err := svc.Sweep(ctx, sweepOpts()); err != nil {
			t.Fatalf("Sweep #%d: %v", i+1, err)
		}
	}
	after, _ := ledgerSvc.GetBalance(ctx, referrer)
	if got, want := after-before, int64(3_000); got != want {
		t.Fatalf("referrer balance delta = %d, want %d", got, want)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM public.referral_rewards WHERE source_transaction_id = $1`, sourceTxn).Scan(&status); err != nil {
		t.Fatalf("read reward: %v", err)
	}
	if status != "CREDITED" {
		t.Fatalf("reward status = %q, want CREDITED", status)
	}
	var rewardCount int
	if err := pool.QueryRow(ctx, `SELECT reward_count FROM public.referral_links WHERE referrer_id = $1`, referrer).Scan(&rewardCount); err != nil {
		t.Fatalf("read reward_count: %v", err)
	}
	if rewardCount != 1 {
		t.Fatalf("reward_count = %d, want 1 (a retry must not claim a new slot)", rewardCount)
	}
}

func TestSweep_SkipsEarningsUnderARetiredCode(t *testing.T) {
	pool := mustLivePool(t)
	ctx := context.Background()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	referrer := seedUser(t, pool)
	referred := seedUser(t, pool)
	seedReferralLink(t, pool, referrer, 5, 5) // at cap
	seedAttribution(t, pool, referred, referrer, false)
	backdateAttribution(t, pool, referred, time.Hour)
	cleanupRewards(t, pool, referrer)
	earningID := insertDirectEarning(t, pool, referred, 15_000, 10*time.Minute)

	if _, err := commissionsplit.NewService(pool, ledgerSvc, true).Sweep(ctx, sweepOpts()); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if n := rewardRows(t, pool, earningID); n != 0 {
		t.Fatalf("retired-code earning got %d reward rows, want 0", n)
	}
	var rewardCount int
	if err := pool.QueryRow(ctx, `SELECT reward_count FROM public.referral_links WHERE referrer_id = $1`, referrer).Scan(&rewardCount); err != nil {
		t.Fatalf("read reward_count: %v", err)
	}
	if rewardCount != 5 {
		t.Fatalf("reward_count = %d, want 5", rewardCount)
	}
}
