package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for dispatch reassignment (Phase 15): rider decline →
// re-dispatch (DP-002), ops reassign + offline-assigned sweep (DP-005). Skipped unless
// TEST_DATABASE_URL/DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func reassignPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB reassign test")
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

// seedDriverAt inserts an online, approved driver at (lat,lng); status overridable.
func seedDriverAt(t *testing.T, ctx context.Context, pool *pgxpool.Pool, lat, lng float64, status string) string {
	t.Helper()
	id := uuid.New().String()
	reg := "REG-" + id[:6]
	_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test")
	if _, err := pool.Exec(ctx, `
		INSERT INTO drivers (user_id, name, vehicle_reg, status, verification_status, current_lat, current_lng, updated_at)
		VALUES ($1,'Rider',$2,$3,'approved',$4,$5,now())
		ON CONFLICT (user_id) DO UPDATE SET status=$3, current_lat=$4, current_lng=$5`,
		id, reg, status, lat, lng); err != nil {
		t.Fatalf("seed driver: %v", err)
	}
	return id
}

func hasOpenOffer(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID, riderID string) bool {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_delivery_offers WHERE order_id=$1 AND rider_id=$2 AND status='offered'`, orderID, riderID).Scan(&n); err != nil {
		t.Fatalf("count offers: %v", err)
	}
	return n > 0
}

func TestLiveDB_DispatchReassign(t *testing.T) {
	pool := reassignPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := NewService(pool, nil)

	// Isolate the shared driver pool.
	if _, err := pool.Exec(ctx, `UPDATE drivers SET status='offline' WHERE status='online'`); err != nil {
		t.Fatalf("isolate drivers: %v", err)
	}

	owner := uuid.New().String()
	customer := uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2),($3,$4) ON CONFLICT DO NOTHING`, owner, owner+"@t", customer, customer+"@t")
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, geo_lat, geo_lng) VALUES ($1,$2,'Reassign Kitchen','1 St',TRUE,6.5,3.4)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// --- DP-002: rider declines an offer → re-dispatch to remaining riders. ---
	r1 := seedDriverAt(t, ctx, pool, 6.5, 3.4, "online")
	oid := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, dispatch_status, idempotency_key, delivery_address, ready_at)
		VALUES ($1,$2,$3,1000,1000,'ready','searching',$4,'1 St',now())`,
		oid, customer, restID, "reassign-"+oid); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	if err := svc.DispatchOrder(ctx, oid); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if !hasOpenOffer(t, ctx, pool, oid, r1) {
		t.Fatal("r1 should have an open offer after dispatch")
	}
	// A rider with no offer can't decline.
	if err := svc.DeclineDelivery(ctx, oid, uuid.New().String()); err == nil {
		t.Error("declining without an open offer must fail")
	}
	// r1 declines → offer declined; a fresh rider now online gets re-offered.
	r2 := seedDriverAt(t, ctx, pool, 6.5, 3.4, "online")
	if err := svc.DeclineDelivery(ctx, oid, r1); err != nil {
		t.Fatalf("decline: %v", err)
	}
	var st string
	_ = pool.QueryRow(ctx, `SELECT status FROM restaurant_delivery_offers WHERE order_id=$1 AND rider_id=$2`, oid, r1).Scan(&st)
	if st != "declined" {
		t.Errorf("r1 offer = %s, want declined", st)
	}
	if !hasOpenOffer(t, ctx, pool, oid, r2) {
		t.Error("after decline+re-dispatch, r2 should now have an open offer")
	}

	// --- DP-005: an assigned order whose rider went offline is reassigned by the sweep. ---
	offlineRider := seedDriverAt(t, ctx, pool, 6.5, 3.4, "offline")
	oid2 := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, rider_id, subtotal_kobo, total_kobo, status, dispatch_status, idempotency_key, delivery_address, ready_at)
		VALUES ($1,$2,$3,$4,1000,1000,'ready','assigned',$5,'1 St',now())`,
		oid2, customer, restID, offlineRider, "reassign2-"+oid2); err != nil {
		t.Fatalf("seed assigned order: %v", err)
	}
	n, err := svc.SweepOfflineAssigned(ctx)
	if err != nil {
		t.Fatalf("sweep offline-assigned: %v", err)
	}
	if n < 1 {
		t.Fatalf("expected the offline-assigned order reassigned, got %d", n)
	}
	var riderAfter *string
	var dispatchAfter string
	_ = pool.QueryRow(ctx, `SELECT rider_id, dispatch_status FROM orders WHERE id=$1`, oid2).Scan(&riderAfter, &dispatchAfter)
	if riderAfter != nil {
		t.Errorf("reassigned order should have no rider, got %v", *riderAfter)
	}
	if dispatchAfter != "searching" {
		t.Errorf("reassigned order dispatch_status = %s, want searching", dispatchAfter)
	}

	// A picked-up order cannot be reassigned.
	oid3 := uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO orders (id, customer_id, restaurant_id, rider_id, subtotal_kobo, total_kobo, status, dispatch_status, idempotency_key, delivery_address) VALUES ($1,$2,$3,$4,1000,1000,'picked_up','assigned',$5,'1 St')`,
		oid3, customer, restID, offlineRider, "reassign3-"+oid3)
	if err := svc.ReassignOrder(ctx, oid3, "x"); err == nil {
		t.Error("a picked-up order must not be reassignable")
	}
}
