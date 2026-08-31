package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB test: a contribution reports the money that actually MOVED.
//
// WHY THIS EXISTS
// ---------------
// The contribution read used to derive its own fee/total breakdown from a local
// `platformFeeBps = 250` constant:
//
//	fee   := amount * 250 / 10000   // 2.5%
//	total := amount + fee           // fee added on top
//
// Both halves contradicted the settlement that moved the money. The platform's
// cut is crowdfunding.PlatformFeePct (10%), and it is DEDUCTED from the
// creator's payout rather than added to the contributor's bill. A ₦1,000
// contribution debits ₦1,000 and pays the creator ₦900 — but rendered on the
// receipt as "₦1,025 total paid".
//
// The breakdown is now read from the settlement row. This test pins the
// arithmetic of the deducted model, which the derived version violated in both
// directions: total == amount (not amount + fee), and amount - fee == net.
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL, which the root .env
// points at the production pooler and this test INSERTs (see
// scripts/ci/check-live-db-gate.sh).
//
// Bring-up:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_ContributionReportsSettled -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/crowdfunding/creator"

	"spotlight/backend/internal/testsupport"
)

// seedSettledContribution inserts a settlement + the contribution escrowed under
// it. feeKobo/providerKobo are written only when settled, mirroring
// settlement.Settle — Escrow writes total_kobo alone.
func seedSettledContribution(t *testing.T, ctx context.Context, pool *pgxpool.Pool,
	campaignID, contributorID string, totalKobo int64, settled bool) string {
	t.Helper()

	settlementID := uuid.NewString()
	contributionID := uuid.NewString()
	idem := "fee-test-" + contributionID

	if settled {
		fee := totalKobo / 10
		if _, err := pool.Exec(ctx, `
			INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, fee_kobo, provider_kobo,
			                         status, escrowed_at, settled_at, idempotency_key)
			VALUES ($1, $2, 'crowdfunding', $3, $4, $5, $6, 'settled', NOW(), NOW(), $7)`,
			settlementID, "campaign:"+campaignID+":contributor:"+contributorID,
			contributorID, totalKobo, fee, totalKobo-fee, idem); err != nil {
			t.Fatalf("seed settled settlement: %v", err)
		}
	} else {
		if _, err := pool.Exec(ctx, `
			INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo,
			                         status, escrowed_at, idempotency_key)
			VALUES ($1, $2, 'crowdfunding', $3, $4, 'escrowed', NOW(), $5)`,
			settlementID, "campaign:"+campaignID+":contributor:"+contributorID,
			contributorID, totalKobo, idem); err != nil {
			t.Fatalf("seed escrowed settlement: %v", err)
		}
	}

	status := "escrowed"
	if settled {
		status = "released"
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO contributions (id, campaign_id, contributor_id, amount_kobo, status, idempotency_key, settlement_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		contributionID, campaignID, contributorID, totalKobo, status, idem, settlementID); err != nil {
		t.Fatalf("seed contribution: %v", err)
	}

	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `DELETE FROM contributions WHERE id = $1`, contributionID); err != nil {
			t.Errorf("cleanup contribution: %v", err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM settlements WHERE id = $1`, settlementID); err != nil {
			t.Errorf("cleanup settlement: %v", err)
		}
	})
	return contributionID
}

// seedContributor creates a user tracked by the campaign fixture's cleanup.
func seedContributor(t *testing.T, ctx context.Context, pool *pgxpool.Pool, trackUser func(string)) string {
	t.Helper()
	id := uuid.NewString()
	trackUser(id)
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, id, "cf-fee-"+id+"@test.local"); err != nil {
		t.Fatalf("seed contributor: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

// TestLiveDB_ContributionReportsSettledMoney is the regression that kills the
// fabricated breakdown: the numbers must be the settlement's, not a percentage
// recomputed at display time.
func TestLiveDB_ContributionReportsSettledMoney(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)

	campaignID, _, trackUser := seedCampaign(t, ctx, pool)
	contributor := seedContributor(t, ctx, pool, trackUser)

	// ₦1,000 — the exact contribution that surfaced this.
	id := seedSettledContribution(t, ctx, pool, campaignID, contributor, 100_000, true)

	got, err := creator.NewService(pool).GetContribution(ctx, id, contributor)
	if err != nil {
		t.Fatalf("get contribution: %v", err)
	}

	if got.AmountKobo != 100_000 {
		t.Errorf("amountKobo = %d, want 100000", got.AmountKobo)
	}
	// The debit. The derived version reported 102500 here.
	if got.TotalKobo != 100_000 {
		t.Errorf("totalKobo = %d, want 100000 — the contributor was debited the contribution, not the contribution plus a fee", got.TotalKobo)
	}
	// The platform's real cut. The derived version reported 2500.
	if got.FeeKobo != 10_000 {
		t.Errorf("feeKobo = %d, want 10000 (10%% of the contribution, from the settlement)", got.FeeKobo)
	}
	if got.NetToCampaignKobo != 90_000 {
		t.Errorf("netToCampaignKobo = %d, want 90000", got.NetToCampaignKobo)
	}

	// The two identities that define the deducted model. The old additive
	// breakdown satisfied neither.
	if got.TotalKobo != got.AmountKobo {
		t.Errorf("total (%d) != amount (%d) — the fee must not be added to the contributor's bill", got.TotalKobo, got.AmountKobo)
	}
	if got.AmountKobo-got.FeeKobo != got.NetToCampaignKobo {
		t.Errorf("amount (%d) - fee (%d) != net (%d) — the fee must come out of the campaign's payout",
			got.AmountKobo, got.FeeKobo, got.NetToCampaignKobo)
	}
}

// TestLiveDB_ContributionProjectsFeeBeforeSettlement covers the escrowed-but-not-
// yet-settled window. settlement.Settle writes fee_kobo/provider_kobo, so before
// it runs there is no recorded split — reporting a zero fee there would tell the
// creator they are taking no deduction. The projection uses the same constant
// the settlement will split by.
func TestLiveDB_ContributionProjectsFeeBeforeSettlement(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)

	campaignID, _, trackUser := seedCampaign(t, ctx, pool)
	contributor := seedContributor(t, ctx, pool, trackUser)

	id := seedSettledContribution(t, ctx, pool, campaignID, contributor, 250_000, false)

	got, err := creator.NewService(pool).GetContribution(ctx, id, contributor)
	if err != nil {
		t.Fatalf("get contribution: %v", err)
	}
	if got.TotalKobo != 250_000 {
		t.Errorf("totalKobo = %d, want 250000", got.TotalKobo)
	}
	if got.FeeKobo != 25_000 {
		t.Errorf("feeKobo = %d, want 25000 — an unsettled contribution must project the split, not report a zero fee", got.FeeKobo)
	}
	if got.NetToCampaignKobo != 225_000 {
		t.Errorf("netToCampaignKobo = %d, want 225000", got.NetToCampaignKobo)
	}
}
