package healthpharmacy_test

// LIVE-DB tests for the patient's own order history (GET /orders/mine).
//
// The gap this closes: the mobile "Customer: orders" getOrders() called
// GET /orders — the same path the pharmacist inbox (ListForOwner) is bound
// to. A patient calling it either got an empty list (owning no pharmacy) or,
// worse, another business's fulfilment queue (if they happened to also own
// a pharmacy). ListForPatient/ListMyOrders give the patient a scoped read of
// their OWN orders on a distinct path, /orders/mine, so it never collides
// with the owner inbox.
//
// Two properties matter beyond "it returns rows":
//   - it is scoped to orders the caller PLACED (a history that leaked
//     another patient's orders would expose their purchases and pickup
//     credential);
//   - unlike the owner inbox, it DOES return pickup_code — that credential
//     belongs to the patient reading their own order.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	healthpharmacy "spotlight/backend/internal/health/pharmacy"

	"spotlight/backend/internal/testsupport"
)

func patientOrdersPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping pharmacy patient-orders live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	return pool
}

type patientOrdersFixture struct {
	svc                   *healthpharmacy.Service
	pool                  *pgxpool.Pool
	patient, other, owner string
	pharmacy              string
	orderID, otherOrderID string
}

func newPatientOrdersFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) patientOrdersFixture {
	t.Helper()
	f := patientOrdersFixture{
		// A read-only query — none of the write-path collaborators participate.
		svc:     healthpharmacy.NewService(pool, nil, nil, nil, nil, nil, nil, nil),
		pool:    pool,
		patient: uuid.New().String(), other: uuid.New().String(), owner: uuid.New().String(),
		pharmacy:     uuid.New().String(),
		orderID:      uuid.New().String(),
		otherOrderID: uuid.New().String(),
	}
	for _, u := range []string{f.patient, f.other, f.owner} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		 VALUES ($1,$2,'PHARMACY','pharmacist',$3,'APPROVED')`, f.pharmacy, f.owner, "Patient History Pharmacy"); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	for _, o := range []struct{ id, patientID, state, pickup string }{
		// Same pharmacy, two DIFFERENT patients — so the scoping assertion is real.
		{f.orderID, f.patient, "CONFIRMED", "PICKUP-MINE-123"},
		{f.otherOrderID, f.other, "CONFIRMED", "PICKUP-OTHER-456"},
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO pharmacy_orders (id, patient_id, pharmacy_provider_id, state, fulfilment_method,
			     total_kobo, pickup_code, idempotency_key)
			 VALUES ($1,$2,$3,$4,'PICKUP',320000,$5,$6)`,
			o.id, o.patientID, f.pharmacy, o.state, o.pickup, "idem-"+o.id); err != nil {
			t.Fatalf("seed order: %v", err)
		}
	}
	t.Cleanup(func() {
		bg := context.Background()
		// IN ($1,$2), not = ANY($1) with a []string: these id columns are uuid, and
		// `uuid = ANY(text[])` has no operator — the delete errors, the error is
		// ignored here, and the fixture survives.
		pool.Exec(bg, `DELETE FROM pharmacy_orders WHERE id IN ($1,$2)`, f.orderID, f.otherOrderID)
		pool.Exec(bg, `DELETE FROM pharmacy_products WHERE pharmacy_provider_id = $1`, f.pharmacy)
		pool.Exec(bg, `DELETE FROM pharmacy_orders WHERE pharmacy_provider_id = $1`, f.pharmacy)
		pool.Exec(bg, `DELETE FROM health_providers WHERE id = $1`, f.pharmacy)
	})
	return f
}

func TestLiveDB_PatientSeesTheirOwnOrders(t *testing.T) {
	pool := patientOrdersPool(t)
	// Registered first, so LIFO makes it run last — after the row cleanups in
	// t.Cleanup above, which need a live pool.
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newPatientOrdersFixture(t, ctx, pool)

	orders, err := f.svc.ListForPatient(ctx, f.patient, "", 50, 0)
	if err != nil {
		t.Fatalf("ListForPatient: %v", err)
	}
	if len(orders) != 1 {
		t.Fatalf("got %d orders, want exactly 1 (their own)", len(orders))
	}
	if orders[0].ID != f.orderID {
		t.Errorf("order id = %s, want %s", orders[0].ID, f.orderID)
	}
	if orders[0].TotalKobo != 320000 {
		t.Errorf("total = %d, want 320000", orders[0].TotalKobo)
	}
}

func TestLiveDB_PatientHistoryNeverLeaksAnotherPatientsOrders(t *testing.T) {
	pool := patientOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newPatientOrdersFixture(t, ctx, pool)

	orders, err := f.svc.ListForPatient(ctx, f.patient, "", 50, 0)
	if err != nil {
		t.Fatalf("ListForPatient: %v", err)
	}
	for _, o := range orders {
		if o.ID == f.otherOrderID {
			t.Fatal("another patient's order appeared in this patient's history — purchase history and pickup code leak")
		}
		if o.PatientID != f.patient {
			t.Errorf("order for patient %s in %s's history", o.PatientID, f.patient)
		}
	}

	// A pharmacy owner who never placed an order of their own gets nothing.
	none, err := f.svc.ListForPatient(ctx, f.owner, "", 50, 0)
	if err != nil {
		t.Fatalf("ListForPatient(owner): %v", err)
	}
	if len(none) != 0 {
		t.Errorf("an owner with no orders of their own got %d orders, want 0", len(none))
	}
}

func TestLiveDB_PatientHistoryIncludesThePickupCode(t *testing.T) {
	pool := patientOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newPatientOrdersFixture(t, ctx, pool)

	orders, err := f.svc.ListForPatient(ctx, f.patient, "", 50, 0)
	if err != nil {
		t.Fatalf("ListForPatient: %v", err)
	}
	if len(orders) == 0 {
		t.Fatal("no orders")
	}
	// Unlike the owner inbox, this IS the patient reading their own order —
	// the pickup credential belongs to them.
	if orders[0].PickupCode == nil || *orders[0].PickupCode != "PICKUP-MINE-123" {
		t.Errorf("pickup_code missing/wrong in the patient's own history: %v", orders[0].PickupCode)
	}
}

func TestLiveDB_PatientHistoryEmptyIsEmptyNotNil(t *testing.T) {
	pool := patientOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()

	got, err := healthpharmacy.NewService(pool, nil, nil, nil, nil, nil, nil, nil).
		ListForPatient(ctx, uuid.New().String(), "", 50, 0)
	if err != nil {
		t.Fatalf("ListForPatient: %v", err)
	}
	if got == nil {
		t.Fatal("got nil, want a non-nil empty slice (would serialise as JSON null, not [])")
	}
	if len(got) != 0 {
		t.Errorf("got %d orders, want 0", len(got))
	}
}

func TestLiveDB_PatientHistoryFiltersByState(t *testing.T) {
	pool := patientOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newPatientOrdersFixture(t, ctx, pool)

	confirmed, err := f.svc.ListForPatient(ctx, f.patient, "CONFIRMED", 50, 0)
	if err != nil {
		t.Fatalf("ListForPatient(CONFIRMED): %v", err)
	}
	if len(confirmed) != 1 {
		t.Errorf("CONFIRMED returned %d, want 1", len(confirmed))
	}

	closed, err := f.svc.ListForPatient(ctx, f.patient, "CLOSED", 50, 0)
	if err != nil {
		t.Fatalf("ListForPatient(CLOSED): %v", err)
	}
	if len(closed) != 0 {
		t.Errorf("CLOSED returned %d, want 0", len(closed))
	}
}
