package crowdfunding_test

// LIVE-DB regressions for the caller-scoped idempotency replay fix
// (issue #500 class — caller-scoped replay + crash windows).
//
// Four money-path replay lookups used to match on idempotency_key ALONE:
// a member reusing a key that ANOTHER member already claimed got the other
// member's row replayed back (amounts, references, holdings), and a concurrent
// foreign-key insert surfaced a raw 500 unique_violation. The lookups are now
// caller-scoped and the unique-constraint clash maps to
// ErrIdempotencyKeyConflict → 409 "idempotency_key_conflict" — the wave-6 M16
// convention from finance/transfers.
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL. See
// campaign_analytics_live_db_test.go in this package for the pattern.
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_IdempotencyScope -v

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/crowdfunding"
	cfcsr "spotlight/backend/internal/crowdfunding/csr"
	cfinvestment "spotlight/backend/internal/crowdfunding/investment"
	cfwallet "spotlight/backend/internal/crowdfunding/wallet"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

// seedUser inserts a minimal auth.users row at the unlimited KYC tier so the
// tier gate passes, and registers cleanup.
func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, prefix string) string {
	t.Helper()
	id := uuid.NewString()
	testsupport.CleanupUsers(t, pool, id)
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, id, prefix+"-"+id+"@test.local"); err != nil {
		t.Fatalf("seed user %s: %v", id, err)
	}
	testsupport.SetKycTier(t, ctx, pool, id, testsupport.KycTierUnlimited)
	return id
}

// fundWallet credits a user's ledger wallet with a balanced pair, standing in
// for a real top-up rail — same pattern as contribute_idempotency_live_db_test.
func fundWallet(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ledgerSvc *financeledger.Service, userID string, amountKobo int64, ref string) {
	t.Helper()
	wallet, err := ledgerSvc.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		t.Fatalf("get wallet %s: %v", userID, err)
	}
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("get clearing account: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key, description)
		VALUES
			($1, 'CREDIT', $3, $4, $5, 'scope test fund'),
			($2, 'DEBIT',  $3, $4, $6, 'scope test fund')`,
		wallet.ID, clearing.ID, amountKobo, ref, ref+":credit", ref+":debit"); err != nil {
		t.Fatalf("fund wallet %s: %v", userID, err)
	}
}

// TestLiveDB_IdempotencyScope_ContributeForeignKeyConflicts: member B reusing
// member A's contribution key must get 409-sentinel, never A's row, and must
// never move B's money (the ledger leg dedup makes B's debit a no-op before
// the contributions unique constraint fires).
func TestLiveDB_IdempotencyScope_ContributeForeignKeyConflicts(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	cfSvc := crowdfunding.NewService(pool, ledgerSvc, settlementSvc)

	creatorID := seedUser(t, ctx, pool, "cf-scope-creator")
	contributorA := seedUser(t, ctx, pool, "cf-scope-a")
	contributorB := seedUser(t, ctx, pool, "cf-scope-b")
	campaignID := uuid.NewString()

	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, deadline)
		VALUES ($1, $2, 'Idempotency scope fixture', 5000000, 'active', 'ACTIVE', NOW() + INTERVAL '30 days')`,
		campaignID, creatorID); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM contributions WHERE campaign_id = $1`, campaignID)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM campaigns WHERE id = $1`, campaignID)
	})

	// Fund BOTH contributors — B must have the balance to reach the escrow
	// ledger leg (an underfunded B is refused earlier on insufficient funds,
	// which is also safe but isn't the path under test).
	fundWallet(t, ctx, pool, ledgerSvc, contributorA, 1_000_000, "cf-scope-fund-a-"+campaignID)
	fundWallet(t, ctx, pool, ledgerSvc, contributorB, 1_000_000, "cf-scope-fund-b-"+campaignID)

	idemKey := "cf-scope-key-" + campaignID
	first, err := cfSvc.Contribute(ctx, campaignID, contributorA, crowdfunding.ContributeRequest{
		AmountKobo:     250_000,
		IdempotencyKey: idemKey,
	})
	if err != nil {
		t.Fatalf("first contribute: %v", err)
	}

	// Foreign-key reuse: B under A's key. Must be the 409 sentinel — never a
	// replay of A's contribution, never a raw 23505, and never a second debit.
	_, err = cfSvc.Contribute(ctx, campaignID, contributorB, crowdfunding.ContributeRequest{
		AmountKobo:     250_000,
		IdempotencyKey: idemKey,
	})
	if !errors.Is(err, crowdfunding.ErrIdempotencyKeyConflict) {
		t.Fatalf("foreign-key Contribute must return ErrIdempotencyKeyConflict, got %v", err)
	}

	// No row was recorded for B under the reused key; B's money never moved
	// (the ledger legs under "<key>:escrow" deduped to A's).
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM contributions WHERE idempotency_key = $1`, idemKey).Scan(&count); err != nil {
		t.Fatalf("count contributions: %v", err)
	}
	if count != 1 {
		t.Errorf("contributions under the key = %d, want 1", count)
	}
	if bal, err := ledgerSvc.GetBalance(ctx, contributorB); err != nil || bal != 1_000_000 {
		t.Errorf("contributor B balance = %d (err %v), want 1000000 — a refused foreign-key reuse must not debit", bal, err)
	}

	// The owner still replays their own key to the original row.
	replay, err := cfSvc.Contribute(ctx, campaignID, contributorA, crowdfunding.ContributeRequest{
		AmountKobo:     250_000,
		IdempotencyKey: idemKey,
	})
	if err != nil {
		t.Fatalf("owner replay: %v", err)
	}
	if replay.ID != first.ID {
		t.Errorf("owner replay returned a different contribution %s vs %s", replay.ID, first.ID)
	}
}

// TestLiveDB_IdempotencyScope_WithdrawalForeignKeyConflicts: creator B reusing
// creator A's withdrawal key on B's own campaign must get the 409 sentinel,
// never A's withdrawal (which would leak the bank label + amount), and must
// not file a second cf_withdrawals row.
func TestLiveDB_IdempotencyScope_WithdrawalForeignKeyConflicts(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	// Two independent funded fixtures → two creators, each with a settled
	// contribution balance and their own campaign.
	fxA := seedFundedContribution(t, ctx, pool, 5_000_000, 1_000_000)
	fxB := seedFundedContribution(t, ctx, pool, 5_000_000, 1_000_000)

	bankA, bankB := uuid.NewString(), uuid.NewString()
	for _, pair := range [][2]string{{fxA.creatorID, bankA}, {fxB.creatorID, bankB}} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO cf_bank_accounts (id, user_id, bank_name, account_number_masked, account_name, is_default)
			VALUES ($1, $2, 'Test Bank', '****0000', 'Scope Fixture', true)`,
			pair[1], pair[0]); err != nil {
			t.Fatalf("seed bank account: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM cf_bank_accounts WHERE id = ANY($1)`, []string{bankA, bankB})
	})

	idemKey := "cf-scope-wd-" + uuid.NewString()
	in := cfwallet.WithdrawalRequestInput{AmountKobo: 100_000, BankAccountID: bankA}

	first, err := fxA.walletSvc.SubmitWithdrawal(ctx, fxA.creatorID, fxA.campaignID, idemKey, in)
	if err != nil {
		t.Fatalf("first withdrawal: %v", err)
	}

	// Foreign-key reuse on a DIFFERENT creator's own campaign.
	_, err = fxB.walletSvc.SubmitWithdrawal(ctx, fxB.creatorID, fxB.campaignID, idemKey,
		cfwallet.WithdrawalRequestInput{AmountKobo: 100_000, BankAccountID: bankB})
	if !errors.Is(err, cfwallet.ErrIdempotencyKeyConflict) {
		t.Fatalf("foreign-key SubmitWithdrawal must return ErrIdempotencyKeyConflict, got %v", err)
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM cf_withdrawals WHERE idempotency_key = $1`, idemKey).Scan(&count); err != nil {
		t.Fatalf("count withdrawals: %v", err)
	}
	if count != 1 {
		t.Errorf("cf_withdrawals under the key = %d, want 1", count)
	}

	// The owner still replays their own key to the original request.
	replay, err := fxA.walletSvc.SubmitWithdrawal(ctx, fxA.creatorID, fxA.campaignID, idemKey, in)
	if err != nil {
		t.Fatalf("owner replay: %v", err)
	}
	if replay.ID != first.ID {
		t.Errorf("owner replay returned a different withdrawal %s vs %s", replay.ID, first.ID)
	}
}

// TestLiveDB_IdempotencyScope_InvestForeignKeyConflicts: investor B reusing
// investor A's subscribe key must get the 409 sentinel and must not receive
// A's certificate back (nor mint a second subscription row).
func TestLiveDB_IdempotencyScope_InvestForeignKeyConflicts(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	invSvc := cfinvestment.NewService(pool)

	investorA := seedUser(t, ctx, pool, "cf-scope-inv-a")
	investorB := seedUser(t, ctx, pool, "cf-scope-inv-b")
	offerID := uuid.NewString()

	if _, err := pool.Exec(ctx, `
		INSERT INTO cf_investment_offers
			(id, title, issuer_name, model, target_kobo, min_ticket_kobo, status)
		VALUES ($1, 'Scope Test Offer', 'Scope Issuer Ltd', 'EQUITY', 100000000, 10000, 'OPEN')`,
		offerID); err != nil {
		t.Fatalf("seed offer: %v", err)
	}
	for _, id := range []string{investorA, investorB} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO cf_investor_profiles
				(user_id, onboarded, kyc_complete, education_complete, quiz_passed, risk_profile)
			VALUES ($1, TRUE, TRUE, TRUE, TRUE, 'BALANCED')`, id); err != nil {
			t.Fatalf("seed investor profile %s: %v", id, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM cf_investment_subscriptions WHERE offer_id = $1`, offerID)
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM cf_investor_profiles WHERE user_id = ANY($1)`, []string{investorA, investorB})
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM cf_investment_offers WHERE id = $1`, offerID)
	})

	idemKey := "cf-scope-inv-" + uuid.NewString()
	in := cfinvestment.InvestmentSubscriptionInput{
		OfferID: offerID, AmountKobo: 5_000_000, AcceptedRisk: true, AcceptedAgreement: true,
	}

	first, err := invSvc.Subscribe(ctx, investorA, in, idemKey)
	if err != nil {
		t.Fatalf("first subscribe: %v", err)
	}

	_, err = invSvc.Subscribe(ctx, investorB, in, idemKey)
	if !errors.Is(err, cfinvestment.ErrIdempotencyKeyConflict) {
		t.Fatalf("foreign-key Subscribe must return ErrIdempotencyKeyConflict, got %v", err)
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM cf_investment_subscriptions WHERE idempotency_key = $1`, idemKey).Scan(&count); err != nil {
		t.Fatalf("count subscriptions: %v", err)
	}
	if count != 1 {
		t.Errorf("subscriptions under the key = %d, want 1", count)
	}

	// The owner still replays their own key to the original certificate.
	replay, err := invSvc.Subscribe(ctx, investorA, in, idemKey)
	if err != nil {
		t.Fatalf("owner replay: %v", err)
	}
	if replay.ID != first.ID {
		t.Errorf("owner replay returned a different certificate %s vs %s", replay.ID, first.ID)
	}
}

// TestLiveDB_IdempotencyScope_CsrMatchForeignKeyConflicts: sponsor B reusing
// sponsor A's cf_csr_matches key must get the 409 sentinel, never A's match row
// (which would leak campaign, cap and visibility), and B's budget reservation
// must roll back with the refused insert.
func TestLiveDB_IdempotencyScope_CsrMatchForeignKeyConflicts(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	csrSvc := cfcsr.NewService(pool)

	creatorID := seedUser(t, ctx, pool, "cf-scope-csr-creator")
	sponsorA := seedUser(t, ctx, pool, "cf-scope-csr-a")
	sponsorB := seedUser(t, ctx, pool, "cf-scope-csr-b")
	campaignID := uuid.NewString()

	// SetupMatch requires an ACTIVE + verified campaign.
	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, verified, deadline)
		VALUES ($1, $2, 'CSR scope fixture', 5000000, 'active', 'ACTIVE', TRUE, NOW() + INTERVAL '30 days')`,
		campaignID, creatorID); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	// Both sponsors carry enough annual budget that B reaches the insert leg
	// (a budget refusal is also safe but isn't the path under test).
	for _, id := range []string{sponsorA, sponsorB} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO cf_csr_profiles (user_id, company_name, annual_budget_kobo)
			VALUES ($1, 'Scope Corp', 10000000)`, id); err != nil {
			t.Fatalf("seed csr profile %s: %v", id, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM cf_csr_matches WHERE campaign_id = $1`, campaignID)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM cf_csr_profiles WHERE user_id = ANY($1)`, []string{sponsorA, sponsorB})
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM campaigns WHERE id = $1`, campaignID)
	})

	idemKey := "cf-scope-csr-" + uuid.NewString()
	in := cfcsr.MatchSetupInput{
		CampaignID: campaignID, Ratio: "1:1", CapKobo: 500_000, Visibility: "PUBLIC",
	}

	first, err := csrSvc.SetupMatch(ctx, sponsorA, in, idemKey)
	if err != nil {
		t.Fatalf("first setup match: %v", err)
	}

	// Foreign-key reuse: B under A's key. Must be the 409 sentinel — never a
	// replay of A's match, never a raw 23505.
	_, err = csrSvc.SetupMatch(ctx, sponsorB, in, idemKey)
	if !errors.Is(err, cfcsr.ErrIdempotencyKeyConflict) {
		t.Fatalf("foreign-key SetupMatch must return ErrIdempotencyKeyConflict, got %v", err)
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM cf_csr_matches WHERE idempotency_key = $1`, idemKey).Scan(&count); err != nil {
		t.Fatalf("count matches: %v", err)
	}
	if count != 1 {
		t.Errorf("cf_csr_matches under the key = %d, want 1", count)
	}

	// B's reservation rolled back with the refused insert — committed stays 0.
	var committed int64
	if err := pool.QueryRow(ctx,
		`SELECT committed_kobo FROM cf_csr_profiles WHERE user_id = $1`, sponsorB).Scan(&committed); err != nil {
		t.Fatalf("read B committed: %v", err)
	}
	if committed != 0 {
		t.Errorf("sponsor B committed_kobo = %d, want 0 — a refused foreign-key reuse must not reserve budget", committed)
	}

	// The owner still replays their own key to the original match.
	replay, err := csrSvc.SetupMatch(ctx, sponsorA, in, idemKey)
	if err != nil {
		t.Fatalf("owner replay: %v", err)
	}
	if replay.ID != first.ID {
		t.Errorf("owner replay returned a different match %s vs %s", replay.ID, first.ID)
	}
}
