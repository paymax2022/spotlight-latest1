package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for merchant KYB onboarding (Phase 8): the owner
// save→document→submit flow (with validation), the admin decision driving the KYB
// state machine + go-live, and the needs_more_info bounce. Skipped unless
// TEST_DATABASE_URL is set. Requires the restaurant + KYB migrations.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func kybLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB KYB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func TestLiveDB_KYBOnboarding(t *testing.T) {
	pool := kybLivePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	stranger := uuid.New().String()
	admin := uuid.New().String()
	for _, u := range []string{owner, stranger, admin} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	// Restaurant starts CLOSED (not yet approved).
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'KYB Kitchen','1 St',FALSE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// A stranger cannot touch KYB.
	if _, err := svc.SaveKYB(ctx, restID, stranger, KYB{LegalName: "x"}); err == nil {
		t.Fatal("stranger must not save KYB")
	}

	// Owner saves a registered-company KYB but tries to submit before it's complete →
	// blocked with ErrKYBIncomplete (missing rc_number + cac_certificate).
	reg := KYB{
		LegalName: "KYB Kitchen Ltd", BusinessType: "limited_company",
		ContactEmail: "owner@kyb.ng", ContactPhone: "08011112222",
		BankCode: "058", AccountNumber: "0123456789", AccountName: "KYB Kitchen",
	}
	if _, err := svc.SaveKYB(ctx, restID, owner, reg); err != nil {
		t.Fatalf("save kyb: %v", err)
	}
	if _, err := svc.SubmitKYB(ctx, restID, owner); !errors.Is(err, ErrKYBIncomplete) {
		t.Fatalf("incomplete submit should return ErrKYBIncomplete, got %v", err)
	}

	// Supply the RC number + certificate, then submit cleanly.
	reg.RCNumber = "RC7654321"
	if _, err := svc.SaveKYB(ctx, restID, owner, reg); err != nil {
		t.Fatalf("save kyb 2: %v", err)
	}
	if err := svc.AddKYBDocument(ctx, restID, owner, "cac_certificate", "r2://kyb/cac.pdf", "cac.pdf"); err != nil {
		t.Fatalf("add doc: %v", err)
	}
	if k, err := svc.SubmitKYB(ctx, restID, owner); err != nil || k.Status != KYBSubmitted {
		t.Fatalf("submit: status=%v err=%v", statusOf(k), err)
	}

	// Reviewer bounces it back for more info; the owner may edit + resubmit.
	if err := svc.AdminDecideApplication(ctx, restID, admin, "needs_info", "Please upload proof of address"); err != nil {
		t.Fatalf("needs_info: %v", err)
	}
	if st := kybStatusOf(t, ctx, pool, restID); st != "needs_more_info" {
		t.Fatalf("after needs_info, kyb status = %s, want needs_more_info", st)
	}
	if _, err := svc.SubmitKYB(ctx, restID, owner); err != nil { // resubmit
		t.Fatalf("resubmit: %v", err)
	}

	// Approve → KYB approved AND the restaurant goes live (is_open=true).
	if err := svc.AdminDecideApplication(ctx, restID, admin, "approve", ""); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if st := kybStatusOf(t, ctx, pool, restID); st != "approved" {
		t.Fatalf("after approve, kyb status = %s, want approved", st)
	}
	var isOpen bool
	var snap *string
	if err := pool.QueryRow(ctx, `SELECT is_open, kyb_status FROM restaurants WHERE id=$1`, restID).Scan(&isOpen, &snap); err != nil {
		t.Fatalf("read restaurant: %v", err)
	}
	if !isOpen {
		t.Error("approval should take the restaurant live (is_open=true)")
	}
	if snap == nil || *snap != "approved" {
		t.Errorf("restaurant kyb_status snapshot = %v, want approved", snap)
	}

	// Editing an approved KYB is blocked.
	if _, err := svc.SaveKYB(ctx, restID, owner, reg); err == nil {
		t.Error("editing an approved KYB should be blocked")
	}
}

// TestLiveDB_AdminApproveWithNoKYBRowMakesOutletPayable covers FOOD-003 Part B:
// the owner-facing KYB submission routes were never mounted (Part A) until this
// fix, so every restaurant approved through the admin console today has NO
// restaurant_kyb row. Before the fix, AdminDecideApplication only wrote
// restaurants.kyb_status inside the `hasKYB` branch, so approving such a
// restaurant opened it for orders (is_open=true) while leaving kyb_status
// NULL forever — payout.go's `AND res.kyb_status = 'approved'` gate then refused
// its payouts permanently, with PayoutReadinessForOwner reporting "Business
// verification not started" even after admin approval. The fix must move
// kyb_status on approve/reject even with no formal KYB submission.
func TestLiveDB_AdminApproveWithNoKYBRowMakesOutletPayable(t *testing.T) {
	pool := kybLivePool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	admin := uuid.New().String()
	for _, u := range []string{owner, admin} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'No-KYB Kitchen','1 St',FALSE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM restaurants WHERE id=$1`, restID) })

	// Sanity: reproduces the ORIGINAL bug's starting point — no restaurant_kyb row.
	if _, hasKYB, err := svc.loadKYB(ctx, restID); err != nil || hasKYB {
		t.Fatalf("expected no KYB row before approval, hasKYB=%v err=%v", hasKYB, err)
	}
	before, err := svc.PayoutReadinessForOwner(ctx, owner)
	if err != nil || len(before) != 1 || before[0].Payable {
		t.Fatalf("expected the unapproved outlet to start not-payable, got %+v err=%v", before, err)
	}

	// Admin approves with no formal KYB submission — the common case today.
	if err := svc.AdminDecideApplication(ctx, restID, admin, "approve", ""); err != nil {
		t.Fatalf("approve: %v", err)
	}

	var isOpen bool
	var kybStatus *string
	if err := pool.QueryRow(ctx, `SELECT is_open, kyb_status FROM restaurants WHERE id=$1`, restID).Scan(&isOpen, &kybStatus); err != nil {
		t.Fatalf("read restaurant: %v", err)
	}
	if !isOpen {
		t.Error("approval should take the restaurant live (is_open=true)")
	}
	if kybStatus == nil || *kybStatus != "approved" {
		t.Fatalf("kyb_status = %v, want \"approved\" — this is the FOOD-003 Part B bug: approval must move the payout gate's snapshot even with no formal KYB row", kybStatus)
	}

	// The concrete acceptance bar: payout-readiness must now report payable, not
	// permanently stuck on "Business verification not started".
	after, err := svc.PayoutReadinessForOwner(ctx, owner)
	if err != nil {
		t.Fatalf("PayoutReadinessForOwner: %v", err)
	}
	if len(after) != 1 || !after[0].Payable {
		t.Fatalf("expected the approved outlet to be payable, got %+v", after)
	}
	if after[0].Reason != "" {
		t.Errorf("a payable outlet must carry no blocking reason, got %q", after[0].Reason)
	}

	// Rejecting with no KYB row must symmetrically move the snapshot to rejected.
	if err := svc.AdminDecideApplication(ctx, restID, admin, "reject", "closing"); err != nil {
		t.Fatalf("reject: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT kyb_status FROM restaurants WHERE id=$1`, restID).Scan(&kybStatus); err != nil {
		t.Fatalf("read restaurant after reject: %v", err)
	}
	if kybStatus == nil || *kybStatus != "rejected" {
		t.Fatalf("kyb_status after reject = %v, want \"rejected\"", kybStatus)
	}
}

func statusOf(k *KYB) KYBStatus {
	if k == nil {
		return ""
	}
	return k.Status
}

func kybStatusOf(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restID string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(ctx, `SELECT status FROM restaurant_kyb WHERE restaurant_id=$1`, restID).Scan(&st); err != nil {
		t.Fatalf("read kyb status: %v", err)
	}
	return st
}
