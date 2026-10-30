package healthpharmacy_test

// LIVE-DB tests for the pharmacist work surfaces (stock alerts, Rx queue,
// controlled log): each must return only the caller's own pharmacies' rows.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestLiveDB_StockAlertsScopedAndThresholded(t *testing.T) {
	pool := ownerOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	out := seedProduct(t, ctx, f, f.pharmacy, "Out Of Stock", "REGISTERED", true, 50_000, 0)
	low := seedProduct(t, ctx, f, f.pharmacy, "Low Stock", "REGISTERED", true, 50_000, 4)
	healthy := seedProduct(t, ctx, f, f.pharmacy, "Plenty", "REGISTERED", true, 50_000, 500)
	rival := seedProduct(t, ctx, f, f.rival, "Rival Low", "REGISTERED", true, 50_000, 1)

	got, err := f.svc.StockAlertsForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("StockAlertsForOwner: %v", err)
	}
	sev := map[string]string{}
	for _, a := range got {
		sev[a.ProductID] = a.Severity
	}
	if sev[out] != "out" || sev[low] != "low" {
		t.Fatalf("want out/low alerts, got %v", sev)
	}
	if _, ok := sev[healthy]; ok {
		t.Fatal("well-stocked product must not alert")
	}
	if _, ok := sev[rival]; ok {
		t.Fatal("a rival pharmacy's stock leaked into the owner's alerts")
	}
}

func TestLiveDB_RxQueueScopedToOwnedPharmacy(t *testing.T) {
	pool := ownerOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	mine, theirs, done := uuid.New().String(), uuid.New().String(), uuid.New().String()
	for _, rx := range []struct{ id, ph, state string }{
		{mine, f.pharmacy, "SENT_TO_PHARMACY"},
		{theirs, f.rival, "SENT_TO_PHARMACY"},
		{done, f.pharmacy, "VERIFIED"},
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO health_prescriptions (id, prescriber_id, patient_id, pharmacy_provider_id, state)
			 VALUES ($1,$2,$3,$4,$5)`, rx.id, f.other, f.patient, rx.ph, rx.state); err != nil {
			t.Fatalf("seed rx: %v", err)
		}
		id := rx.id
		t.Cleanup(func() {
			_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM health_prescriptions WHERE id=$1`, id)
		})
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_prescription_items (prescription_id, drug_name, quantity) VALUES ($1,'Amoxicillin',2)`, mine); err != nil {
		t.Fatalf("seed rx item: %v", err)
	}

	got, err := f.svc.RxQueueForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("RxQueueForOwner: %v", err)
	}
	if len(got) != 1 || got[0].RxID != mine || got[0].ItemCount != 1 {
		t.Fatalf("want only the owner's pending rx with 1 item, got %+v", got)
	}

	log, err := f.svc.ControlledLogForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("ControlledLogForOwner: %v", err)
	}
	if len(log) != 0 {
		t.Fatalf("no controlled products exist at MVP, got %d entries", len(log))
	}
}
