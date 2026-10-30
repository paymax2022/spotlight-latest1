package healthpharmacy_test

// LIVE-DB tests for admin console write actions (catalog governance, recalls,
// PCN decision domain gate). Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	healthpharmacy "spotlight/backend/internal/health/pharmacy"
)

type stubDecider struct{ calls int }

func (d *stubDecider) Decide(_ context.Context, _, _, _, _ string) (string, error) {
	d.calls++
	return "APPROVED", nil
}

func TestLiveDB_AdminGovernAndRecall(t *testing.T) {
	pool := ownerOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	prod := seedProduct(t, ctx, f, f.pharmacy, "Govern Me", "UNREGISTERED", true, 10_000, 7)
	if _, err := f.svc.GovernCatalogItem(ctx, f.other, prod, "approve", "checked"); err != nil {
		t.Fatalf("approve: %v", err)
	}
	var status string
	var active bool
	if err := pool.QueryRow(ctx, `SELECT nafdac_status, active FROM pharmacy_products WHERE id=$1`, prod).Scan(&status, &active); err != nil {
		t.Fatal(err)
	}
	if status != "REGISTERED" || !active {
		t.Fatalf("approve did not register+activate: %s %v", status, active)
	}
	res, err := f.svc.GovernCatalogItem(ctx, f.other, prod, "suspend", "")
	if err != nil || res.Status != "suspended" {
		t.Fatalf("suspend: %+v %v", res, err)
	}
	if _, err := f.svc.GovernCatalogItem(ctx, f.other, uuid.New().String(), "reject", ""); !errors.Is(err, healthpharmacy.ErrAdminNotFound) {
		t.Fatalf("missing product must be ErrAdminNotFound, got %v", err)
	}

	r, err := f.svc.CreateRecall(ctx, f.other, healthpharmacy.CreateRecallInput{
		ProductID: prod, ProductName: "Govern Me", BatchNo: "BATCH-9", Severity: "high", Reason: "contamination",
	})
	if err != nil {
		t.Fatalf("recall: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM pharmacy_recalls WHERE id=$1`, r.ID)
	})
	if r.UnitsAffected != 7 || r.Status != "open" {
		t.Fatalf("recall record: %+v", r)
	}
	if err := pool.QueryRow(ctx, `SELECT active FROM pharmacy_products WHERE id=$1`, prod).Scan(&active); err != nil || active {
		t.Fatalf("recalled product must be inactive: %v %v", active, err)
	}
	list, err := f.svc.ListRecalls(ctx, "open", "high", "BATCH-9")
	if err != nil || len(list) != 1 || list[0].ID != r.ID || list[0].PharmacyMasked != "Inbox Pharmacy" {
		t.Fatalf("list recalls: %v %+v", err, list)
	}

	// PCN decisions only reach the shared reviewer for PHARMACY applications.
	app := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO health_provider_applications (id, owner_user_id, domain, provider_type, display_name, state)
		VALUES ($1,$2,'VET','vet','Not A Pharmacy','SUBMITTED')`, app, f.owner); err != nil {
		t.Fatalf("seed app: %v", err)
	}
	d := &stubDecider{}
	if _, err := f.svc.DecidePcnApplication(ctx, d, f.other, app, "approve", ""); !errors.Is(err, healthpharmacy.ErrAdminNotFound) || d.calls != 0 {
		t.Fatalf("a VET application must be not-found and never decided: %v calls=%d", err, d.calls)
	}
	if _, err := pool.Exec(ctx, `UPDATE health_provider_applications SET domain='PHARMACY', provider_type='pharmacy' WHERE id=$1`, app); err != nil {
		t.Fatal(err)
	}
	out, err := f.svc.DecidePcnApplication(ctx, d, f.other, app, "approve", "ok")
	if err != nil || out.Status != "approved" || !out.CapabilityGranted || d.calls != 1 {
		t.Fatalf("pharmacy decision: %+v %v", out, err)
	}
}
