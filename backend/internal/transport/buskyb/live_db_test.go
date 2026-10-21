package buskyb_test

// LIVE-DB test for the bus-operator KYB pipeline (PRD §5). Skipped unless
// TEST_DATABASE_URL is set. Exercises the real Postgres path end to end —
// the migration's transition trigger + maker-checker CHECK are the backstop
// being proven here, not just the Go table.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
	"spotlight/backend/internal/transport/buskyb"
)

func kybPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB buskyb test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedOperator seeds an auth user + their bus_providers row (verification_status
// 'pending' — the mirror the KYB flow must flip on approval).
func seedOperator(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tier int) (userID, providerID string) {
	t.Helper()
	userID = uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@buskyb.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, userID)
	testsupport.SetKycTier(t, ctx, pool, userID, tier)
	if err := pool.QueryRow(ctx, `
		INSERT INTO bus_providers (owner_user_id, business_name, contact_phone, verification_status, status)
		VALUES ($1,'Buskyb Coaches','08000000000','pending','active') RETURNING id`,
		userID).Scan(&providerID); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	return userID, providerID
}

// TestKybPipeline_EndToEnd drives submit → CAC → KYC → review on the real DB:
// approved only after every gate, CanPublish true only at the end, provider
// mirror flipped to 'verified'.
func TestKybPipeline_EndToEnd(t *testing.T) {
	pool := kybPool(t)
	ctx := context.Background()
	owner, providerID := seedOperator(t, ctx, pool, 2)
	reviewer := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		reviewer, reviewer+"@buskyb.test"); err != nil {
		t.Fatalf("seed reviewer: %v", err)
	}
	testsupport.CleanupUser(t, pool, reviewer)

	svc := buskyb.NewService(buskyb.Deps{
		Pool:     pool,
		Registry: buskyb.SandboxRegistryVerifier{},
	})

	// Gate must be closed before any application exists.
	if ok, err := svc.CanPublish(ctx, providerID); err != nil || ok {
		t.Fatalf("CanPublish before application must be (false,nil), got (%v,%v)", ok, err)
	}

	app, err := svc.SubmitApplication(ctx, owner, buskyb.SubmitRequest{
		LegalName:     "Buskyb Coaches Ltd",
		RCNumber:      "RC-778899",
		TermsAccepted: true,
		TermsVersion:  "v1",
	})
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if app.State != buskyb.StateCACPending {
		t.Fatalf("submit must land at cac_verification_pending, got %s", app.State)
	}

	// Idempotent replay: re-submit while in flight returns the same state.
	app2, err := svc.SubmitApplication(ctx, owner, buskyb.SubmitRequest{
		LegalName: "Buskyb Coaches Ltd", RCNumber: "RC-778899", TermsAccepted: true,
	})
	if err != nil || app2.State != buskyb.StateCACPending {
		t.Fatalf("in-flight resubmit must be a no-op replay, got (%s,%v)", app2.State, err)
	}

	// Sandbox registry → canned match → kyc_verification_pending.
	app, err = svc.RunCACVerification(ctx, app.ID)
	if err != nil {
		t.Fatalf("cac run: %v", err)
	}
	if app.State != buskyb.StateKYCPending {
		t.Fatalf("cac match must advance to kyc_verification_pending, got %s", app.State)
	}

	// Tier-2 owner → passed → under_review.
	app, err = svc.RecordKYCTier(ctx, app.ID, "system")
	if err != nil {
		t.Fatalf("kyc tier: %v", err)
	}
	if app.State != buskyb.StateUnderReview {
		t.Fatalf("tier-2 must land at under_review, got %s", app.State)
	}

	// Maker-checker: the submitter cannot approve their own application.
	if _, err := svc.Review(ctx, app.ID, owner, buskyb.ReviewApprove, ""); !errors.Is(err, buskyb.ErrMakerChecker) {
		t.Fatalf("self-approval must fail with ErrMakerChecker, got %v", err)
	}

	// A different reviewer approves → approved + provider mirror verified.
	app, err = svc.Review(ctx, app.ID, reviewer, buskyb.ReviewApprove, "")
	if err != nil {
		t.Fatalf("review approve: %v", err)
	}
	if app.State != buskyb.StateApproved {
		t.Fatalf("approve must land at approved, got %s", app.State)
	}
	var mirror string
	if err := pool.QueryRow(ctx,
		`SELECT verification_status FROM bus_providers WHERE id=$1`, providerID).Scan(&mirror); err != nil {
		t.Fatalf("read mirror: %v", err)
	}
	if mirror != "verified" {
		t.Fatalf("approval must mirror verification_status='verified', got %q", mirror)
	}

	ok, err := svc.CanPublish(ctx, providerID)
	if err != nil || !ok {
		t.Fatalf("CanPublish after approval must be true, got (%v,%v)", ok, err)
	}
}

// TestKybPipeline_LowTierOperator proves the Tier-2 gate on the real DB: a
// tier-1 owner fails the kyc check and bounces to needs_information (they can
// complete KYC and resubmit — never silently waved through).
func TestKybPipeline_LowTierOperator(t *testing.T) {
	pool := kybPool(t)
	ctx := context.Background()
	owner, _ := seedOperator(t, ctx, pool, 1)

	svc := buskyb.NewService(buskyb.Deps{Pool: pool, Registry: buskyb.SandboxRegistryVerifier{}})

	app, err := svc.SubmitApplication(ctx, owner, buskyb.SubmitRequest{
		LegalName: "Lowtier Coaches", RCNumber: "RC-111111", TermsAccepted: true,
	})
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if app, err = svc.RunCACVerification(ctx, app.ID); err != nil {
		t.Fatalf("cac: %v", err)
	}
	app, err = svc.RecordKYCTier(ctx, app.ID, "system")
	if err != nil {
		t.Fatalf("kyc: %v", err)
	}
	if app.State != buskyb.StateNeedsInfo {
		t.Fatalf("tier-1 owner must bounce to needs_information, got %s", app.State)
	}
}

// TestKybPipeline_RegistryNotFoundRoutesToReview proves a company_not_found CAC
// answer lands the application in under_review for a human — never a rejection
// or approval decided by the provider alone.
func TestKybPipeline_RegistryNotFoundRoutesToReview(t *testing.T) {
	pool := kybPool(t)
	ctx := context.Background()
	owner, _ := seedOperator(t, ctx, pool, 2)

	svc := buskyb.NewService(buskyb.Deps{Pool: pool, Registry: buskyb.SandboxRegistryVerifier{}})

	app, err := svc.SubmitApplication(ctx, owner, buskyb.SubmitRequest{
		LegalName: "Ghost Coaches", RCNumber: "RC-NOTFOUND-42", TermsAccepted: true,
	})
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	app, err = svc.RunCACVerification(ctx, app.ID)
	if err != nil {
		t.Fatalf("cac: %v", err)
	}
	if app.State != buskyb.StateUnderReview {
		t.Fatalf("company_not_found must route to under_review, got %s", app.State)
	}
}
