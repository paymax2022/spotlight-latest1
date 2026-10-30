package transport_test

// LIVE-DB coverage for provider-verified identity documents and the guarantor.
// Both are new onboarding data: identity rows carry no uploaded object (file_url
// NULL) and the guarantor is captured before onboarding finishes. Skipped unless
// TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
	"spotlight/backend/internal/transport"
)

func identityPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB identity/guarantor test")
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

func seedDriver(t *testing.T, pool *pgxpool.Pool) (userID string) {
	t.Helper()
	userID = uuid.New().String()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, userID+"@driver-identity.test"); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	testsupport.CleanupUser(t, pool, userID)
	if _, err := pool.Exec(ctx, `
		INSERT INTO drivers (user_id, name, vehicle_reg, status, verification_status)
		VALUES ($1,'Identity Test Driver',$2,'offline','draft')`,
		userID, "ID-"+userID[:8]); err != nil {
		t.Fatalf("seed driver: %v", err)
	}
	return userID
}

func TestRecordIdentityDocument_NINWithoutFile_Integration(t *testing.T) {
	pool := identityPool(t)
	defer pool.Close()
	userID := seedDriver(t, pool)
	svc := transport.NewService(pool, nil)
	ctx := context.Background()

	doc, err := svc.RecordIdentityDocument(ctx, userID, "nin", "approved")
	if err != nil {
		t.Fatalf("RecordIdentityDocument(nin) error: %v", err)
	}
	if doc.DocType != "nin" || doc.Status != "approved" {
		t.Fatalf("unexpected document: %+v", doc)
	}

	// A retry replaces the previous row rather than stacking duplicates.
	if _, err := svc.RecordIdentityDocument(ctx, userID, "nin", "submitted"); err != nil {
		t.Fatalf("RecordIdentityDocument retry error: %v", err)
	}
	var count int
	var status string
	var fileURL *string
	if err := pool.QueryRow(ctx, `
		SELECT count(*), max(status), max(file_url::text) FROM driver_documents
		WHERE doc_type='nin' AND driver_id=(SELECT id FROM drivers WHERE user_id=$1)`,
		userID).Scan(&count, &status, &fileURL); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly one NIN row after retry, got %d", count)
	}
	if status != "submitted" {
		t.Fatalf("expected retry to replace status, got %q", status)
	}
	if fileURL != nil {
		t.Fatalf("provider-verified document must have no stored object, got %q", *fileURL)
	}
}

func TestUpsertGuarantor_Integration(t *testing.T) {
	pool := identityPool(t)
	defer pool.Close()
	userID := seedDriver(t, pool)
	svc := transport.NewService(pool, nil)
	ctx := context.Background()

	g, err := svc.UpsertGuarantor(ctx, userID, transport.GuarantorRequest{
		FullName:     "Chidi Nwosu",
		Phone:        "08031234567",
		Email:        "chidi@example.com",
		Relationship: "Sibling",
	})
	if err != nil {
		t.Fatalf("UpsertGuarantor error: %v", err)
	}
	if g.DocumentStatus != "pending_issue" {
		t.Fatalf("expected pending_issue before the document is issued, got %q", g.DocumentStatus)
	}

	// A second save updates in place (one guarantor per driver).
	if _, err := svc.UpsertGuarantor(ctx, userID, transport.GuarantorRequest{
		FullName:     "Chidi Nwosu",
		Phone:        "2348031234567",
		Relationship: "Brother",
	}); err != nil {
		t.Fatalf("UpsertGuarantor update error: %v", err)
	}
	var count int
	var rel string
	if err := pool.QueryRow(ctx, `
		SELECT count(*), max(relationship) FROM driver_guarantors
		WHERE driver_id=(SELECT id FROM drivers WHERE user_id=$1)`, userID).Scan(&count, &rel); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if count != 1 || rel != "Brother" {
		t.Fatalf("expected one updated guarantor, got count=%d relationship=%q", count, rel)
	}

	prof, err := svc.DriverMeFull(ctx, userID)
	if err != nil {
		t.Fatalf("DriverMeFull error: %v", err)
	}
	if prof["guarantor"] == nil {
		t.Fatal("expected /driver/me to include the guarantor")
	}
}

func TestUpsertGuarantor_RejectsBadInput_Integration(t *testing.T) {
	pool := identityPool(t)
	defer pool.Close()
	userID := seedDriver(t, pool)
	svc := transport.NewService(pool, nil)

	for _, req := range []transport.GuarantorRequest{
		{FullName: "AB", Phone: "08031234567", Relationship: "Sibling"},
		{FullName: "Chidi Nwosu", Phone: "123", Relationship: "Sibling"},
		{FullName: "Chidi Nwosu", Phone: "08031234567"},
	} {
		if _, err := svc.UpsertGuarantor(context.Background(), userID, req); err == nil {
			t.Fatalf("expected validation failure for %+v", req)
		}
	}
}
