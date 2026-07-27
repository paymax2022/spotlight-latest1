package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for dispatch fairness + SLA (Phase 7): the candidate
// gatherer (load + last-assigned + distance signals) and the DispatchOrder SLA
// timeline (first_offered_at / dispatch_attempts). Skipped unless TEST_DATABASE_URL/
// DATABASE_URL is set. Requires the restaurant, autodispatch, transport `drivers`,
// and dispatch-SLA migrations.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func dispatchLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB dispatch test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

// seedDriver inserts an online, approved rider with a pin + load. If it can't (the
// drivers schema differs), the test skips rather than failing.
func seedDriver(t *testing.T, ctx context.Context, pool *pgxpool.Pool, lat, lng float64) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO drivers (user_id, name, status, verification_status, current_lat, current_lng)
		VALUES ($1,'Rider','online','approved',$2,$3)
		ON CONFLICT (user_id) DO UPDATE SET status='online', verification_status='approved', current_lat=$2, current_lng=$3`,
		id, lat, lng); err != nil {
		t.Skipf("drivers schema not seedable here (%v) — skipping", err)
	}
	return id
}

func TestLiveDB_DispatchFairnessAndSLA(t *testing.T) {
	pool := dispatchLivePool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	customer := uuid.New().String()
	for _, u := range []string{owner, customer} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, geo_lat, geo_lng) VALUES ($1,$2,'Dispatch Kitchen','1 St',TRUE,6.5,3.4)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	near := seedDriver(t, ctx, pool, 6.5, 3.4) // right at the restaurant
	far := seedDriver(t, ctx, pool, 7.5, 4.5)  // ~150km away
	busy := seedDriver(t, ctx, pool, 6.5, 3.4) // co-located but saturated

	// Saturate `busy` with baseMaxRiderLoad active orders so it is filtered out.
	for i := 0; i < baseMaxRiderLoad; i++ {
		oid := uuid.New().String()
		if _, err := pool.Exec(ctx, `
			INSERT INTO orders (id, customer_id, restaurant_id, rider_id, subtotal_kobo, total_kobo, status, dispatch_status, idempotency_key, delivery_address)
			VALUES ($1,$2,$3,$4,1000,1000,'preparing','assigned',$5,'x')`,
			oid, customer, restID, busy, "load-"+oid); err != nil {
			t.Fatalf("seed busy load: %v", err)
		}
	}

	// The order to dispatch (ready).
	orderID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, idempotency_key, delivery_address, ready_at)
		VALUES ($1,$2,$3,2000,2000,'ready',$4,'1 Test Street', now())`,
		orderID, customer, restID, "disp-"+orderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}

	if err := svc.DispatchOrder(ctx, orderID); err != nil {
		t.Fatalf("dispatch: %v", err)
	}

	// Offered set: near + far are eligible; busy (at the load cap) must be excluded.
	offered := map[string]bool{}
	rows, err := pool.Query(ctx, `SELECT rider_id FROM restaurant_delivery_offers WHERE order_id=$1 AND status='offered'`, orderID)
	if err != nil {
		t.Fatalf("read offers: %v", err)
	}
	for rows.Next() {
		var rid string
		_ = rows.Scan(&rid)
		offered[rid] = true
	}
	rows.Close()
	if !offered[near] {
		t.Error("nearest eligible rider should be offered")
	}
	if offered[busy] {
		t.Error("saturated rider (at load cap) must NOT be offered")
	}
	_ = far // far is eligible too (within fan-out); not asserted strictly

	// SLA timeline: first_offered_at stamped, one attempt counted.
	var firstOffered *string
	var attempts int
	if err := pool.QueryRow(ctx, `SELECT first_offered_at::text, dispatch_attempts FROM orders WHERE id=$1`, orderID).Scan(&firstOffered, &attempts); err != nil {
		t.Fatalf("read sla: %v", err)
	}
	if firstOffered == nil {
		t.Error("first_offered_at should be stamped after dispatch")
	}
	if attempts != 1 {
		t.Errorf("dispatch_attempts should be 1 after one dispatch, got %d", attempts)
	}
}
