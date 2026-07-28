package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for merchant KYB onboarding (Phase 8): the owner
// save→document→submit flow (with validation), the admin decision driving the KYB
// state machine + go-live, and the needs_more_info bounce. Skipped unless
// TEST_DATABASE_URL/DATABASE_URL is set. Requires the restaurant + KYB migrations.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func kybLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB KYB test")
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
	defer pool.Close()
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	stranger := uuid.New().String()
	admin := uuid.New().String()
	for _, u := range []string{owner, stranger, admin} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
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
