package healthpharmacy_test

// LIVE-DB tests for patient medication surfaces: reorder re-pricing,
// medications, refills + schedule. Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	healthpharmacy "spotlight/backend/internal/health/pharmacy"
)

func TestLiveDB_ReorderRepricesAndScopes(t *testing.T) {
	pool := ownerOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	prod := seedProduct(t, ctx, f, f.pharmacy, "Paracetamol", "REGISTERED", true, 70_000, 50)
	if _, err := pool.Exec(ctx,
		`INSERT INTO pharmacy_order_lines (order_id, product_id, product_name, quantity, unit_price_kobo, line_total_kobo)
		 VALUES ($1,$2,'Paracetamol',2,50000,100000)`, f.orderID, prod); err != nil {
		t.Fatalf("seed line: %v", err)
	}

	lines, err := f.svc.Reorder(ctx, f.patient, f.orderID)
	if err != nil {
		t.Fatalf("Reorder: %v", err)
	}
	if len(lines) != 1 || lines[0].UnitPriceKobo != 70_000 || !lines[0].Available || lines[0].Quantity != 2 {
		t.Fatalf("want 1 line re-priced to the live 70000 kobo, got %+v", lines)
	}
	if _, err := f.svc.Reorder(ctx, f.other, f.orderID); !errors.Is(err, healthpharmacy.ErrOrderNotFound) {
		t.Fatalf("a non-owner must get ErrOrderNotFound, got %v", err)
	}
}

func TestLiveDB_MedicationsAndRefillSchedule(t *testing.T) {
	pool := ownerOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	dispensed, pending := uuid.New().String(), uuid.New().String()
	for _, rx := range []struct{ id, state string }{{dispensed, "DISPENSED"}, {pending, "SENT_TO_PHARMACY"}} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO health_prescriptions (id, prescriber_id, patient_id, pharmacy_provider_id, state, dispensed_at)
			 VALUES ($1,$2,$3,$4,$5, CASE WHEN $5 = 'DISPENSED' THEN now() END)`,
			rx.id, f.other, f.patient, f.pharmacy, rx.state); err != nil {
			t.Fatalf("seed rx: %v", err)
		}
		id := rx.id
		t.Cleanup(func() {
			_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM health_prescriptions WHERE id=$1`, id)
		})
	}
	var item string
	if err := pool.QueryRow(ctx,
		`INSERT INTO health_prescription_items (prescription_id, drug_name, dosage, quantity)
		 VALUES ($1,'Metformin','500mg twice daily',60) RETURNING id`, dispensed).Scan(&item); err != nil {
		t.Fatalf("seed item: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_prescription_items (prescription_id, drug_name, quantity) VALUES ($1,'Pending Drug',1)`, pending); err != nil {
		t.Fatalf("seed pending item: %v", err)
	}

	meds, err := f.svc.Medications(ctx, f.patient)
	if err != nil {
		t.Fatalf("Medications: %v", err)
	}
	if len(meds) != 1 || meds[0].ID != item {
		t.Fatalf("only the dispensed rx item is a medication, got %+v", meds)
	}

	refills, err := f.svc.Refills(ctx, f.patient)
	if err != nil {
		t.Fatalf("Refills: %v", err)
	}
	if len(refills) != 1 || refills[0].Scheduled {
		t.Fatalf("want 1 unscheduled refill, got %+v", refills)
	}

	r, err := f.svc.ScheduleRefill(ctx, f.patient, item, true)
	if err != nil {
		t.Fatalf("ScheduleRefill: %v", err)
	}
	if !r.Scheduled || !r.AutoRefill {
		t.Fatalf("schedule not persisted: %+v", r)
	}
	// Idempotent re-apply flips the preference, never duplicates the row.
	r, err = f.svc.ScheduleRefill(ctx, f.patient, item, false)
	if err != nil || r.AutoRefill {
		t.Fatalf("re-schedule: %+v %v", r, err)
	}
	if _, err := f.svc.ScheduleRefill(ctx, f.other, item, true); !errors.Is(err, healthpharmacy.ErrRefillNotFound) {
		t.Fatalf("a foreign item must be ErrRefillNotFound, got %v", err)
	}
}
