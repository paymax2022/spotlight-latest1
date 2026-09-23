package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB regressions for two UAT-found defects in the crowdfunding money path
// (Crowdfunding module, UAT queue position 5).
//
// 1. GetWallet's AvailableKobo used to be derived from the FULL gross raised
//    total (released − withdrawn − pending), with no accounting for the 10%
//    platform fee Contribute() already deducts via settlement.Settle before
//    the money ever reaches the creator's own ledger wallet. A campaign that
//    raised 1,000,000 kobo reported 1,000,000 "available" while only 900,000
//    ever landed in the creator's withdrawable balance — a creator requesting
//    the full displayed amount passed this function's own check and then hit
//    an unexplained "insufficient funds" from SubmitWithdrawal's ledger.Debit,
//    which checks the SAME account this now reads directly.
//
// 2. RefundAll returned a bare {"ok": true} regardless of how many
//    contributions it actually refunded. Since Contribute() settles nearly
//    every contribution to 'released' immediately (see that function's own
//    comment), a campaign refund on the normal path refunds NOTHING — but the
//    old response gave no way to tell "everyone got their money back" apart
//    from "nobody did, it had already been paid out". The campaign was also
//    silently marked 'failed' either way.
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL. See
// campaign_analytics_live_db_test.go in this package for the pattern this
// file follows.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Withdraw -v
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Refund -v
// ---------------------------------------------------------------------------

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
func seedFundedContribution(t *testing.T, ctx context.Context, pool *pgxpool.Pool, goalKobo, contributeKobo int64) (campaignID, creatorID string, cfSvc *crowdfunding.Service, walletSvc *cfwallet.Service) {
	t.Helper()

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	cfSvc = crowdfunding.NewService(pool, ledgerSvc, settlementSvc)
	walletSvc = cfwallet.NewService(pool).WithLedger(ledgerSvc)

	creatorID = uuid.NewString()
	contributorID := uuid.NewString()
	campaignID = uuid.NewString()
	testsupport.CleanupUsers(t, pool, creatorID, contributorID)

	for _, id := range []string{creatorID, contributorID} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')
			ON CONFLICT (id) DO NOTHING`, id, "cf-uat-"+id+"@test.local"); err != nil {
			t.Fatalf("seed user %s: %v", id, err)
		}
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, deadline)
		VALUES ($1, $2, 'Withdrawal/refund fixture', $3, 'active', 'ACTIVE', NOW() + INTERVAL '30 days')`,
		campaignID, creatorID, goalKobo); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	t.Cleanup(func() {
		mustExec := func(what, sql string, args ...any) {
			if _, err := pool.Exec(ctx, sql, args...); err != nil {
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

	contrib, err := cfSvc.Contribute(ctx, campaignID, contributorID, crowdfunding.ContributeRequest{
		AmountKobo:     contributeKobo,
		IdempotencyKey: "cf-uat-contrib-" + campaignID,
	})
	if err != nil {
		t.Fatalf("contribute: %v", err)
	}
	if contrib.Status != "released" {
		t.Fatalf("precondition failed: contribution status = %q, want 'released' (instant-settle) — the fixture assumes the normal happy path", contrib.Status)
	}

	return campaignID, creatorID, cfSvc, walletSvc
}

// TestLiveDB_Withdraw_AvailableMatchesRealLedgerBalanceNotGrossRaised pins the
// fix: AvailableKobo must equal the creator's real withdrawable ledger
// balance (net of the platform fee), never the gross contribution total.
func TestLiveDB_Withdraw_AvailableMatchesRealLedgerBalanceNotGrossRaised(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	const contributeKobo = 1_000_000 // 90/10 split -> 900,000 net to creator
	campaignID, creatorID, _, walletSvc := seedFundedContribution(t, ctx, pool, 5_000_000, contributeKobo)

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

// TestLiveDB_Refund_ReportsZeroWhenContributionsAlreadySettled pins the
// second fix: refunding a campaign whose contributions already instant-
// settled must honestly report zero refunded, not a bare success.
func TestLiveDB_Refund_ReportsZeroWhenContributionsAlreadySettled(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	campaignID, creatorID, cfSvc, _ := seedFundedContribution(t, ctx, pool, 5_000_000, 100_000)

	result, err := cfSvc.RefundAll(ctx, campaignID, creatorID)
	if err != nil {
		t.Fatalf("refund: %v", err)
	}
	if result.RefundedCount != 0 {
		t.Errorf("RefundedCount = %d, want 0 — the contribution had already instant-settled, nothing was left in escrow", result.RefundedCount)
	}
	if result.RefundedKobo != 0 {
		t.Errorf("RefundedKobo = %d, want 0", result.RefundedKobo)
	}

	// Existing behavior preserved: the campaign is still marked failed/
	// cancelled even when there was nothing to refund.
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM campaigns WHERE id = $1`, campaignID).Scan(&status); err != nil {
		t.Fatalf("read campaign status: %v", err)
	}
	if status != "failed" {
		t.Errorf("campaign status = %q, want 'failed'", status)
	}

	// The already-released contribution must be untouched — not silently
	// flipped to 'refunded' when no money actually moved.
	var contribStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM contributions WHERE campaign_id = $1`, campaignID).Scan(&contribStatus); err != nil {
		t.Fatalf("read contribution status: %v", err)
	}
	if contribStatus != "released" {
		t.Errorf("contribution status = %q, want 'released' (unchanged)", contribStatus)
	}
}

// The positive case — RefundAll actually refunding a contribution genuinely
// stuck in 'escrowed' (a failed instant-settle) — is deliberately NOT covered
// here with a fabricated settlements/contributions row: doing that without
// going through the real Escrow() debit would credit the shared AccountEscrow
// standing account without a matching prior debit, polluting its balance for
// any other session reading it on this shared local database. RefundAll's
// refund-execution loop itself is unchanged by this fix (only the counting/
// reporting around it changed) and already has coverage via settlement's own
// Refund() path; the two tests above are what this fix actually needs.
