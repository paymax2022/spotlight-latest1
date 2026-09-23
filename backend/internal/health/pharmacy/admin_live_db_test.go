package healthpharmacy_test

// ---------------------------------------------------------------------------
// LIVE-DB coverage for PHARMACY-001 (admin console wiring gaps closed this
// pass): GET /admin/dashboard, the /admin/orders status+fulfilment filter fix,
// and GET /admin/orders/:id.
//
// Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	healthpharmacy "spotlight/backend/internal/health/pharmacy"

	"spotlight/backend/internal/testsupport"
)

func adminPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping pharmacy admin live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

type adminFixture struct {
	svc                      *healthpharmacy.Service
	pool                     *pgxpool.Pool
	owner, patient           string
	pharmacy                 string
	confirmedID, deliveredID string
	pickupID                 string
}

// newAdminFixture seeds one APPROVED pharmacy and three orders in DISTINCT,
// known states/fulfilment methods so both the dashboard's per-state counts and
// the list's filters have an unambiguous, assertable baseline.
func newAdminFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) adminFixture {
	t.Helper()
	f := adminFixture{
		// Every admin read here is read-only — none of the write-path
		// collaborators (escrow, Rx gate, dispatch, payout, audit) participate,
		// so nil is honest (mirrors newInboxFixture in owner_orders_live_db_test.go).
		svc:  healthpharmacy.NewService(pool, nil, nil, nil, nil, nil, nil, nil),
		pool: pool,

		owner: uuid.New().String(), patient: uuid.New().String(),
		pharmacy:    uuid.New().String(),
		confirmedID: uuid.New().String(), deliveredID: uuid.New().String(), pickupID: uuid.New().String(),
	}
	for _, u := range []string{f.owner, f.patient} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	if _, err := pool.Exec(ctx,
		// provider_type='pharmacy' (the business entity), NOT 'pharmacist' (the
		// professional role other pharmacy fixtures use for tests that only
		// look up owner_user_id by id and never filter on provider_type) —
		// AdminDashboard's TotalPharmacies mirrors the EXACT predicate
		// DiscoverPharmacies/GetPharmacy use (service.go), which is
		// provider_type='pharmacy'. A 'pharmacist' row here would silently
		// never be counted.
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		 VALUES ($1,$2,'PHARMACY','pharmacy',$3,'APPROVED')`,
		f.pharmacy, f.owner, "Admin Fixture Pharmacy"); err != nil {
		t.Fatalf("seed provider: %v", err)
	}

	orders := []struct {
		id, state, fulfilment string
		totalKobo             int64
	}{
		{f.confirmedID, "CONFIRMED", "PICKUP", 100000},
		{f.deliveredID, "DELIVERED", "DELIVERY", 250000},
		{f.pickupID, "COLLECTED", "PICKUP", 75000},
	}
	for _, o := range orders {
		if _, err := pool.Exec(ctx,
			`INSERT INTO pharmacy_orders (id, patient_id, pharmacy_provider_id, state, fulfilment_method,
			     total_kobo, pickup_code, idempotency_key)
			 VALUES ($1,$2,$3,$4,$5,$6,'PICKUP-SECRET-ADMIN',$7)`,
			o.id, f.patient, f.pharmacy, o.state, o.fulfilment, o.totalKobo, "idem-admin-"+o.id); err != nil {
			t.Fatalf("seed order %s: %v", o.id, err)
		}
	}
	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM pharmacy_orders WHERE id IN ($1,$2,$3)`, f.confirmedID, f.deliveredID, f.pickupID)
		pool.Exec(bg, `DELETE FROM pharmacy_products WHERE pharmacy_provider_id = $1`, f.pharmacy)
		pool.Exec(bg, `DELETE FROM pharmacy_orders WHERE pharmacy_provider_id = $1`, f.pharmacy)
		pool.Exec(bg, `DELETE FROM health_providers WHERE id = $1`, f.pharmacy)
	})
	return f
}

// TestLiveDB_AdminDashboard_CountsAndTotalsAreExact seeds a KNOWN set of
// orders and asserts the dashboard's per-state counts / total include exactly
// those rows (>=, since the shared DB may carry rows from other tests/fixtures
// — the assertion is that OUR rows are correctly counted, not that we own the
// whole table) and that every OrderState key is present even at zero.
func TestLiveDB_AdminDashboard_CountsAndTotalsAreExact(t *testing.T) {
	pool := adminPool(t)
	ctx := context.Background()

	// Service used only for the baseline/after reads — no write-path
	// collaborators needed (mirrors newAdminFixture's own nil-safe wiring).
	svc := healthpharmacy.NewService(pool, nil, nil, nil, nil, nil, nil, nil)

	before, err := svc.AdminDashboard(ctx)
	if err != nil {
		t.Fatalf("AdminDashboard (baseline): %v", err)
	}
	beforeConfirmed := before.OrdersByState["CONFIRMED"]
	beforeDelivered := before.OrdersByState["DELIVERED"]
	beforeCollected := before.OrdersByState["COLLECTED"]
	beforeTotal := before.TotalOrders
	beforePharmacies := before.TotalPharmacies

	// Seed AFTER the baseline read so we know exactly what this fixture added.
	f := newAdminFixture(t, ctx, pool)
	_ = f

	after, err := svc.AdminDashboard(ctx)
	if err != nil {
		t.Fatalf("AdminDashboard: %v", err)
	}

	if got, want := after.OrdersByState["CONFIRMED"], beforeConfirmed+1; got != want {
		t.Errorf("CONFIRMED count = %d, want %d", got, want)
	}
	if got, want := after.OrdersByState["DELIVERED"], beforeDelivered+1; got != want {
		t.Errorf("DELIVERED count = %d, want %d", got, want)
	}
	if got, want := after.OrdersByState["COLLECTED"], beforeCollected+1; got != want {
		t.Errorf("COLLECTED count = %d, want %d", got, want)
	}
	if got, want := after.TotalOrders, beforeTotal+3; got != want {
		t.Errorf("TotalOrders = %d, want %d", got, want)
	}
	// Every documented OrderState must be present in the map (even 0), so the
	// admin console can render a complete breakdown.
	for _, st := range []string{"CREATED", "RX_PENDING_VERIFICATION", "CONFIRMED", "DISPENSED",
		"IN_DELIVERY", "READY_FOR_PICKUP", "DELIVERED", "COLLECTED", "CLOSED", "CANCELLED", "REFUNDED"} {
		if _, ok := after.OrdersByState[st]; !ok {
			t.Errorf("OrdersByState missing key %q", st)
		}
	}
	// TotalPharmacies must include the ONE APPROVED pharmacy this fixture seeded.
	if got, want := after.TotalPharmacies, beforePharmacies+1; got != want {
		t.Errorf("TotalPharmacies = %d, want %d (baseline %d + this fixture's 1 APPROVED pharmacy)", got, want, beforePharmacies)
	}
	// PlatformRevenueKoboWeek must never be negative — it is a SUM of
	// non-negative recorded earnings (commission_earnings.spotlight_revenue_kobo
	// CHECK's the column, but assert defensively at this layer too).
	if after.PlatformRevenueKoboWeek < 0 {
		t.Errorf("PlatformRevenueKoboWeek = %d, must be >= 0", after.PlatformRevenueKoboWeek)
	}
}

// TestLiveDB_AdminListOrders_FiltersByStateAndFulfilment is the regression
// test for the filter fix: before this pass, AdminListOrders accepted only
// state + pharmacy_provider_id, so a fulfilment_method filter silently
// returned everything instead of narrowing.
func TestLiveDB_AdminListOrders_FiltersByStateAndFulfilment(t *testing.T) {
	pool := adminPool(t)
	ctx := context.Background()
	f := newAdminFixture(t, ctx, pool)

	// state filter alone.
	confirmed, err := f.svc.AdminListOrders(ctx, "CONFIRMED", "", f.pharmacy)
	if err != nil {
		t.Fatalf("AdminListOrders(state=CONFIRMED): %v", err)
	}
	if len(confirmed) != 1 || confirmed[0]["id"] != f.confirmedID {
		t.Fatalf("state=CONFIRMED returned %v, want exactly [%s]", confirmed, f.confirmedID)
	}

	// fulfilment filter alone — this is the actual regression: PICKUP should
	// return confirmedID + pickupID (2 rows), not all 3.
	pickup, err := f.svc.AdminListOrders(ctx, "", "PICKUP", f.pharmacy)
	if err != nil {
		t.Fatalf("AdminListOrders(fulfilment=PICKUP): %v", err)
	}
	if len(pickup) != 2 {
		t.Fatalf("fulfilment=PICKUP returned %d rows, want 2 (confirmedID + pickupID) — filter is a no-op if this is 3", len(pickup))
	}
	for _, row := range pickup {
		if row["id"] != f.confirmedID && row["id"] != f.pickupID {
			t.Errorf("fulfilment=PICKUP returned unexpected order %v", row["id"])
		}
	}

	// fulfilment filter should EXCLUDE the DELIVERY order.
	delivery, err := f.svc.AdminListOrders(ctx, "", "DELIVERY", f.pharmacy)
	if err != nil {
		t.Fatalf("AdminListOrders(fulfilment=DELIVERY): %v", err)
	}
	if len(delivery) != 1 || delivery[0]["id"] != f.deliveredID {
		t.Fatalf("fulfilment=DELIVERY returned %v, want exactly [%s]", delivery, f.deliveredID)
	}

	// combined state + fulfilment.
	combined, err := f.svc.AdminListOrders(ctx, "COLLECTED", "PICKUP", f.pharmacy)
	if err != nil {
		t.Fatalf("AdminListOrders(state=COLLECTED, fulfilment=PICKUP): %v", err)
	}
	if len(combined) != 1 || combined[0]["id"] != f.pickupID {
		t.Fatalf("combined filter returned %v, want exactly [%s]", combined, f.pickupID)
	}

	// a state that HAS orders elsewhere but not fulfilment=DELIVERY within
	// this pharmacy must return nothing (proves AND, not OR).
	none, err := f.svc.AdminListOrders(ctx, "CONFIRMED", "DELIVERY", f.pharmacy)
	if err != nil {
		t.Fatalf("AdminListOrders(state=CONFIRMED, fulfilment=DELIVERY): %v", err)
	}
	if len(none) != 0 {
		t.Fatalf("state=CONFIRMED + fulfilment=DELIVERY returned %d rows, want 0", len(none))
	}
}

// TestLiveDB_AdminGetOrder_ReadsAnyOrderWithoutOwnershipScoping is the
// regression test for the missing single-order admin read: before this pass,
// only AdminListOrders existed, so the admin console's order-detail view had
// nothing to call.
func TestLiveDB_AdminGetOrder_ReadsAnyOrderWithoutOwnershipScoping(t *testing.T) {
	pool := adminPool(t)
	ctx := context.Background()
	f := newAdminFixture(t, ctx, pool)

	o, err := f.svc.AdminGetOrder(ctx, f.deliveredID)
	if err != nil {
		t.Fatalf("AdminGetOrder: %v", err)
	}
	if o.ID != f.deliveredID {
		t.Errorf("id = %s, want %s", o.ID, f.deliveredID)
	}
	if o.TotalKobo != 250000 {
		t.Errorf("total_kobo = %d, want 250000", o.TotalKobo)
	}
	if o.State != "DELIVERED" {
		t.Errorf("state = %s, want DELIVERED", o.State)
	}
	// The admin caller is not the patient — Get()'s existing redaction (reused
	// by AdminGetOrder) must still withhold the counter pickup credential.
	if o.PickupCode != nil {
		t.Errorf("pickup_code = %q leaked into the admin read — it is patient-only", *o.PickupCode)
	}

	// A nonexistent order id must error, not return a zero-value order.
	if _, err := f.svc.AdminGetOrder(ctx, uuid.New().String()); err == nil {
		t.Error("AdminGetOrder(nonexistent id): want error, got nil")
	}
}
