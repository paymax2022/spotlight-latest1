package crowdfunding_test

// LIVE-DB regressions for two UAT-found defects in the crowdfunding money path
// (Crowdfunding module, UAT queue position 5).
// 1. GetWallet's AvailableKobo used to be derived from the FULL gross raised
//    total (released − withdrawn − pending), with no accounting for the 10%
//    platform fee Contribute() already deducts via settlement.Settle before
//    the money ever reaches the creator's own ledger wallet. A campaign that
//    raised 1,000,000 kobo reported 1,000,000 "available" while only 900,000
//    ever landed in the creator's withdrawable balance — a creator requesting
//    the full displayed amount passed this function's own check and then hit
//    an unexplained "insufficient funds" from SubmitWithdrawal's ledger.Debit,
//    which checks the SAME account this now reads directly.
// 2. RefundAll returned a bare {"ok": true} regardless of how many
//    contributions it actually refunded. Since Contribute() settles nearly
//    every contribution to 'released' immediately (see that function's own
//    comment), a campaign refund on the normal path refunds NOTHING — but the
//    old response gave no way to tell "everyone got their money back" apart
//    from "nobody did, it had already been paid out". The campaign was also
//    silently marked 'failed' either way.
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL. See
// campaign_analytics_live_db_test.go in this package for the pattern this
// file follows.
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Withdraw -v
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Refund -v

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/crowdfunding"
	cfwallet "spotlight/backend/internal/crowdfunding/wallet"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

func moneyPathPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB crowdfunding money-path test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedFundedContribution creates a real creator + contributor + active
// campaign, funds the contributor's ledger wallet with a real CREDIT/DEBIT
// pair (standing in for a top-up rail), and posts one real Contribute() call
// through the actual service (not a raw INSERT) — so the instant-settle split
// this test pins really ran. Returns the campaign id, creator id, and the
// crowdfunding/wallet services wired against the same pool.
// fundedFixture carries the ids + services seedFundedContribution returns —
// a struct because the tuple grew past what blank-identifier unpacking could
// carry readably.
type fundedFixture struct {
	campaignID    string
	creatorID     string
	contributorID string
	cfSvc         *crowdfunding.Service
	walletSvc     *cfwallet.Service
}

func seedFundedContribution(t *testing.T, ctx context.Context, pool *pgxpool.Pool, goalKobo, contributeKobo int64) fundedFixture {
	t.Helper()

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	fx := fundedFixture{
		creatorID:     uuid.NewString(),
		contributorID: uuid.NewString(),
		campaignID:    uuid.NewString(),
		cfSvc:         crowdfunding.NewService(pool, ledgerSvc, settlementSvc),
		walletSvc:     cfwallet.NewService(pool).WithLedger(ledgerSvc),
	}
	creatorID, contributorID, campaignID := fx.creatorID, fx.contributorID, fx.campaignID
	testsupport.CleanupUsers(t, pool, creatorID, contributorID)

	for _, id := range []string{creatorID, contributorID} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')
			ON CONFLICT (id) DO NOTHING`, id, "cf-uat-"+id+"@test.local"); err != nil {
			t.Fatalf("seed user %s: %v", id, err)
		}
		testsupport.SetKycTier(t, ctx, pool, id, testsupport.KycTierUnlimited)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, deadline)
		VALUES ($1, $2, 'Withdrawal/refund fixture', $3, 'active', 'ACTIVE', NOW() + INTERVAL '30 days')`,
		campaignID, creatorID, goalKobo); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	t.Cleanup(func() {
		mustExec := func(what, sql string, args ...any) {
			if _, err := pool.Exec(context.WithoutCancel(ctx), sql, args...); err != nil {
				t.Errorf("cleanup %s: %v (fixture rows may be left in the database)", what, err)
			}
		}
		mustExec("withdrawals", `DELETE FROM cf_withdrawals WHERE campaign_id = $1`, campaignID)
		mustExec("bank accounts", `DELETE FROM cf_bank_accounts WHERE user_id = $1`, creatorID)
		mustExec("contributions", `DELETE FROM contributions WHERE campaign_id = $1`, campaignID)
		mustExec("campaign", `DELETE FROM campaigns WHERE id = $1`, campaignID)
	})

	// Fund the contributor's ledger wallet directly (standing in for a real
	// top-up rail) so Contribute()'s escrow debit has real money to move.
	contributorWallet, err := ledgerSvc.GetOrCreateUserWallet(ctx, contributorID)
	if err != nil {
		t.Fatalf("get contributor wallet: %v", err)
	}
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("get clearing account: %v", err)
	}
	fundRef := "cf-uat-fund-" + campaignID
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key, description)
		VALUES
			($1, 'CREDIT', $3, $4, $5, 'UAT test fund'),
			($2, 'DEBIT',  $3, $4, $6, 'UAT test fund')`,
		contributorWallet.ID, clearing.ID, contributeKobo+100, fundRef,
		fundRef+":credit", fundRef+":debit"); err != nil {
		t.Fatalf("fund contributor wallet: %v", err)
	}

	contrib, err := fx.cfSvc.Contribute(ctx, campaignID, contributorID, crowdfunding.ContributeRequest{
		AmountKobo:     contributeKobo,
		IdempotencyKey: "cf-uat-contrib-" + campaignID,
	})
	if err != nil {
		t.Fatalf("contribute: %v", err)
	}
	if contrib.Status != "released" {
		t.Fatalf("precondition failed: contribution status = %q, want 'released' (instant-settle) — the fixture assumes the normal happy path", contrib.Status)
	}

	return fx
}

// TestLiveDB_Withdraw_AvailableMatchesRealLedgerBalanceNotGrossRaised pins the
// fix: AvailableKobo must equal the creator's real withdrawable ledger
// balance (net of the platform fee), never the gross contribution total.
func TestLiveDB_Withdraw_AvailableMatchesRealLedgerBalanceNotGrossRaised(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	const contributeKobo = 1_000_000 // 90/10 split -> 900,000 net to creator
	fx := seedFundedContribution(t, ctx, pool, 5_000_000, contributeKobo)
	campaignID, creatorID, walletSvc := fx.campaignID, fx.creatorID, fx.walletSvc

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	realBalance, err := ledgerSvc.GetBalance(ctx, creatorID)
	if err != nil {
		t.Fatalf("get real creator balance: %v", err)
	}
	if realBalance != 900_000 {
		t.Fatalf("test setup: creator real balance = %d, want 900000 (90%% of %d) — fixture assumption broken", realBalance, contributeKobo)
	}

	summary, err := walletSvc.GetWallet(ctx, campaignID)
	if err != nil {
		t.Fatalf("get wallet: %v", err)
	}

	if summary.AvailableKobo != realBalance {
		t.Errorf("AvailableKobo = %d, want %d (the creator's real ledger balance) — this is the exact overstatement bug: reporting the gross %d instead",
			summary.AvailableKobo, realBalance, summary.TotalRaisedKobo)
	}
	if summary.AvailableKobo == summary.TotalRaisedKobo {
		t.Errorf("AvailableKobo (%d) must not equal TotalRaisedKobo (%d) once a platform fee has been taken — the whole point of this fix",
			summary.AvailableKobo, summary.TotalRaisedKobo)
	}
}

// TestLiveDB_Refund_ClawbackMakesBackerWholeOnFailedCampaign pins the
// E2E-COM-004 fix: instant-settle means nearly every real contribution is
// 'released' with a 'settled' settlement, so the old escrowed-only gate
// refunded ₦0 while marking the campaign failed. RefundAll must now claw the
// settled split back — DR creator wallet (90%) + DR paymax_revenue (10%) /
// CR backer wallet (gross) — so the backer is made whole at GROSS.
func TestLiveDB_Refund_ClawbackMakesBackerWholeOnFailedCampaign(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	const contributeKobo = 100_000 // 90/10 split -> 90,000 to creator, 10,000 fee
	fx := seedFundedContribution(t, ctx, pool, 5_000_000, contributeKobo)
	campaignID, creatorID, contributorID, cfSvc := fx.campaignID, fx.creatorID, fx.contributorID, fx.cfSvc

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	backerBefore, err := ledgerSvc.GetBalance(ctx, contributorID)
	if err != nil {
		t.Fatalf("backer balance: %v", err)
	}
	if backerBefore != 100 { // fixture funds contributeKobo+100 then contributes contributeKobo
		t.Fatalf("test setup: backer balance = %d, want 100 after contributing %d", backerBefore, contributeKobo)
	}

	var contributionID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM contributions WHERE campaign_id = $1`, campaignID).Scan(&contributionID); err != nil {
		t.Fatalf("read contribution: %v", err)
	}

	result, err := cfSvc.RefundAll(ctx, campaignID, creatorID)
	if err != nil {
		t.Fatalf("refund: %v", err)
	}
	if result.RefundedCount != 1 {
		t.Errorf("RefundedCount = %d, want 1 — a released contribution is refundable via clawback", result.RefundedCount)
	}
	if result.RefundedKobo != contributeKobo {
		t.Errorf("RefundedKobo = %d, want %d (the full gross)", result.RefundedKobo, contributeKobo)
	}
	if result.FailedCount != 0 {
		t.Errorf("FailedCount = %d, want 0", result.FailedCount)
	}

	// Money actually moved: backer restored at gross, creator clawed back to 0.
	if got, err := ledgerSvc.GetBalance(ctx, contributorID); err != nil || got != contributeKobo+100 {
		t.Errorf("backer balance after refund = %d, want %d (gross restored) err=%v", got, contributeKobo+100, err)
	}
	if got, err := ledgerSvc.GetBalance(ctx, creatorID); err != nil || got != 0 {
		t.Errorf("creator balance after clawback = %d, want 0 (90%% leg reversed) err=%v", got, err)
	}

	// The reversal legs are BALANCED double-entry under cf:refund:<id>.
	debits, credits := refundLegs(t, ctx, pool, "cf:refund:"+contributionID+"%")
	if debits != contributeKobo || credits != contributeKobo {
		t.Errorf("clawback legs: debits=%d credits=%d, want both %d", debits, credits, contributeKobo)
	}

	// Campaign + contribution + settlement reached their terminal states.
	var status, contribStatus, settStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM campaigns WHERE id = $1`, campaignID).Scan(&status); err != nil {
		t.Fatalf("read campaign status: %v", err)
	}
	if status != "failed" {
		t.Errorf("campaign status = %q, want 'failed'", status)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM contributions WHERE campaign_id = $1`, campaignID).Scan(&contribStatus); err != nil {
		t.Fatalf("read contribution status: %v", err)
	}
	if contribStatus != "refunded" {
		t.Errorf("contribution status = %q, want 'refunded'", contribStatus)
	}
	if err := pool.QueryRow(ctx, `SELECT st.status FROM settlements st JOIN contributions co ON co.settlement_id = st.id WHERE co.id = $1`, contributionID).Scan(&settStatus); err != nil {
		t.Fatalf("read settlement status: %v", err)
	}
	if settStatus != "refunded" {
		t.Errorf("settlement status = %q, want 'refunded'", settStatus)
	}

	// Replay is a safe no-op: campaign is already 'failed' and the
	// contribution is no longer in the refundable set — zero new legs.
	d0, c0 := refundLegs(t, ctx, pool, "cf:refund:"+contributionID+"%")
	if _, err := cfSvc.RefundAll(ctx, campaignID, creatorID); err != nil {
		t.Fatalf("second refund call: %v", err)
	}
	d1, c1 := refundLegs(t, ctx, pool, "cf:refund:"+contributionID+"%")
	if d1 != d0 || c1 != c0 {
		t.Errorf("replay posted extra legs: (%d,%d) → (%d,%d)", d0, c0, d1, c1)
	}
}

// TestLiveDB_Refund_ReportsFailureWhenCreatorAlreadyCashedOut pins the
// fail-closed side of the clawback: the backer is NOT credited money that
// does not exist. When the creator's wallet no longer holds the payout the
// refund is reported via FailedCount/UnrefundedKobo rather than aborting or
// fabricating a credit.
func TestLiveDB_Refund_ReportsFailureWhenCreatorAlreadyCashedOut(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	const contributeKobo = 100_000
	fx := seedFundedContribution(t, ctx, pool, 5_000_000, contributeKobo)
	campaignID, creatorID, contributorID, cfSvc := fx.campaignID, fx.creatorID, fx.contributorID, fx.cfSvc

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	// Drain the creator's wallet exactly the way a completed withdrawal does —
	// a balanced debit to the clearing account — so the clawback leg finds no
	// funds to reverse.
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("resolve clearing: %v", err)
	}
	if err := ledgerSvc.Debit(ctx, creatorID, "cf-test-drain:"+campaignID, "cf-test-drain:"+campaignID, clearing.ID, 90_000); err != nil {
		t.Fatalf("drain creator wallet (fixture emulates a completed withdrawal): %v", err)
	}

	result, err := cfSvc.RefundAll(ctx, campaignID, creatorID)
	if err != nil {
		t.Fatalf("refund: %v", err)
	}
	if result.RefundedCount != 0 {
		t.Errorf("RefundedCount = %d, want 0 — the clawback must fail closed", result.RefundedCount)
	}
	if result.FailedCount != 1 || result.UnrefundedKobo != contributeKobo {
		t.Errorf("FailedCount/UnrefundedKobo = %d/%d, want 1/%d — the unrecoverable debt must be reported, not hidden",
			result.FailedCount, result.UnrefundedKobo, contributeKobo)
	}
	if got, _ := ledgerSvc.GetBalance(ctx, contributorID); got != 100 {
		t.Errorf("backer balance = %d, want 100 — no fabricated credit", got)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM campaigns WHERE id = $1`, campaignID).Scan(&status); err != nil {
		t.Fatalf("read campaign status: %v", err)
	}
	if status != "failed" {
		t.Errorf("campaign status = %q, want 'failed'", status)
	}
}

// refundLegs sums the DEBIT-side and CREDIT-side ledger legs under a
// reference LIKE pattern — the balanced-double-entry assertion for the refund
// clawback (mirrors the e2e helper ledgerTotalsByRef).
func refundLegs(t *testing.T, ctx context.Context, pool *pgxpool.Pool, refLike string) (int64, int64) {
	t.Helper()
	var debits, credits int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN type IN ('DEBIT','REVERSAL_CREDIT') THEN amount_kobo ELSE 0 END),0),
		       COALESCE(SUM(CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo ELSE 0 END),0)
		  FROM ledger_entries WHERE reference LIKE $1`, refLike).Scan(&debits, &credits)
	if err != nil {
		t.Fatalf("refund legs: %v", err)
	}
	return debits, credits
}
