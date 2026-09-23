package insurance_test

// ---------------------------------------------------------------------------
// LIVE-DB regression test for the insurance commission-workbench gap found
// during the 2026-09-17 UAT pass (INSURANCE-INT-011 / admin commission
// route). A real premium bind (INSURANCE-INT-001, verified live against the
// MyCover sandbox) posts the commission slice to the ledger correctly (DR
// AccountProviderClearing -> CR AccountCommission), but historically nothing
// ever wrote a row to insurance_commission_entry — the table
// GET /api/insurance/admin/commission and POST /commission/:id/{confirm,reverse}
// actually read. Every confirm/reverse call 404'd for every real policy ever
// bound, and the commission list showed a false zero while real commission
// money had moved.
//
// This pins the fix: RegisterInsurance now wires policy.Deps.Commission to a
// commissionRecorder adapter over reconciliation.Repository, and
// policy/service.go calls it right after the ledger commission post. Since
// the adapter lives in package app (to avoid a policy<->reconciliation
// import cycle), this test exercises the SAME repository method
// (UpsertCommission) with the exact shape the adapter now calls it with, and
// asserts the workbench read paths (GetCommissionByPolicy, ListCommission)
// that were previously guaranteed to 404 / come back empty now find the row.
// Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/insurance/reconciliation"
	"spotlight/backend/internal/testsupport"
)

func liveDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping insurance commission-recorder live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedPolicyRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) string {
	t.Helper()
	policyID := uuid.New().String()
	_, err := pool.Exec(ctx, `
		INSERT INTO public.insurance_policy
			(id, policyholder_user_id, product_code, provider, state, premium_amount_kobo, currency)
		VALUES ($1,$2,'mycover:outpatient-hospicash-mini','mycover','ACTIVE',10000,'NGN')`,
		policyID, userID)
	if err != nil {
		t.Fatalf("seed policy: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM public.insurance_policy WHERE id=$1`, policyID)
	})
	return policyID
}

// TestCommissionRecorder_BindWritesReadableWorkbenchRow proves that after the
// commission ledger leg posts, the SAME idempotency key used by the adapter
// (RecordCommission, mirrored here as "<key>:commission") produces a row the
// admin workbench can actually find and act on — the exact gap this pass found.
func TestCommissionRecorder_BindWritesReadableWorkbenchRow(t *testing.T) {
	pool := liveDB(t)
	ctx := context.Background()

	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, userID+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, userID)

	policyID := seedPolicyRow(t, ctx, pool, userID)
	repo := reconciliation.NewRepository(pool)
	idemKey := "insuat-commtest-" + policyID[:8] + ":commission"

	// Before the fix, GetCommissionByPolicy would 404 for every policy: this
	// asserts the pre-state so the test fails loudly if the fixture setup
	// itself is wrong, rather than passing vacuously.
	if _, err := repo.GetCommissionByPolicy(ctx, policyID); err == nil {
		t.Fatalf("expected no commission entry before RecordCommission runs")
	}

	// This is what policy/service.go now calls (via the app-layer adapter)
	// immediately after the successful commission ledger post.
	if err := repo.UpsertCommission(ctx, &reconciliation.CommissionEntry{
		PolicyID:       policyID,
		Provider:       "mycover",
		AmountKobo:     1000,
		LedgerRef:      "insurance:commission:" + policyID,
		IdempotencyKey: idemKey,
		Status:         reconciliation.CommissionPending,
	}); err != nil {
		t.Fatalf("RecordCommission (UpsertCommission): %v", err)
	}

	// The admin GET /commission/:policy_id path — must now find it.
	ce, err := repo.GetCommissionByPolicy(ctx, policyID)
	if err != nil {
		t.Fatalf("GetCommissionByPolicy after record: %v (workbench would still 404)", err)
	}
	if ce.AmountKobo != 1000 || ce.Status != reconciliation.CommissionPending {
		t.Errorf("commission entry = %+v, want amount=1000 status=PENDING", ce)
	}

	// A bind REPLAY (same idempotency key) must not double-record — the
	// ON CONFLICT (idempotency_key) DO NOTHING that makes this idempotent.
	if err := repo.UpsertCommission(ctx, &reconciliation.CommissionEntry{
		PolicyID:       policyID,
		Provider:       "mycover",
		AmountKobo:     1000,
		LedgerRef:      "insurance:commission:" + policyID,
		IdempotencyKey: idemKey,
		Status:         reconciliation.CommissionPending,
	}); err != nil {
		t.Fatalf("replay UpsertCommission: %v", err)
	}
	entries, err := repo.ListCommission(ctx, "", "", 100, 0)
	if err != nil {
		t.Fatalf("ListCommission: %v", err)
	}
	count := 0
	for _, e := range entries {
		if e.PolicyID == policyID {
			count++
		}
	}
	if count != 1 {
		t.Errorf("policy %s has %d commission entries after replay, want exactly 1", policyID, count)
	}

	// Confirm now actually finds a row to act on (previously always 404).
	if err := repo.SetCommissionStatus(ctx, ce.ID, reconciliation.CommissionConfirmed); err != nil {
		t.Fatalf("SetCommissionStatus (confirm): %v", err)
	}
}
