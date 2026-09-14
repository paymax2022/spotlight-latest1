package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for the restaurant pickup code: generated when an
// order goes `ready`, required (distinct from the customer delivery_code) for
// the assigned rider to confirm pickup. Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_ConfirmPickupRequiresPickupCode(t *testing.T) {
	pool := reassignPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	customer := uuid.New().String()
	rider := seedDriverAt(t, ctx, pool, 6.5, 3.4, "online")
	_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2),($3,$4) ON CONFLICT DO NOTHING`,
		owner, owner+"@t", customer, customer+"@t")
	testsupport.CleanupUser(t, pool, owner)
	testsupport.CleanupUser(t, pool, customer)

	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, geo_lat, geo_lng) VALUES ($1,$2,'Pickup Kitchen','1 St',TRUE,6.5,3.4)`,
		restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// Seed an order already assigned to `rider`, sitting in 'preparing' — so
	// transitioning it to 'ready' below is what generates the pickup code.
	oid := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, rider_id, subtotal_kobo, total_kobo, status, dispatch_status, idempotency_key, delivery_address)
		VALUES ($1,$2,$3,$4,1000,1000,'preparing','assigned',$5,'1 St')`,
		oid, customer, restID, rider, "pickup-"+oid); err != nil {
		t.Fatalf("seed order: %v", err)
	}

	if err := svc.transitionInternal(ctx, oid, OrderReady); err != nil {
		t.Fatalf("transition to ready: %v", err)
	}

	var code string
	if err := pool.QueryRow(ctx, `SELECT pickup_code FROM orders WHERE id=$1`, oid).Scan(&code); err != nil {
		t.Fatalf("read pickup code: %v", err)
	}
	if code == "" {
		t.Fatal("expected a pickup_code to be generated when the order went ready")
	}
	wrongCode := "0000"
	if code == wrongCode {
		wrongCode = "1111"
	}

	// Wrong code is rejected and the order stays ready (not picked_up).
	if err := svc.ConfirmPickup(ctx, oid, rider, wrongCode); err == nil {
		t.Error("expected an incorrect pickup code to be rejected")
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, oid).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != string(OrderReady) {
		t.Errorf("status after wrong code = %s, want ready (unchanged)", status)
	}

	// A rider who isn't the assigned one can't confirm even with the right code.
	if err := svc.ConfirmPickup(ctx, oid, uuid.New().String(), code); err == nil {
		t.Error("expected a non-assigned rider to be rejected")
	}

	// Correct code from the assigned rider succeeds and advances the order.
	if err := svc.ConfirmPickup(ctx, oid, rider, code); err != nil {
		t.Fatalf("confirm pickup with correct code: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, oid).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != string(OrderPickedUp) {
		t.Errorf("status after correct code = %s, want picked_up", status)
	}
}
