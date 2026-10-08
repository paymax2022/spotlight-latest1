package crowdfunding_test

// LIVE-DB regressions for the post-merge audit follow-up on the
// caller-scoped idempotency fix (the #500-class wave):
//
//	D1/D2 — Contribute's settlement adoption re-read used to fire the
//	  ownership check only when the scan SUCCEEDED, and even then checked
//	  only the settlements ROW's payer — never the ":escrow" debit leg's
//	  owner. settlement.Escrow's debit and row insert are not atomic, so a
//	  crash between them leaves an orphan debit a DIFFERENT caller can
//	  adopt by reusing the same key+amount: the row insert then lands with
//	  the new payer_id and every row-level check passes. Verified
//	  provenance = the "<key>:escrow:debit" entry must sit on the CALLER's
//	  own wallet with the settlement's amount.
//	D3 — the stored settlement's total_kobo was never compared to the
//	  request amount.
//	D4 — same-caller replays adopted the stored row unconditionally; a key
//	  replayed with different material params (amount / campaign / offer /
//	  cap / bank) must be ErrIdempotencyKeyConflict → 409, not an ack of a
//	  different request.
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL.
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run 'LiveDB_Adoption|LiveDB_ReplayParams' -v

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
)

// seedReviewedCampaign inserts an active, review-passed campaign owned by creatorID.
func seedReviewedCampaign(t *testing.T, ctx context.Context, pool *pgxpool.Pool, creatorID, title string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, deadline)
		VALUES ($1, $2, $3, 5000000, 'active', 'ACTIVE', NOW() + INTERVAL '30 days')`,
		id, creatorID, title); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM contributions WHERE campaign_id = $1`, id)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM campaigns WHERE id = $1`, id)
	})
	return id
}

// TestLiveDB_Adoption_OrphanDebitCannotBeAdoptedByAnotherCaller pins D2
// end-to-end: member A's escrow debit committed but its settlements row never
// did (the Escrow crash window, simulated by deleting the row). Member B
// reusing the same key+amount must NOT adopt A's debit — the leg lives on
// A's wallet, so the provenance probe fails closed with the 409 sentinel.
// On the unfixed code B's row insert succeeds under B's payer_id, every
// row-level check passes, and B's contribution settles A's money.
func TestLiveDB_Adoption_OrphanDebitCannotBeAdoptedByAnotherCaller(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	cfSvc := crowdfunding.NewService(pool, ledgerSvc, settlementSvc)

	creatorID := seedUser(t, ctx, pool, "cf-orphan-creator")
	contributorA := seedUser(t, ctx, pool, "cf-orphan-a")
	contributorB := seedUser(t, ctx, pool, "cf-orphan-b")
	campaignID := seedReviewedCampaign(t, ctx, pool, creatorID, "Orphan adoption fixture")

	fundWallet(t, ctx, pool, ledgerSvc, contributorA, 1_000_000, "cf-orphan-fund-a-"+campaignID)
	fundWallet(t, ctx, pool, ledgerSvc, contributorB, 1_000_000, "cf-orphan-fund-b-"+campaignID)

	const amountKobo = int64(250_000)
	idemKey := "cf-orphan-key-" + uuid.NewString()

	// A's Escrow commits the debit leg; deleting the row simulates the crash
	// between the two non-atomic writes (debit ✓, row ✗).
	sett, err := settlementSvc.Escrow(ctx, contributorA,
		"campaign:"+campaignID+":contributor:"+contributorA, idemKey, "crowdfunding", amountKobo)
	if err != nil {
		t.Fatalf("seed A escrow: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM settlements WHERE id = $1`, sett.ID); err != nil {
		t.Fatalf("simulate orphan (drop settlements row): %v", err)
	}

	// B reuses the key + amount. The debit dedupes (ErrDuplicate → Escrow
	// proceeds), B's OWN row lands under the key — but the debit leg sits on
	// A's wallet, so adoption must be refused.
	_, err = cfSvc.Contribute(ctx, campaignID, contributorB, crowdfunding.ContributeRequest{
		AmountKobo:     amountKobo,
		IdempotencyKey: idemKey,
	})
	if !errors.Is(err, crowdfunding.ErrIdempotencyKeyConflict) {
		t.Fatalf("orphan-debit adoption must return ErrIdempotencyKeyConflict, got %v", err)
	}

	// No contribution was bound to A's money, and B's balance never moved.
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM contributions WHERE idempotency_key = $1`, idemKey).Scan(&count); err != nil {
		t.Fatalf("count contributions: %v", err)
	}
	if count != 0 {
		t.Errorf("contributions under the key = %d, want 0 — a refused adoption must not record a contribution", count)
	}
	if bal, err := ledgerSvc.GetBalance(ctx, contributorB); err != nil || bal != 1_000_000 {
		t.Errorf("contributor B balance = %d (err %v), want 1000000 — adoption refusal must not debit B", bal, err)
	}
	// And the settled leg must not have paid out: the settlement row B's
	// attempt created must NOT be settleable state 'settled' via this call —
	// the contribution was refused before any Settle ran.
	var orphanSettled bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM contributions co JOIN settlements s ON s.id = co.settlement_id
			WHERE s.idempotency_key = $1 AND s.status = 'settled')`, idemKey).Scan(&orphanSettled); err != nil {
		t.Fatalf("settled probe: %v", err)
	}
	if orphanSettled {
		t.Error("the orphan debit was settled to the creator through an adopted row")
	}
}

// TestLiveDB_Adoption_EscrowAmountMismatchConflicts pins D3 end-to-end: a
// caller replaying their OWN key with a different amount, where the stored
// settlement carries the original total, must conflict — not bind the
// contribution to money that was escrowed for a different amount. The
// same-amount retry (the crash-recovery path) must still adopt cleanly.
func TestLiveDB_Adoption_EscrowAmountMismatchConflicts(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	cfSvc := crowdfunding.NewService(pool, ledgerSvc, settlementSvc)

	creatorID := seedUser(t, ctx, pool, "cf-amt-creator")
	contributor := seedUser(t, ctx, pool, "cf-amt-contrib")
	campaignID := seedReviewedCampaign(t, ctx, pool, creatorID, "Amount mismatch fixture")
	fundWallet(t, ctx, pool, ledgerSvc, contributor, 1_000_000, "cf-amt-fund-"+campaignID)

	idemKey := "cf-amt-key-" + uuid.NewString()
	sett, err := settlementSvc.Escrow(ctx, contributor,
		"campaign:"+campaignID+":contributor:"+contributor, idemKey, "crowdfunding", 200_000)
	if err != nil {
		t.Fatalf("seed escrow: %v", err)
	}

	// Replay the same key at a DIFFERENT amount — the stored settlement is
	// not this request's money.
	_, err = cfSvc.Contribute(ctx, campaignID, contributor, crowdfunding.ContributeRequest{
		AmountKobo:     150_000,
		IdempotencyKey: idemKey,
	})
	if !errors.Is(err, crowdfunding.ErrIdempotencyKeyConflict) {
		t.Fatalf("amount-mismatched replay must return ErrIdempotencyKeyConflict, got %v", err)
	}

	// The same-amount retry — the genuine crash-recovery case — adopts and
	// completes: contribution bound to the ORIGINAL settlement.
	contrib, err := cfSvc.Contribute(ctx, campaignID, contributor, crowdfunding.ContributeRequest{
		AmountKobo:     200_000,
		IdempotencyKey: idemKey,
	})
	if err != nil {
		t.Fatalf("same-amount crash-recovery contribute must succeed, got %v", err)
	}
	if contrib.SettlementID != sett.ID {
		t.Errorf("recovery contribution bound settlement %s, want the escrowed %s", contrib.SettlementID, sett.ID)
	}
	if contrib.AmountKobo != 200_000 {
		t.Errorf("contribution amount = %d, want 200000", contrib.AmountKobo)
	}
}

// TestLiveDB_ReplayParams_ContributeDivergence pins D4 for contributions:
// the same caller replaying a used key against a different amount or a
// different campaign must get the 409 sentinel — never the stored row acked
// as if it were this request.
func TestLiveDB_ReplayParams_ContributeDivergence(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	cfSvc := crowdfunding.NewService(pool, ledgerSvc, settlementSvc)

	creatorID := seedUser(t, ctx, pool, "cf-params-creator")
	contributor := seedUser(t, ctx, pool, "cf-params-contrib")
	campaignA := seedReviewedCampaign(t, ctx, pool, creatorID, "Param fixture A")
	campaignB := seedReviewedCampaign(t, ctx, pool, creatorID, "Param fixture B")
	fundWallet(t, ctx, pool, ledgerSvc, contributor, 2_000_000, "cf-params-fund-"+campaignA)

	idemKey := "cf-params-key-" + uuid.NewString()
	first, err := cfSvc.Contribute(ctx, campaignA, contributor, crowdfunding.ContributeRequest{
		AmountKobo:     250_000,
		IdempotencyKey: idemKey,
	})
	if err != nil {
		t.Fatalf("first contribute: %v", err)
	}

	// Same key, different amount → conflict.
	if _, err := cfSvc.Contribute(ctx, campaignA, contributor, crowdfunding.ContributeRequest{
		AmountKobo:     300_000,
		IdempotencyKey: idemKey,
	}); !errors.Is(err, crowdfunding.ErrIdempotencyKeyConflict) {
		t.Fatalf("same-key different-amount replay must conflict, got %v", err)
	}

	// Same key+amount, different campaign → conflict.
	if _, err := cfSvc.Contribute(ctx, campaignB, contributor, crowdfunding.ContributeRequest{
		AmountKobo:     250_000,
		IdempotencyKey: idemKey,
	}); !errors.Is(err, crowdfunding.ErrIdempotencyKeyConflict) {
		t.Fatalf("same-key different-campaign replay must conflict, got %v", err)
	}

	// Same key, same params → still a clean replay of the original.
	replay, err := cfSvc.Contribute(ctx, campaignA, contributor, crowdfunding.ContributeRequest{
		AmountKobo:     250_000,
		IdempotencyKey: idemKey,
	})
	if err != nil {
		t.Fatalf("identical replay: %v", err)
	}
	if replay.ID != first.ID {
		t.Errorf("identical replay returned contribution %s, want %s", replay.ID, first.ID)
	}
}

// TestLiveDB_ReplayParams_WithdrawalDivergence pins D4 for creator
// withdrawals: same key against a different amount, a different campaign, or
// a different payout account must conflict.
func TestLiveDB_ReplayParams_WithdrawalDivergence(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	fx := seedFundedContribution(t, ctx, pool, 5_000_000, 1_000_000)
	secondCampaignID := seedReviewedCampaign(t, ctx, pool, fx.creatorID, "Withdrawal param fixture B")

	bankA, bankB := uuid.NewString(), uuid.NewString()
	for _, pair := range [][2]string{{bankA, "Param Bank"}, {bankB, "Other Bank"}} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO cf_bank_accounts (id, user_id, bank_name, account_number_masked, account_name, is_default)
			VALUES ($1, $2, $3, '****1111', 'Param Fixture', false)`, pair[0], fx.creatorID, pair[1]); err != nil {
			t.Fatalf("seed bank account: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM cf_bank_accounts WHERE id = ANY($1)`, []string{bankA, bankB})
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM cf_withdrawals WHERE campaign_id = $1`, secondCampaignID)
	})

	idemKey := "cf-params-wd-" + uuid.NewString()
	in := cfwallet.WithdrawalRequestInput{AmountKobo: 100_000, BankAccountID: bankA}
	first, err := fx.walletSvc.SubmitWithdrawal(ctx, fx.creatorID, fx.campaignID, idemKey, in)
	if err != nil {
		t.Fatalf("first withdrawal: %v", err)
	}

	// Different amount → conflict.
	if _, err := fx.walletSvc.SubmitWithdrawal(ctx, fx.creatorID, fx.campaignID, idemKey,
		cfwallet.WithdrawalRequestInput{AmountKobo: 200_000, BankAccountID: bankA}); !errors.Is(err, cfwallet.ErrIdempotencyKeyConflict) {
		t.Fatalf("same-key different-amount withdrawal replay must conflict, got %v", err)
	}
	// Different campaign → conflict.
	if _, err := fx.walletSvc.SubmitWithdrawal(ctx, fx.creatorID, secondCampaignID, idemKey, in); !errors.Is(err, cfwallet.ErrIdempotencyKeyConflict) {
		t.Fatalf("same-key different-campaign withdrawal replay must conflict, got %v", err)
	}
	// Different payout destination → conflict.
	if _, err := fx.walletSvc.SubmitWithdrawal(ctx, fx.creatorID, fx.campaignID, idemKey,
		cfwallet.WithdrawalRequestInput{AmountKobo: 100_000, BankAccountID: bankB}); !errors.Is(err, cfwallet.ErrIdempotencyKeyConflict) {
		t.Fatalf("same-key different-bank withdrawal replay must conflict, got %v", err)
	}

	// Identical replay still returns the original request.
	replay, err := fx.walletSvc.SubmitWithdrawal(ctx, fx.creatorID, fx.campaignID, idemKey, in)
	if err != nil {
		t.Fatalf("identical withdrawal replay: %v", err)
	}
	if replay.ID != first.ID {
		t.Errorf("identical replay returned withdrawal %s, want %s", replay.ID, first.ID)
	}
}

// TestLiveDB_ReplayParams_InvestDivergence pins D4 for investment
// subscriptions: same key against a different amount or a different offer
// must conflict, never replay the stored certificate.
func TestLiveDB_ReplayParams_InvestDivergence(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	invSvc := cfinvestment.NewService(pool)
	investor := seedUser(t, ctx, pool, "cf-params-inv")

	offerA, offerB := uuid.NewString(), uuid.NewString()
	for _, o := range []string{offerA, offerB} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO cf_investment_offers
				(id, title, issuer_name, model, target_kobo, min_ticket_kobo, status)
			VALUES ($1, 'Param Offer', 'Param Issuer Ltd', 'EQUITY', 100000000, 10000, 'OPEN')`, o); err != nil {
			t.Fatalf("seed offer: %v", err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO cf_investor_profiles
			(user_id, onboarded, kyc_complete, education_complete, quiz_passed, risk_profile)
		VALUES ($1, TRUE, TRUE, TRUE, TRUE, 'BALANCED')`, investor); err != nil {
		t.Fatalf("seed investor profile: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM cf_investment_subscriptions WHERE offer_id = ANY($1)`, []string{offerA, offerB})
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM cf_investor_profiles WHERE user_id = $1`, investor)
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM cf_investment_offers WHERE id = ANY($1)`, []string{offerA, offerB})
	})

	idemKey := "cf-params-inv-" + uuid.NewString()
	in := cfinvestment.InvestmentSubscriptionInput{
		OfferID: offerA, AmountKobo: 5_000_000, AcceptedRisk: true, AcceptedAgreement: true,
	}
	first, err := invSvc.Subscribe(ctx, investor, in, idemKey)
	if err != nil {
		t.Fatalf("first subscribe: %v", err)
	}

	if _, err := invSvc.Subscribe(ctx, investor, cfinvestment.InvestmentSubscriptionInput{
		OfferID: offerA, AmountKobo: 6_000_000, AcceptedRisk: true, AcceptedAgreement: true,
	}, idemKey); !errors.Is(err, cfinvestment.ErrIdempotencyKeyConflict) {
		t.Fatalf("same-key different-amount subscribe replay must conflict, got %v", err)
	}
	if _, err := invSvc.Subscribe(ctx, investor, cfinvestment.InvestmentSubscriptionInput{
		OfferID: offerB, AmountKobo: 5_000_000, AcceptedRisk: true, AcceptedAgreement: true,
	}, idemKey); !errors.Is(err, cfinvestment.ErrIdempotencyKeyConflict) {
		t.Fatalf("same-key different-offer subscribe replay must conflict, got %v", err)
	}

	replay, err := invSvc.Subscribe(ctx, investor, in, idemKey)
	if err != nil {
		t.Fatalf("identical subscribe replay: %v", err)
	}
	if replay.ID != first.ID {
		t.Errorf("identical replay returned certificate %s, want %s", replay.ID, first.ID)
	}
}

// TestLiveDB_ReplayParams_CsrDivergence pins D4 for CSR match setup: same key
// against a different campaign, ratio or cap must conflict.
func TestLiveDB_ReplayParams_CsrDivergence(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	csrSvc := cfcsr.NewService(pool)
	creatorID := seedUser(t, ctx, pool, "cf-params-csr-creator")
	sponsor := seedUser(t, ctx, pool, "cf-params-csr-sponsor")

	// SetupMatch requires ACTIVE + verified campaigns.
	campaignA, campaignB := uuid.NewString(), uuid.NewString()
	for _, c := range []string{campaignA, campaignB} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, verified, deadline)
			VALUES ($1, $2, 'CSR param fixture', 5000000, 'active', 'ACTIVE', TRUE, NOW() + INTERVAL '30 days')`, c, creatorID); err != nil {
			t.Fatalf("seed campaign: %v", err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO cf_csr_profiles (user_id, company_name, annual_budget_kobo)
		VALUES ($1, 'Param Corp', 10000000)`, sponsor); err != nil {
		t.Fatalf("seed csr profile: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM cf_csr_matches WHERE campaign_id = ANY($1)`, []string{campaignA, campaignB})
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM cf_csr_profiles WHERE user_id = $1`, sponsor)
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM campaigns WHERE id = ANY($1)`, []string{campaignA, campaignB})
	})

	idemKey := "cf-params-csr-" + uuid.NewString()
	in := cfcsr.MatchSetupInput{CampaignID: campaignA, Ratio: "1:1", CapKobo: 500_000, Visibility: "PUBLIC"}
	first, err := csrSvc.SetupMatch(ctx, sponsor, in, idemKey)
	if err != nil {
		t.Fatalf("first setup match: %v", err)
	}

	for name, divergent := range map[string]cfcsr.MatchSetupInput{
		"different campaign": {CampaignID: campaignB, Ratio: "1:1", CapKobo: 500_000, Visibility: "PUBLIC"},
		"different ratio":    {CampaignID: campaignA, Ratio: "2:1", CapKobo: 500_000, Visibility: "PUBLIC"},
		"different cap":      {CampaignID: campaignA, Ratio: "1:1", CapKobo: 600_000, Visibility: "PUBLIC"},
	} {
		if _, err := csrSvc.SetupMatch(ctx, sponsor, divergent, idemKey); !errors.Is(err, cfcsr.ErrIdempotencyKeyConflict) {
			t.Fatalf("%s replay must conflict, got %v", name, err)
		}
	}

	replay, err := csrSvc.SetupMatch(ctx, sponsor, in, idemKey)
	if err != nil {
		t.Fatalf("identical match replay: %v", err)
	}
	if replay.ID != first.ID {
		t.Errorf("identical replay returned match %s, want %s", replay.ID, first.ID)
	}
}
