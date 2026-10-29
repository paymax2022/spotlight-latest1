package healthvet_test

// LIVE-DB: member report → admin moderation queue → suspend_provider through
// the real providers state machine → reinstate (refused while a credential is
// expired). Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	healthproviders "spotlight/backend/internal/health/providers"
	healthvet "spotlight/backend/internal/health/vet"
)

type capAdapter struct{ p *healthproviders.Service }

func (a capAdapter) SetCapabilityStatus(ctx context.Context, adminID, providerID, action, note string) error {
	_, err := a.p.SetCapabilityStatus(ctx, adminID, providerID, action, note)
	return err
}

func TestLiveDB_ModerationAndProviderSuspendReinstate(t *testing.T) {
	pool := vetAdminDashboardPool(t)
	ctx := t.Context()
	f := newVetAdminFixture(t, ctx, pool)
	appID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO health_provider_applications (id, owner_user_id, domain, provider_type, display_name, state, provider_id)
		VALUES ($1,$2,'VET','vet','Fixture Vet','APPROVED',$3)`, appID, f.owner, f.provider); err != nil {
		t.Fatalf("seed application: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM health_credential_docs WHERE application_id=$1`, appID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM health_provider_applications WHERE id=$1`, appID)
	})

	svc := healthvet.NewService(pool, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	svc.SetCapabilityStatusSetter(capAdapter{p: healthproviders.NewService(pool, nil, nil)})
	admin := f.other

	if _, err := svc.ReportVet(ctx, f.patient, f.provider, "nonsense", "x", ""); !errors.Is(err, healthvet.ErrReportInvalid) {
		t.Fatalf("invalid kind: %v", err)
	}
	key := "report-" + uuid.NewString()
	id, err := svc.ReportVet(ctx, f.patient, f.provider, "credential_mismatch", "VCN number belongs to someone else", key)
	if err != nil {
		t.Fatal(err)
	}
	if again, err := svc.ReportVet(ctx, f.patient, f.provider, "credential_mismatch", "dup", key); err != nil || again != id {
		t.Fatalf("report replay: %s %v", again, err)
	}

	items, err := svc.AdminListModeration(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var found *healthvet.AdminConsoleModerationItem
	for i := range items {
		if items[i].ID == id {
			found = &items[i]
		}
	}
	if found == nil || found.Status != "open" || found.Severity != "high" || found.ReporterMasked == nil {
		t.Fatalf("listed item: %+v", found)
	}

	if st, err := svc.AdminModerate(ctx, admin, id, "investigate", ""); err != nil || st != "investigating" {
		t.Fatalf("investigate: %s %v", st, err)
	}
	if st, err := svc.AdminModerate(ctx, admin, id, "suspend_provider", "confirmed mismatch"); err != nil || st != "resolved" {
		t.Fatalf("suspend_provider: %s %v", st, err)
	}
	var provStatus, appState string
	_ = pool.QueryRow(ctx, `SELECT p.status, a.state FROM health_providers p JOIN health_provider_applications a ON a.provider_id=p.id WHERE p.id=$1`, f.provider).Scan(&provStatus, &appState)
	if provStatus != "SUSPENDED" || appState != "SUSPENDED" {
		t.Fatalf("after suspend: provider=%s app=%s", provStatus, appState)
	}
	if _, err := svc.AdminModerate(ctx, admin, id, "resolve", ""); !errors.Is(err, healthvet.ErrModerationClosed) {
		t.Fatalf("closed item: %v", err)
	}

	if err := svc.AdminSetProviderStatus(ctx, admin, f.provider, "reinstate", "cleared"); err != nil {
		t.Fatalf("reinstate: %v", err)
	}
	_ = pool.QueryRow(ctx, `SELECT status FROM health_providers WHERE id=$1`, f.provider).Scan(&provStatus)
	if provStatus != "APPROVED" {
		t.Fatalf("after reinstate: %s", provStatus)
	}
	// Suspend is idempotent; reinstate refuses an expired credential.
	if err := svc.AdminSetProviderStatus(ctx, admin, f.provider, "suspend", ""); err != nil {
		t.Fatal(err)
	}
	if err := svc.AdminSetProviderStatus(ctx, admin, f.provider, "suspend", ""); err != nil {
		t.Fatalf("repeat suspend: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO health_credential_docs (application_id, owner_user_id, cred_type, storage_key, expires_at)
		VALUES ($1,$2,'VCN','k',$3)`, appID, f.owner, time.Now().Add(-24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := svc.AdminSetProviderStatus(ctx, admin, f.provider, "reinstate", ""); !errors.Is(err, healthproviders.ErrCredentialExpired) {
		t.Fatalf("expired reinstate: %v", err)
	}
	if err := svc.AdminSetProviderStatus(ctx, admin, uuid.NewString(), "suspend", ""); !errors.Is(err, healthvet.ErrProviderNotFound) {
		t.Fatalf("unknown provider: %v", err)
	}
	if err := svc.AdminReactivateService(ctx, admin, f.serviceID); err != nil {
		t.Fatalf("reactivate: %v", err)
	}
}
