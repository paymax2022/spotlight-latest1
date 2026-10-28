package healthlab

// Live-DB coverage for the display facts attached to orders on read. Skips
// without TEST_DATABASE_URL.

import (
	"testing"

	"github.com/google/uuid"
)

func TestLiveDB_OrderReads_CarryDisplayFacts(t *testing.T) {
	pool := listEndpointsLivePool(t)
	ctx := t.Context()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)
	owner, patient, phleb := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, u := range []string{owner, patient, phleb} {
		seedLabTestUser(t, ctx, pool, u)
	}
	lab := seedDirLab(t, ctx, pool, owner, true, true, "APPROVED")
	order := seedHomeOrder(t, ctx, pool, patient, lab, "SAMPLE_COLLECTED", false)
	if _, err := pool.Exec(ctx, `UPDATE lab_orders SET assigned_phlebotomist_id = $2 WHERE id = $1`, order, phleb); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE user_profiles SET full_name = 'Amina Bello' WHERE id = $1`, phleb); err != nil {
		t.Logf("profile row may not exist for the test user: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO lab_samples (order_id, state, collection_method, barcode_ref, collected_by)
		VALUES ($1,'COLLECTED','HOME','TUBE-VIEW-1',$2)`, order, phleb); err != nil {
		t.Fatal(err)
	}

	got, err := svc.Get(ctx, patient, order, false)
	if err != nil {
		t.Fatal(err)
	}
	if got.LabName != "Directory Test Lab" || got.CollectionAddress == "" || got.ScheduledFor == nil {
		t.Fatalf("the order must carry the lab name and the collection details: %+v", got)
	}
	if got.SampleBarcode == nil || *got.SampleBarcode != "TUBE-VIEW-1" {
		t.Fatalf("the collected sample's barcode must be shown, got %v", got.SampleBarcode)
	}
	if got.AssignedPhlebotomist == nil || *got.AssignedPhlebotomist != phleb {
		t.Fatalf("the assignee must be exposed, got %v", got.AssignedPhlebotomist)
	}

	list, err := svc.ListOrdersForPatient(ctx, patient)
	if err != nil || len(list) != 1 || list[0].LabName != "Directory Test Lab" {
		t.Fatalf("the order list must be decorated the same way: %v %+v", err, list)
	}

	provider, err := svc.ListProviderOrders(ctx, owner, lab)
	if err != nil || len(provider) != 1 {
		t.Fatalf("provider orders: %v %+v", err, provider)
	}
	if provider[0].PatientName == provider[0].PatientID {
		t.Fatal("a patient's raw id must never stand in for their name")
	}
}
