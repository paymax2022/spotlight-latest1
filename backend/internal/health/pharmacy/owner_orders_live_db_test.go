package healthpharmacy_test

// LIVE-DB tests for the pharmacy owner's order inbox.
//
// The gap this closes: a pharmacy takes money on-platform (POST /orders holds
// the payment) and has a complete fulfilment lifecycle server-side —
// confirm → dispense → dispatch → complete, plus cancel/refund. But there was no
// way for the owner to LIST their own orders: only GET /orders/:id, which needs
// an id you already have, and an admin-only list. So funds sat in escrow while
// the merchant had no way to discover what to dispense.
//
// Two properties matter beyond "it returns rows":
//   - it is scoped to pharmacies the caller OWNS (an inbox that leaked another
//     pharmacy's orders would expose patient identities and order contents);
//   - it does NOT return pickup_code. Service.Get strips that for every reader
//     who is not the patient, because it is the counter credential the patient
//     presents to collect. A list that returned it would hand the pharmacy the
//     very token it is meant to check against.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	healthpharmacy "spotlight/backend/internal/health/pharmacy"
)

func ownerOrdersPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping pharmacy owner-orders live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	return pool
}

type inboxFixture struct {
	svc              *healthpharmacy.Service
	pool             *pgxpool.Pool
	owner, other     string
	patient          string
	pharmacy, rival  string
	orderID, rivalID string
}

func newInboxFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) inboxFixture {
	t.Helper()
	f := inboxFixture{
		// The inbox is a read-only query — none of the write-path collaborators
		// (escrow, Rx gate, dispatch, payout, audit) participate, so nil is honest.
		svc: healthpharmacy.NewService(pool, nil, nil, nil, nil, nil, nil, nil), pool: pool,
		owner: uuid.New().String(), other: uuid.New().String(), patient: uuid.New().String(),
		pharmacy: uuid.New().String(), rival: uuid.New().String(),
		orderID: uuid.New().String(), rivalID: uuid.New().String(),
	}
	for _, u := range []string{f.owner, f.other, f.patient} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	// Two pharmacies with DIFFERENT owners, so the scoping assertion is real.
	for _, p := range []struct{ id, owner, name string }{
		{f.pharmacy, f.owner, "Inbox Pharmacy"},
		{f.rival, f.other, "Rival Pharmacy"},
	} {
		if _, err := pool.Exec(ctx,
			// Mirrors real rows: domain is the module ('PHARMACY'), provider_type the
			// professional role ('pharmacist').
			`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
			 VALUES ($1,$2,'PHARMACY','pharmacist',$3,'APPROVED')`, p.id, p.owner, p.name); err != nil {
			t.Fatalf("seed provider: %v", err)
		}
	}
	for _, o := range []struct{ id, ph, state string }{
		// CONFIRMED = paid and awaiting dispense, which is exactly what an
		// inbox is for.
		{f.orderID, f.pharmacy, "CONFIRMED"},
		{f.rivalID, f.rival, "CONFIRMED"},
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO pharmacy_orders (id, patient_id, pharmacy_provider_id, state, fulfilment_method,
			     total_kobo, pickup_code, idempotency_key)
			 VALUES ($1,$2,$3,$4,'PICKUP',450000,'PICKUP-SECRET-123',$5)`,
			o.id, f.patient, o.ph, o.state, "idem-"+o.id); err != nil {
			t.Fatalf("seed order: %v", err)
		}
	}
	t.Cleanup(func() {
		bg := context.Background()
		// IN ($1,$2), not = ANY($1) with a []string: these id columns are uuid, and
		// `uuid = ANY(text[])` has no operator — the delete errors, the error is
		// ignored here, and the fixture survives as a real APPROVED pharmacy that
		// DiscoverPharmacies then serves to customers.
		pool.Exec(bg, `DELETE FROM pharmacy_orders WHERE id IN ($1,$2)`, f.orderID, f.rivalID)
		pool.Exec(bg, `DELETE FROM pharmacy_products WHERE pharmacy_provider_id IN ($1,$2)`, f.pharmacy, f.rival)
		pool.Exec(bg, `DELETE FROM pharmacy_orders WHERE pharmacy_provider_id IN ($1,$2)`, f.pharmacy, f.rival)
		pool.Exec(bg, `DELETE FROM health_providers WHERE id IN ($1,$2)`, f.pharmacy, f.rival)
	})
	return f
}

func TestLiveDB_OwnerSeesTheirPharmacysOrders(t *testing.T) {
	pool := ownerOrdersPool(t)
	// t.Cleanup runs AFTER the test function returns, so a `defer pool.Close()`
	// would shut the pool BEFORE the row cleanups fire — and since those Execs
	// ignore their errors, the failure is silent and the fixtures survive.
	// Registered first, so LIFO makes it run last.
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	orders, err := f.svc.ListForOwner(ctx, f.owner, "", 50, 0)
	if err != nil {
		t.Fatalf("ListForOwner: %v", err)
	}
	if len(orders) != 1 {
		t.Fatalf("got %d orders, want exactly 1 (their own)", len(orders))
	}
	if orders[0].ID != f.orderID {
		t.Errorf("order id = %s, want %s", orders[0].ID, f.orderID)
	}
	if orders[0].TotalKobo != 450000 {
		t.Errorf("total = %d, want 450000", orders[0].TotalKobo)
	}
}

func TestLiveDB_InboxNeverLeaksAnotherPharmacysOrders(t *testing.T) {
	pool := ownerOrdersPool(t)
	// t.Cleanup runs AFTER the test function returns, so a `defer pool.Close()`
	// would shut the pool BEFORE the row cleanups fire — and since those Execs
	// ignore their errors, the failure is silent and the fixtures survive.
	// Registered first, so LIFO makes it run last.
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	orders, err := f.svc.ListForOwner(ctx, f.owner, "", 50, 0)
	if err != nil {
		t.Fatalf("ListForOwner: %v", err)
	}
	for _, o := range orders {
		if o.ID == f.rivalID {
			t.Fatal("a rival pharmacy's order appeared in this owner's inbox — patient identity and order contents leak")
		}
		if o.PharmacyProviderID != f.pharmacy {
			t.Errorf("order from pharmacy %s in %s's inbox", o.PharmacyProviderID, f.pharmacy)
		}
	}

	// And a user who owns no pharmacy gets nothing, rather than everything.
	none, err := f.svc.ListForOwner(ctx, f.patient, "", 50, 0)
	if err != nil {
		t.Fatalf("ListForOwner(patient): %v", err)
	}
	if len(none) != 0 {
		t.Errorf("a non-owner got %d orders, want 0", len(none))
	}
}

func TestLiveDB_InboxWithholdsThePickupCode(t *testing.T) {
	pool := ownerOrdersPool(t)
	// t.Cleanup runs AFTER the test function returns, so a `defer pool.Close()`
	// would shut the pool BEFORE the row cleanups fire — and since those Execs
	// ignore their errors, the failure is silent and the fixtures survive.
	// Registered first, so LIFO makes it run last.
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	orders, err := f.svc.ListForOwner(ctx, f.owner, "", 50, 0)
	if err != nil {
		t.Fatalf("ListForOwner: %v", err)
	}
	if len(orders) == 0 {
		t.Fatal("no orders")
	}
	// Service.Get strips this for every non-patient reader; the list must agree.
	// It is the credential the patient presents at the counter — handing it to the
	// pharmacy defeats the check it exists for.
	if orders[0].PickupCode != nil {
		t.Errorf("pickup_code = %q leaked into the owner's inbox — it is patient-only", *orders[0].PickupCode)
	}
}

func TestLiveDB_InboxFiltersByState(t *testing.T) {
	pool := ownerOrdersPool(t)
	// t.Cleanup runs AFTER the test function returns, so a `defer pool.Close()`
	// would shut the pool BEFORE the row cleanups fire — and since those Execs
	// ignore their errors, the failure is silent and the fixtures survive.
	// Registered first, so LIFO makes it run last.
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	// The inbox's whole purpose is "what do I act on now", so filtering has to work.
	paid, err := f.svc.ListForOwner(ctx, f.owner, "CONFIRMED", 50, 0)
	if err != nil {
		t.Fatalf("ListForOwner(CONFIRMED): %v", err)
	}
	if len(paid) != 1 {
		t.Errorf("CONFIRMED returned %d, want 1", len(paid))
	}

	completed, err := f.svc.ListForOwner(ctx, f.owner, "CLOSED", 50, 0)
	if err != nil {
		t.Fatalf("ListForOwner(CLOSED): %v", err)
	}
	if len(completed) != 0 {
		t.Errorf("CLOSED returned %d, want 0", len(completed))
	}
}

func TestLiveDB_InboxBoundsThePageSize(t *testing.T) {
	pool := ownerOrdersPool(t)
	// t.Cleanup runs AFTER the test function returns, so a `defer pool.Close()`
	// would shut the pool BEFORE the row cleanups fire — and since those Execs
	// ignore their errors, the failure is silent and the fixtures survive.
	// Registered first, so LIFO makes it run last.
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	// A client-supplied limit must not be able to ask for the whole table.
	if _, err := f.svc.ListForOwner(ctx, f.owner, "", 100000, 0); err != nil {
		t.Fatalf("a large limit should be clamped, not rejected: %v", err)
	}
	// A nonsensical limit must not produce an error or an empty page.
	got, err := f.svc.ListForOwner(ctx, f.owner, "", 0, 0)
	if err != nil {
		t.Fatalf("zero limit: %v", err)
	}
	if len(got) != 1 {
		t.Errorf("zero limit returned %d rows, want the default page (1)", len(got))
	}
}
