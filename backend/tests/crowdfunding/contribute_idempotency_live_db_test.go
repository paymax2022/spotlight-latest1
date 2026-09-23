package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB regression (INV-001): Contribute() correctly deduplicated the
// underlying ledger posting on an idempotency-key replay (confirmed via
// direct ledger_entries inspection: a replay produces zero extra postings —
// settlement.Escrow's own idempotency handles that), but Contribute() itself
// called Escrow() again on every retry and then tried to INSERT a second
// `contributions` row with the same idempotency_key. The table's own UNIQUE
// constraint rejected that as a raw 500 SQL error ("duplicate key value
// violates unique constraint") instead of returning the original result — the
// exact scenario idempotency keys exist for (a client retrying after a
// dropped response) surfaced a confusing error for money it had already paid.
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL. See
// campaign_analytics_live_db_test.go in this package for the pattern.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Contribute_Idempotent -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/crowdfunding"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

// TestLiveDB_Contribute_IdempotentReplayReturnsSameContribution pins the fix:
// a second Contribute() call with the same idempotency key must return the
// SAME contribution, not error, and must not post any extra money.
func TestLiveDB_Contribute_IdempotentReplayReturnsSameContribution(t *testing.T) {
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
			ON CONFLICT (id) DO NOTHING`, id, "cf-uat-idem-"+id+"@test.local"); err != nil {
			t.Fatalf("seed user %s: %v", id, err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, deadline)
		VALUES ($1, $2, 'Idempotency fixture', 5000000, 'active', 'ACTIVE', NOW() + INTERVAL '30 days')`,
		campaignID, creatorID); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM contributions WHERE campaign_id = $1`, campaignID)
		pool.Exec(ctx, `DELETE FROM campaigns WHERE id = $1`, campaignID)
	})

	// Fund the contributor's ledger wallet directly (standing in for a real
	// top-up rail), same pattern as seedFundedContribution in the withdrawal
	// test — duplicated inline here rather than shared, since that helper also
	// posts a real Contribute() call this test doesn't want.
	contributorWallet, err := ledgerSvc.GetOrCreateUserWallet(ctx, contributorID)
	if err != nil {
		t.Fatalf("get contributor wallet: %v", err)
	}
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("get clearing account: %v", err)
	}
	fundRef := "cf-uat-idem-fund-" + campaignID
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key, description)
		VALUES
			($1, 'CREDIT', 1000000, $3, $4, 'UAT test fund'),
			($2, 'DEBIT',  1000000, $3, $5, 'UAT test fund')`,
		contributorWallet.ID, clearing.ID, fundRef, fundRef+":credit", fundRef+":debit"); err != nil {
		t.Fatalf("fund contributor wallet: %v", err)
	}

	idemKey := "cf-uat-idem-replay-" + campaignID
	first, err := cfSvc.Contribute(ctx, campaignID, contributorID, crowdfunding.ContributeRequest{
		AmountKobo:     250_000,
		IdempotencyKey: idemKey,
	})
	if err != nil {
		t.Fatalf("first contribute: %v", err)
	}

	second, err := cfSvc.Contribute(ctx, campaignID, contributorID, crowdfunding.ContributeRequest{
		AmountKobo:     250_000,
		IdempotencyKey: idemKey,
	})
	if err != nil {
		t.Fatalf("second contribute (replay) returned an error instead of the original result: %v", err)
	}
	if second.ID != first.ID {
		t.Errorf("replay returned a DIFFERENT contribution (id %s vs %s) — not idempotent", second.ID, first.ID)
	}

	var count int
	var totalKobo int64
	if err := pool.QueryRow(ctx, `SELECT COUNT(*), COALESCE(SUM(amount_kobo),0) FROM contributions WHERE idempotency_key = $1`, idemKey).
		Scan(&count, &totalKobo); err != nil {
		t.Fatalf("count contributions: %v", err)
	}
	if count != 1 {
		t.Errorf("contributions row count = %d, want 1", count)
	}
	if totalKobo != 250_000 {
		t.Errorf("total contributed = %d, want 250000 (no double-charge)", totalKobo)
	}
}
