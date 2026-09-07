package healthlab

// Live-DB regressions for the two lab catalog/history reads the mobile Lab
// Home Screen calls but which had no backend route at all until now:
//   GET /health/lab/packages  (bundle catalog, ListPackages)
//   GET /health/lab/orders    (patient's own order history, ListOrdersForPatient)
//
// Both previously 404ed unconditionally — this pins that the service methods
// behind the new routes actually return real rows, correctly scoped.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func listEndpointsLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping lab list-endpoints live-DB tests")
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

// seedLabTestUser inserts a minimal auth.users row — health_providers.owner_user_id
// and lab_orders.patient_id both FK-reference auth.users, so any actor id used
// in these tests must exist there first.
func seedLabTestUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed user %s: %v", id, err)
	}
	testsupport.CleanupUser(t, pool, id)
}

func seedLabProvider(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		 VALUES ($1,$2,'LAB','lab','List Endpoints Test Lab','APPROVED')`, id, ownerID); err != nil {
		t.Fatalf("seed lab provider: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM health_providers WHERE id=$1`, id)
	})
	return id
}

func TestLiveDB_ListPackages_ReturnsActiveBundles(t *testing.T) {
	pool := listEndpointsLivePool(t)
	ctx := context.Background()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)

	owner := uuid.New().String()
	seedLabTestUser(t, ctx, pool, owner)
	labID := seedLabProvider(t, ctx, pool, owner)

	activeID := uuid.New().String()
	inactiveID := uuid.New().String()
	for _, row := range []struct {
		id     string
		name   string
		active bool
	}{
		{activeID, "Full Body Screening", true},
		{inactiveID, "Discontinued Panel", false},
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO lab_packages (id, lab_provider_id, name, description, prep_instructions, tat_hours, price_kobo, test_ids, active)
			 VALUES ($1,$2,$3,'desc','fast 8h',24,500000,'{}',$4)`,
			row.id, labID, row.name, row.active); err != nil {
			t.Fatalf("seed package %s: %v", row.name, err)
		}
		t.Cleanup(func(id string) func() {
			return func() { pool.Exec(context.Background(), `DELETE FROM lab_packages WHERE id=$1`, id) }
		}(row.id))
	}

	got, err := svc.ListPackages(ctx, labID)
	if err != nil {
		t.Fatalf("ListPackages: %v", err)
	}
	seen := map[string]bool{}
	for _, p := range got {
		seen[p.ID] = true
	}
	if !seen[activeID] {
		t.Errorf("active package %s missing from ListPackages result", activeID)
	}
	if seen[inactiveID] {
		t.Errorf("inactive package %s leaked into ListPackages result", inactiveID)
	}
}

func TestLiveDB_ListOrdersForPatient_ScopedToCaller(t *testing.T) {
	pool := listEndpointsLivePool(t)
	ctx := context.Background()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)

	patient := uuid.New().String()
	other := uuid.New().String()
	owner := uuid.New().String()
	seedLabTestUser(t, ctx, pool, patient)
	seedLabTestUser(t, ctx, pool, other)
	seedLabTestUser(t, ctx, pool, owner)
	labID := seedLabProvider(t, ctx, pool, owner)

	mine := uuid.New().String()
	notMine := uuid.New().String()
	for _, row := range []struct{ id, patientID string }{
		{mine, patient},
		{notMine, other},
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO lab_orders (id, patient_id, lab_provider_id, state, collection_method, total_kobo, idempotency_key)
			 VALUES ($1,$2,$3,'CREATED','WALK_IN',650000,$4)`,
			row.id, row.patientID, labID, "idem-"+row.id); err != nil {
			t.Fatalf("seed order: %v", err)
		}
		t.Cleanup(func(id string) func() {
			return func() { pool.Exec(context.Background(), `DELETE FROM lab_orders WHERE id=$1`, id) }
		}(row.id))
	}

	got, err := svc.ListOrdersForPatient(ctx, patient)
	if err != nil {
		t.Fatalf("ListOrdersForPatient: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d orders, want exactly 1 (the caller's own)", len(got))
	}
	if got[0].ID != mine {
		t.Errorf("returned order %s, want the caller's own order %s", got[0].ID, mine)
	}
	if got[0].PatientID != patient {
		t.Errorf("PatientID = %q, want %q", got[0].PatientID, patient)
	}
}

// A patient with no orders yet must get an empty list, not an error or null —
// the exact shape mismatch that crashed the mobile lab tests client.
func TestLiveDB_ListOrdersForPatient_EmptyIsEmptyNotNil(t *testing.T) {
	pool := listEndpointsLivePool(t)
	ctx := context.Background()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)

	got, err := svc.ListOrdersForPatient(ctx, uuid.New().String())
	if err != nil {
		t.Fatalf("ListOrdersForPatient: %v", err)
	}
	if got == nil {
		t.Error("got nil slice, want a non-nil empty slice so the handler serialises [] rather than null")
	}
	if len(got) != 0 {
		t.Errorf("got %d orders for a brand-new patient id, want 0", len(got))
	}
}
