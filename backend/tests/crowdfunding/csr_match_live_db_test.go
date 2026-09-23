package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB regressions for the CSR (corporate matching) sub-module — flagged
// in the QA plan as "beyond AUTHZ-005" (Batch 3 only live-tested the
// approve-match ownership gate; the reserve-budget setup path and the
// PENDING_APPROVAL→ACTIVE integration flow were still marked TODO in the test
// matrix). Crowdfunding UAT queue position 5, Batch 5.
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL. See
// campaign_analytics_live_db_test.go in this package for the pattern.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_CSR -v
// ---------------------------------------------------------------------------

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/crowdfunding/csr"
	"spotlight/backend/internal/testsupport"
)

// TestLiveDB_CSR_SetupMatch_RequiresIdempotencyKey pins the fail-closed
// contract: a blank Idempotency-Key must be refused before any DB write —
// specifically before the budget-reserving UPDATE, which is the money-
// adjacent state this endpoint guards (SEC's "missing/blank Idempotency-Key
// on ... CSR match ⇒ 400 before any DB access").
func TestLiveDB_CSR_SetupMatch_RequiresIdempotencyKey(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)
	svc := csr.NewService(pool)

	sponsorID := uuid.NewString()
	campaignID := uuid.NewString()
	creatorID := uuid.NewString()
	testsupport.CleanupUsers(t, pool, sponsorID, creatorID)

	for _, id := range []string{sponsorID, creatorID} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')
			ON CONFLICT (id) DO NOTHING`, id, "cf-uat-csr-"+id+"@test.local"); err != nil {
			t.Fatalf("seed user %s: %v", id, err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, verified, deadline)
		VALUES ($1, $2, 'CSR idem-key fixture', 5000000, 'active', 'ACTIVE', TRUE, NOW() + INTERVAL '30 days')`,
		campaignID, creatorID); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM cf_csr_matches WHERE campaign_id = $1`, campaignID)
		pool.Exec(ctx, `DELETE FROM campaigns WHERE id = $1`, campaignID)
		pool.Exec(ctx, `DELETE FROM cf_csr_profiles WHERE user_id = $1`, sponsorID)
	})

	_, err := svc.SetupMatch(ctx, sponsorID, csr.MatchSetupInput{
		CampaignID: campaignID, Ratio: "1:1", CapKobo: 100_000, Visibility: "PUBLIC",
	}, "" /* blank key */)
	if err == nil {
		t.Fatalf("SetupMatch succeeded with a blank Idempotency-Key")
	}
	if !strings.Contains(err.Error(), "Idempotency-Key") {
		t.Errorf("error = %v, want an Idempotency-Key refusal", err)
	}

	// No profile row or budget commitment may exist — the refusal must be
	// truly BEFORE any DB write, not just before the final INSERT.
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM cf_csr_profiles WHERE user_id = $1`, sponsorID).Scan(&count); err != nil {
		t.Fatalf("count profiles: %v", err)
	}
	if count != 0 {
		t.Errorf("cf_csr_profiles row count = %d, want 0 — a blank-key refusal must not create a profile or reserve any budget", count)
	}
}

// TestLiveDB_CSR_SetupMatch_CapExceedingBudgetIsRefused pins the budget gate:
// a sponsor with no (or insufficient) annual budget cannot reserve more cap
// than they have — a fresh sponsor's auto-created profile defaults to a
// ZERO annual_budget_kobo (migration 20260622040000), so this is also the
// default outcome for any brand-new sponsor, not just an edge case.
func TestLiveDB_CSR_SetupMatch_CapExceedingBudgetIsRefused(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)
	svc := csr.NewService(pool)

	sponsorID := uuid.NewString()
	campaignID := uuid.NewString()
	creatorID := uuid.NewString()
	testsupport.CleanupUsers(t, pool, sponsorID, creatorID)

	for _, id := range []string{sponsorID, creatorID} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')
			ON CONFLICT (id) DO NOTHING`, id, "cf-uat-csr-cap-"+id+"@test.local"); err != nil {
			t.Fatalf("seed user %s: %v", id, err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, verified, deadline)
		VALUES ($1, $2, 'CSR cap fixture', 5000000, 'active', 'ACTIVE', TRUE, NOW() + INTERVAL '30 days')`,
		campaignID, creatorID); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	// Explicit small budget so the test is about the CAP CHECK, not just the
	// zero-default case.
	if _, err := pool.Exec(ctx, `
		INSERT INTO cf_csr_profiles (user_id, annual_budget_kobo) VALUES ($1, 50000)`,
		sponsorID); err != nil {
		t.Fatalf("seed csr profile: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM cf_csr_matches WHERE campaign_id = $1`, campaignID)
		pool.Exec(ctx, `DELETE FROM campaigns WHERE id = $1`, campaignID)
		pool.Exec(ctx, `DELETE FROM cf_csr_profiles WHERE user_id = $1`, sponsorID)
	})

	_, err := svc.SetupMatch(ctx, sponsorID, csr.MatchSetupInput{
		CampaignID: campaignID, Ratio: "1:1", CapKobo: 100_000, Visibility: "PUBLIC",
	}, "cf-uat-csr-cap-key-"+campaignID)
	if err == nil {
		t.Fatalf("SetupMatch succeeded reserving 100000 against a 50000 budget")
	}
	if !strings.Contains(err.Error(), "exceeds remaining annual budget") {
		t.Errorf("error = %v, want an 'exceeds remaining annual budget' refusal", err)
	}

	var committed int64
	if err := pool.QueryRow(ctx, `SELECT committed_kobo FROM cf_csr_profiles WHERE user_id = $1`, sponsorID).Scan(&committed); err != nil {
		t.Fatalf("read committed_kobo: %v", err)
	}
	if committed != 0 {
		t.Errorf("committed_kobo = %d, want 0 — a refused reservation must not partially commit budget", committed)
	}
	var matchCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM cf_csr_matches WHERE campaign_id = $1`, campaignID).Scan(&matchCount); err != nil {
		t.Fatalf("count matches: %v", err)
	}
	if matchCount != 0 {
		t.Errorf("cf_csr_matches row count = %d, want 0", matchCount)
	}
}

// TestLiveDB_CSR_SetupThenApprove_FullIntegrationFlow closes the "CSR match
// reserve + PENDING_APPROVAL→ACTIVE" integration case the QA matrix marked
// TODO: a sufficiently-funded sponsor reserves budget (PENDING_APPROVAL),
// then approves their own match (ACTIVE) — checking budget commitment,
// status transition, and the campaigns_supported counter all move together.
func TestLiveDB_CSR_SetupThenApprove_FullIntegrationFlow(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)
	svc := csr.NewService(pool)

	sponsorID := uuid.NewString()
	campaignID := uuid.NewString()
	creatorID := uuid.NewString()
	testsupport.CleanupUsers(t, pool, sponsorID, creatorID)

	for _, id := range []string{sponsorID, creatorID} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')
			ON CONFLICT (id) DO NOTHING`, id, "cf-uat-csr-flow-"+id+"@test.local"); err != nil {
			t.Fatalf("seed user %s: %v", id, err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, verified, deadline)
		VALUES ($1, $2, 'CSR full-flow fixture', 5000000, 'active', 'ACTIVE', TRUE, NOW() + INTERVAL '30 days')`,
		campaignID, creatorID); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO cf_csr_profiles (user_id, annual_budget_kobo) VALUES ($1, 1000000)`,
		sponsorID); err != nil {
		t.Fatalf("seed csr profile: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM cf_csr_matches WHERE campaign_id = $1`, campaignID)
		pool.Exec(ctx, `DELETE FROM campaigns WHERE id = $1`, campaignID)
		pool.Exec(ctx, `DELETE FROM cf_csr_profiles WHERE user_id = $1`, sponsorID)
	})

	idemKey := "cf-uat-csr-flow-key-" + campaignID
	match, err := svc.SetupMatch(ctx, sponsorID, csr.MatchSetupInput{
		CampaignID: campaignID, Ratio: "1:1", CapKobo: 200_000, Visibility: "PUBLIC",
	}, idemKey)
	if err != nil {
		t.Fatalf("SetupMatch: %v", err)
	}
	if match.Status != "PENDING_APPROVAL" {
		t.Errorf("status after setup = %q, want PENDING_APPROVAL", match.Status)
	}

	var committed int64
	if err := pool.QueryRow(ctx, `SELECT committed_kobo FROM cf_csr_profiles WHERE user_id = $1`, sponsorID).Scan(&committed); err != nil {
		t.Fatalf("read committed_kobo after setup: %v", err)
	}
	if committed != 200_000 {
		t.Errorf("committed_kobo after setup = %d, want 200000", committed)
	}

	// Idempotent replay of the SAME setup call must not double-commit budget.
	replay, err := svc.SetupMatch(ctx, sponsorID, csr.MatchSetupInput{
		CampaignID: campaignID, Ratio: "1:1", CapKobo: 200_000, Visibility: "PUBLIC",
	}, idemKey)
	if err != nil {
		t.Fatalf("SetupMatch replay: %v", err)
	}
	if replay.ID != match.ID {
		t.Errorf("replay returned a different match id (%s vs %s)", replay.ID, match.ID)
	}
	if err := pool.QueryRow(ctx, `SELECT committed_kobo FROM cf_csr_profiles WHERE user_id = $1`, sponsorID).Scan(&committed); err != nil {
		t.Fatalf("read committed_kobo after replay: %v", err)
	}
	if committed != 200_000 {
		t.Errorf("committed_kobo after a replayed setup = %d, want 200000 (unchanged) — the reservation was double-committed", committed)
	}

	approved, err := svc.ApproveMatch(ctx, sponsorID, match.ID)
	if err != nil {
		t.Fatalf("ApproveMatch: %v", err)
	}
	if approved.Status != "ACTIVE" {
		t.Errorf("status after approve = %q, want ACTIVE", approved.Status)
	}

	var supported int
	if err := pool.QueryRow(ctx, `SELECT campaigns_supported FROM cf_csr_profiles WHERE user_id = $1`, sponsorID).Scan(&supported); err != nil {
		t.Fatalf("read campaigns_supported: %v", err)
	}
	if supported != 1 {
		t.Errorf("campaigns_supported = %d, want 1", supported)
	}

	// Approving twice must be refused (not idempotent — it's a one-way FSM
	// transition, unlike the money-posting endpoints above).
	if _, err := svc.ApproveMatch(ctx, sponsorID, match.ID); err == nil {
		t.Errorf("second ApproveMatch on an already-ACTIVE match succeeded — expected a state-transition refusal")
	}
}
