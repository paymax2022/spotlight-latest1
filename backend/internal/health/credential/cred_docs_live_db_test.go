package credential_test

// LIVE-DB regression for cred_type vocabulary: Service.Submit passes doc types
// {VCN_CERT, ANNUAL_LICENCE, GOV_ID} into health_credential_docs.cred_type.
// The CHECK is widened (additive) rather than remapped — Decide's expiry mirror
// writes WHERE cred_type='ANNUAL_LICENCE' and the access log audits cred_type,
// so folding onto the issuer enum would break both.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/health/credential"
	healthproviders "spotlight/backend/internal/health/providers"
	"spotlight/backend/internal/testsupport"
)

func credPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping credential live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	// Registered first: LIFO runs pool.Close AFTER the row cleanups below.
	t.Cleanup(pool.Close)
	return pool
}

func TestLiveDB_VCNSubmit_AttachesEvidenceDocsAndApproves(t *testing.T) {
	pool := credPool(t)
	ctx := context.Background()

	owner := uuid.New().String()
	reviewer := uuid.New().String()
	for _, u := range []string{owner, reviewer} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}

	// Real providers service (nil RBAC/audit are honest — the doc attach +
	// guarded SM need neither).
	prov := healthproviders.NewService(pool, nil, nil)
	app, err := prov.CreateApplication(ctx, owner, "VET", "vet", "Doc Attach Vet")
	if err != nil {
		t.Fatalf("create application: %v", err)
	}
	appID := app.ID
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM health_verification_records WHERE provider_application_id=$1`, appID)
		_, _ = pool.Exec(bg, `DELETE FROM health_credential_doc_access_log WHERE doc_id IN (SELECT id FROM health_credential_docs WHERE application_id=$1)`, appID)
		_, _ = pool.Exec(bg, `DELETE FROM health_provider_applications WHERE id=$1`, appID) // cascades cred docs
		_, _ = pool.Exec(bg, `DELETE FROM health_providers WHERE owner_user_id=$1`, owner)
	})

	repo := credential.NewRepository(pool)
	svc := credential.NewService(repo, credential.NewVCNAdapter(), prov, nil, nil, nil, nil)

	// The exact submit the e2e probe ran — before the fix it died on the
	// cred_type CHECK and surfaced as 400.
	rec, err := svc.Submit(ctx, owner, credential.SubmitInput{
		ApplicationID: appID,
		RegNumber:     "VCN-LIVE-1",
		FullName:      "Doc Attach Vet",
		Consent:       true,
		Docs: []credential.SubmitDoc{
			{Type: "VCN_CERT", StorageKey: "health/vcn/" + appID + "-cert.pdf"},
			{Type: "ANNUAL_LICENCE", StorageKey: "health/vcn/" + appID + "-lic.pdf"},
			{Type: "GOV_ID", StorageKey: "health/vcn/" + appID + "-id.pdf"},
		},
	})
	if err != nil {
		t.Fatalf("Submit with evidence docs: %v", err)
	}
	if len(rec.EvidenceDocIDs) != 3 {
		t.Fatalf("evidence_doc_ids = %v, want 3", rec.EvidenceDocIDs)
	}

	// Each doc lands in the vault under its own type — a reviewer inspects the
	// certificate, the licence and the ID as distinct documents.
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM health_credential_docs
		 WHERE application_id=$1 AND cred_type IN ('VCN_CERT','ANNUAL_LICENCE','GOV_ID')`, appID).Scan(&n); err != nil {
		t.Fatalf("count cred docs: %v", err)
	}
	if n != 3 {
		t.Errorf("credential vault has %d evidence docs, want 3", n)
	}

	// Approve: the licence expiry must mirror onto the ANNUAL_LICENCE doc —
	// the row providers.SuspendExpired reads for the HL-2 auto-suspend sweep.
	exp := time.Date(2030, 12, 31, 0, 0, 0, 0, time.UTC)
	out, err := svc.Decide(ctx, reviewer, rec.ID, "approve", &exp, "live approve")
	if err != nil {
		t.Fatalf("Decide approve: %v", err)
	}
	if out.Status != credential.StatusVerified {
		t.Errorf("status = %s, want VERIFIED", out.Status)
	}
	var gotExp *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT expires_at FROM health_credential_docs WHERE application_id=$1 AND cred_type='ANNUAL_LICENCE'`,
		appID).Scan(&gotExp); err != nil {
		t.Fatalf("read licence doc expiry: %v", err)
	}
	if gotExp == nil || !gotExp.Equal(exp) {
		t.Errorf("ANNUAL_LICENCE expires_at = %v, want %s", gotExp, exp)
	}

	// The widened CHECK must still be meaningful — an unknown doc type is
	// rejected, not silently admitted.
	if _, err := prov.AddCredential(ctx, owner, appID, healthproviders.CredentialDoc{
		CredType: "BOGUS", StorageKey: "health/vcn/bogus.pdf",
	}); err == nil {
		t.Error("cred_type='BOGUS' accepted — the widened CHECK must still reject unknown values")
	}
}
