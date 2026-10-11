package transport_test

// LIVE-DB regression for the driver-onboarding "Vehicle Insurance" 500.
//
// The mobile client and the backend presign gate (transport.driverDocTypes)
// both use doc_type 'vehicle_insurance', but the driver_documents CHECK only
// allowed 'insurance' until migration 20271026000000. Presign succeeded, the R2
// PUT succeeded, then AddDocument's INSERT violated the CHECK and surfaced as a
// 500. This test drives the real AddDocument path for every required onboarding
// doc_type and asserts it persists. Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
	"spotlight/backend/internal/transport"
)

func docTypePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB doc_type test")
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

func TestAddDocument_AllRequiredDocTypes_Persist_Integration(t *testing.T) {
	pool := docTypePool(t)
	defer pool.Close()
	ctx := context.Background()

	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, userID+"@doctype.test"); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	testsupport.CleanupUser(t, pool, userID)
	if _, err := pool.Exec(ctx, `
		INSERT INTO drivers (user_id, name, vehicle_reg, status, verification_status)
		VALUES ($1,'Doc Type Test Driver',$2,'offline','draft')`,
		userID, "DOC-"+userID[:8]); err != nil {
		t.Fatalf("seed driver: %v", err)
	}

	svc := transport.NewService(pool, nil)

	// Exactly the doc types the mobile onboarding screen (REQUIRED_DOCUMENTS)
	// sends. vehicle_insurance is the one that used to 500.
	for _, docType := range []string{
		"drivers_licence", "government_id", "proof_of_address",
		"vehicle_insurance", "roadworthiness",
	} {
		t.Run(docType, func(t *testing.T) {
			doc, err := svc.AddDocument(ctx, userID, transport.DocumentRequest{
				DocType: docType,
				FileURL: "drivers/" + userID + "/documents/" + docType + "/x.pdf",
			})
			if err != nil {
				t.Fatalf("AddDocument(%q) returned an error (pre-fix this was the 500): %v", docType, err)
			}
			if doc == nil || doc.DocType != docType {
				t.Fatalf("AddDocument(%q) did not persist the document: %+v", docType, doc)
			}
		})
	}
}
