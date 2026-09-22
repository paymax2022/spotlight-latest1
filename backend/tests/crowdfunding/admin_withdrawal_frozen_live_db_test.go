package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB regression (SEC-007): adminext.ApproveWithdrawal — the admin
// payout leg for a PENDING withdrawal row — never checked the campaign's
// frozen state at all. wallet.SubmitWithdrawal (the live creator-facing
// path) already refuses to file a withdrawal against a frozen campaign, but
// this admin path is a separate, still-reachable action (a support/ops
// tool, or any future code path that leaves a row PENDING) with no
// equivalent check. A freeze issued AFTER a withdrawal was filed but BEFORE
// an admin approved it did not block the payout.
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL. See
// campaign_analytics_live_db_test.go in this package for the pattern.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_AdminApproveWithdrawal_Frozen -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/crowdfunding/adminext"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

// TestLiveDB_AdminApproveWithdrawal_FrozenCampaignIsRefused pins the fix: a
// PENDING withdrawal against a now-frozen campaign must be refused at
// approval time, not just at request time.
func TestLiveDB_AdminApproveWithdrawal_FrozenCampaignIsRefused(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	adminSvc := adminext.NewService(pool).WithLedger(ledgerSvc)

	creatorID := uuid.NewString()
	approverID := uuid.NewString()
	campaignID := uuid.NewString()
	withdrawalID := uuid.NewString()
	testsupport.CleanupUsers(t, pool, creatorID, approverID)

	for _, id := range []string{creatorID, approverID} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')
			ON CONFLICT (id) DO NOTHING`, id, "cf-uat-frozen-"+id+"@test.local"); err != nil {
			t.Fatalf("seed user %s: %v", id, err)
		}
	}
	// Campaign starts ACTIVE (not frozen) so the withdrawal can be filed
	// legitimately, then is frozen AFTER — the exact sequence this fix
	// closes a gap for.
	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, deadline)
		VALUES ($1, $2, 'Frozen-approval fixture', 5000000, 'active', 'ACTIVE', NOW() + INTERVAL '30 days')`,
		campaignID, creatorID); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO cf_withdrawals (id, campaign_id, creator_id, reference, amount_kobo, bank_label, status, idempotency_key, requested_at)
		VALUES ($1, $2, $3, $4, 100000, 'Test Bank ****0000', 'PENDING', $5, NOW())`,
		withdrawalID, campaignID, creatorID, "SPL-CFWD-UATFROZEN", "cf-uat-frozen-idem-"+withdrawalID); err != nil {
		t.Fatalf("seed pending withdrawal: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM cf_withdrawals WHERE id = $1`, withdrawalID)
		pool.Exec(ctx, `DELETE FROM campaigns WHERE id = $1`, campaignID)
	})

	// Freeze the campaign AFTER the withdrawal was already filed.
	if _, err := pool.Exec(ctx, `UPDATE campaigns SET review_status = 'FROZEN' WHERE id = $1`, campaignID); err != nil {
		t.Fatalf("freeze campaign: %v", err)
	}

	_, err := adminSvc.ApproveWithdrawal(ctx, withdrawalID, approverID, "cf-uat-frozen-approve-"+withdrawalID)
	if err == nil {
		t.Fatalf("ApproveWithdrawal succeeded against a frozen campaign — the freeze was bypassed")
	}
	if !errors.Is(err, adminext.ErrCampaignFrozen) {
		t.Errorf("error = %v, want ErrCampaignFrozen", err)
	}

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM cf_withdrawals WHERE id = $1`, withdrawalID).Scan(&status); err != nil {
		t.Fatalf("read withdrawal status: %v", err)
	}
	if status != "PENDING" {
		t.Errorf("withdrawal status = %q, want 'PENDING' (unchanged — no payout should have posted)", status)
	}
}

// TestLiveDB_AdminApproveWithdrawal_UnfrozenCampaignStillWorks confirms the
// fix didn't break the ordinary (non-frozen) approval path.
func TestLiveDB_AdminApproveWithdrawal_UnfrozenCampaignStillWorks(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	adminSvc := adminext.NewService(pool).WithLedger(ledgerSvc)

	creatorID := uuid.NewString()
	approverID := uuid.NewString()
	campaignID := uuid.NewString()
	withdrawalID := uuid.NewString()
	testsupport.CleanupUsers(t, pool, creatorID, approverID)

	for _, id := range []string{creatorID, approverID} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')
			ON CONFLICT (id) DO NOTHING`, id, "cf-uat-unfrozen-"+id+"@test.local"); err != nil {
			t.Fatalf("seed user %s: %v", id, err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, deadline)
		VALUES ($1, $2, 'Unfrozen-approval fixture', 5000000, 'active', 'ACTIVE', NOW() + INTERVAL '30 days')`,
		campaignID, creatorID); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	// Fund the creator's own wallet directly so the payout debit has real
	// money to move (this path debits the creator's user_wallet, not escrow).
	creatorWallet, err := ledgerSvc.GetOrCreateUserWallet(ctx, creatorID)
	if err != nil {
		t.Fatalf("get creator wallet: %v", err)
	}
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("get clearing account: %v", err)
	}
	fundRef := "cf-uat-unfrozen-fund-" + campaignID
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key, description)
		VALUES
			($1, 'CREDIT', 100000, $3, $4, 'UAT test fund'),
			($2, 'DEBIT',  100000, $3, $5, 'UAT test fund')`,
		creatorWallet.ID, clearing.ID, fundRef, fundRef+":credit", fundRef+":debit"); err != nil {
		t.Fatalf("fund creator wallet: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO cf_withdrawals (id, campaign_id, creator_id, reference, amount_kobo, bank_label, status, idempotency_key, requested_at)
		VALUES ($1, $2, $3, $4, 100000, 'Test Bank ****0000', 'PENDING', $5, NOW())`,
		withdrawalID, campaignID, creatorID, "SPL-CFWD-UATUNFROZEN", "cf-uat-unfrozen-idem-"+withdrawalID); err != nil {
		t.Fatalf("seed pending withdrawal: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM cf_withdrawals WHERE id = $1`, withdrawalID)
		pool.Exec(ctx, `DELETE FROM campaigns WHERE id = $1`, campaignID)
	})

	result, err := adminSvc.ApproveWithdrawal(ctx, withdrawalID, approverID, "cf-uat-unfrozen-approve-"+withdrawalID)
	if err != nil {
		t.Fatalf("ApproveWithdrawal on a non-frozen campaign: %v", err)
	}
	if result.Status != "COMPLETED" {
		t.Errorf("status = %q, want COMPLETED", result.Status)
	}
}
