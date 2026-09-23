package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB regressions for CROWDFUNDING-SEC-004 (amount tampering) and
// CROWDFUNDING-SEC-005 (idempotency-key replay with a different amount), the
// two abuse cases the QA plan (docs/qa/modules/crowdfunding.md §6) flagged as
// "code-reasoned as sound" but never exhaustively live-tested (Batch 4/5,
// Crowdfunding UAT queue position 5).
//
// SEC-004: SubmitWithdrawal accepts a client-supplied amountKobo in the
// request body (unlike Release/Refund, which take no body at all — read by
// hand, confirmed neither accepts an amount). Pin that a client cannot
// request more than the creator's real ledger-derived available balance.
//
// SEC-005: root Contribute() reads its idempotency key from the request BODY
// (unlike wallet/investment/csr, which read the Idempotency-Key HEADER) — a
// genuine surface inconsistency. Pin that replaying the same body-supplied
// key with a DIFFERENT amount cannot be used to retroactively change what was
// charged: the server must return the ORIGINAL stored amount, never the
// replayed one, and must not post any extra money.
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL. See
// campaign_analytics_live_db_test.go in this package for the pattern.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Withdraw_Amount -v
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Contribute_Tamper -v
// ---------------------------------------------------------------------------

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/crowdfunding"
	cfwallet "spotlight/backend/internal/crowdfunding/wallet"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

// TestLiveDB_Withdraw_AmountExceedingRealBalanceIsRefused pins SEC-004: a
// withdrawal request for more than the creator's real available balance must
// be refused BEFORE any ledger posting, regardless of what the client claims.
func TestLiveDB_Withdraw_AmountExceedingRealBalanceIsRefused(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	const contributeKobo = 1_000_000 // 90/10 split -> 900,000 net to creator
	campaignID, creatorID, _, walletSvc := seedFundedContribution(t, ctx, pool, 5_000_000, contributeKobo)

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	before, err := ledgerSvc.GetBalance(ctx, creatorID)
	if err != nil {
		t.Fatalf("get creator balance before: %v", err)
	}
	if before != 900_000 {
		t.Fatalf("test setup: creator balance = %d, want 900000 — fixture assumption broken", before)
	}

	// Client claims it wants to withdraw 10x its real available balance.
	tamperedAmount := before * 10
	_, err = walletSvc.SubmitWithdrawal(ctx, creatorID, campaignID, "cf-uat-sec004-tamper-"+campaignID,
		cfwallet.WithdrawalRequestInput{
			AmountKobo:    tamperedAmount,
			BankAccountID: uuid.NewString(), // never reached — the balance check runs first
		})
	if err == nil {
		t.Fatalf("SubmitWithdrawal succeeded for %d kobo against a real balance of %d — amount tampering was not refused", tamperedAmount, before)
	}
	if !strings.Contains(err.Error(), "exceeds available balance") {
		t.Errorf("error = %v, want an 'exceeds available balance' refusal", err)
	}

	// No money may have moved on the refused attempt.
	after, err := ledgerSvc.GetBalance(ctx, creatorID)
	if err != nil {
		t.Fatalf("get creator balance after: %v", err)
	}
	if after != before {
		t.Errorf("creator balance changed from %d to %d on a REFUSED withdrawal — money moved despite the refusal", before, after)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM cf_withdrawals WHERE campaign_id = $1`, campaignID).Scan(&count); err != nil {
		t.Fatalf("count withdrawals: %v", err)
	}
	if count != 0 {
		t.Errorf("cf_withdrawals row count = %d, want 0 — a refused withdrawal must not leave a row behind", count)
	}
}

// TestLiveDB_Withdraw_ExactAvailableAmountSucceeds is the companion positive
// case: the real balance, to the last kobo, must still be withdrawable — the
// SEC-004 fix's own check (in.AmountKobo > wallet.AvailableKobo) must not be
// off-by-one and refuse the boundary itself.
func TestLiveDB_Withdraw_ExactAvailableAmountSucceeds(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	const contributeKobo = 1_000_000 // -> 900,000 net to creator
	campaignID, creatorID, _, walletSvc := seedFundedContribution(t, ctx, pool, 5_000_000, contributeKobo)

	if _, err := pool.Exec(ctx, `
		INSERT INTO cf_bank_accounts (id, user_id, bank_name, account_number_masked, account_name, is_default)
		VALUES ($1, $2, 'Test Bank', '****0000', 'UAT Fixture', true)`,
		"11111111-1111-1111-1111-111111111111", creatorID); err != nil {
		t.Fatalf("seed bank account: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM cf_bank_accounts WHERE user_id = $1`, creatorID) })

	result, err := walletSvc.SubmitWithdrawal(ctx, creatorID, campaignID, "cf-uat-sec004-exact-"+campaignID,
		cfwallet.WithdrawalRequestInput{
			AmountKobo:    900_000,
			BankAccountID: "11111111-1111-1111-1111-111111111111",
		})
	if err != nil {
		t.Fatalf("SubmitWithdrawal for the exact available balance: %v", err)
	}
	if result.AmountKobo != 900_000 {
		t.Errorf("AmountKobo = %d, want 900000", result.AmountKobo)
	}
}

// TestLiveDB_Contribute_IdempotencyReplayWithDifferentAmountReturnsOriginal
// pins SEC-005: replaying a body-supplied idempotency key with a DIFFERENT
// amount than the first call must return the ORIGINAL contribution and its
// REAL charged amount — never the replayed amount — and must not post any
// additional money.
func TestLiveDB_Contribute_IdempotencyReplayWithDifferentAmountReturnsOriginal(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	cfSvc := crowdfunding.NewService(pool, ledgerSvc, settlementSvc)

	creatorID := uuid.NewString()
	contributorID := uuid.NewString()
	campaignID := uuid.NewString()
	testsupport.CleanupUsers(t, pool, creatorID, contributorID)

	for _, id := range []string{creatorID, contributorID} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')
			ON CONFLICT (id) DO NOTHING`, id, "cf-uat-sec005-"+id+"@test.local"); err != nil {
			t.Fatalf("seed user %s: %v", id, err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, deadline)
		VALUES ($1, $2, 'SEC-005 tamper fixture', 5000000, 'active', 'ACTIVE', NOW() + INTERVAL '30 days')`,
		campaignID, creatorID); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM contributions WHERE campaign_id = $1`, campaignID)
		pool.Exec(ctx, `DELETE FROM campaigns WHERE id = $1`, campaignID)
	})

	// Fund the contributor generously — enough for either amount below.
	contributorWallet, err := ledgerSvc.GetOrCreateUserWallet(ctx, contributorID)
	if err != nil {
		t.Fatalf("get contributor wallet: %v", err)
	}
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("get clearing account: %v", err)
	}
	fundRef := "cf-uat-sec005-fund-" + campaignID
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key, description)
		VALUES
			($1, 'CREDIT', 5000000, $3, $4, 'UAT test fund'),
			($2, 'DEBIT',  5000000, $3, $5, 'UAT test fund')`,
		contributorWallet.ID, clearing.ID, fundRef, fundRef+":credit", fundRef+":debit"); err != nil {
		t.Fatalf("fund contributor wallet: %v", err)
	}

	idemKey := "cf-uat-sec005-replay-" + campaignID

	first, err := cfSvc.Contribute(ctx, campaignID, contributorID, crowdfunding.ContributeRequest{
		AmountKobo:     100_000,
		IdempotencyKey: idemKey,
	})
	if err != nil {
		t.Fatalf("first contribute: %v", err)
	}
	if first.AmountKobo != 100_000 {
		t.Fatalf("test setup: first contribution amount = %d, want 100000", first.AmountKobo)
	}

	// Replay with the SAME key but a WILDLY DIFFERENT amount — this is the
	// tamper attempt: can a client retroactively inflate what it "paid" by
	// reusing a key that already succeeded for a smaller amount?
	second, err := cfSvc.Contribute(ctx, campaignID, contributorID, crowdfunding.ContributeRequest{
		AmountKobo:     9_999_999,
		IdempotencyKey: idemKey,
	})
	if err != nil {
		t.Fatalf("replay with a different amount returned an error instead of the original result: %v", err)
	}
	if second.ID != first.ID {
		t.Errorf("replay with a different amount returned a DIFFERENT contribution (id %s vs %s)", second.ID, first.ID)
	}
	if second.AmountKobo != 100_000 {
		t.Errorf("SEC-005: replay returned AmountKobo = %d, want the ORIGINAL 100000 — the tampered 9999999 must never be honored", second.AmountKobo)
	}

	// The database must agree: exactly one row, at the ORIGINAL amount.
	var count int
	var totalKobo int64
	if err := pool.QueryRow(ctx, `SELECT COUNT(*), COALESCE(SUM(amount_kobo),0) FROM contributions WHERE idempotency_key = $1`, idemKey).
		Scan(&count, &totalKobo); err != nil {
		t.Fatalf("count contributions: %v", err)
	}
	if count != 1 {
		t.Errorf("contributions row count = %d, want 1", count)
	}
	if totalKobo != 100_000 {
		t.Errorf("total contributed = %d, want 100000 — the tampered replay must not have posted any extra money", totalKobo)
	}
}
