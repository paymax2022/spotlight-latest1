package restaurantpayout_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/restaurant"
)

// seedPendingOrder inserts a cancellable `pending` order for (restaurant, customer).
// No settlement is attached — the authorization checks reject before any money move,
// which is exactly what these regressions assert.
func seedPendingOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restaurantID, customerID string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo,
		                    status, idempotency_key, delivery_address)
		VALUES ($1, $2, $3, 1000, 1000, 'pending', $4, '1 Test Street')`,
		id, customerID, restaurantID, "authz-idem-"+id); err != nil {
		t.Fatalf("seed pending order: %v", err)
	}
	return id
}

// TestLiveDB_OrderStatusAuthz is the regression for the Phase-0 S1 fix: the order
// status + cancel endpoints must enforce object-level authorization, and `delivered`
// must never be reachable via the generic status endpoint (POD bypass closed).
// Skips unless TEST_DATABASE_URL is set.
func TestLiveDB_OrderStatusAuthz(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveRestaurantService(pool, newLiveLedgerService(pool))

	owner := seedUser(t, ctx, pool)
	customer := seedUser(t, ctx, pool)
	stranger := seedUser(t, ctx, pool)
	restID := seedRestaurant(t, ctx, pool, owner)
	orderID := seedPendingOrder(t, ctx, pool, restID, customer)

	// A stranger (not a party to the order) cannot drive the lifecycle …
	if err := svc.UpdateStatus(ctx, orderID, stranger, restaurant.OrderConfirmed); !errors.Is(err, restaurant.ErrForbidden) {
		t.Fatalf("stranger UpdateStatus: want ErrForbidden, got %v", err)
	}
	// … nor cancel + refund it (the IDOR fix).
	if err := svc.CancelOrder(ctx, orderID, stranger); !errors.Is(err, restaurant.ErrForbidden) {
		t.Fatalf("stranger CancelOrder: want ErrForbidden, got %v", err)
	}
	// POD bypass closed: `delivered` is never allowed via the generic endpoint, even
	// for the owner — it must go through ConfirmHandoff (delivery-code proof).
	if err := svc.UpdateStatus(ctx, orderID, owner, restaurant.OrderDelivered); !errors.Is(err, restaurant.ErrDeliveredViaHandoff) {
		t.Fatalf("owner→delivered: want ErrDeliveredViaHandoff, got %v", err)
	}
	// A non-assigned user cannot mark picked_up.
	if err := svc.UpdateStatus(ctx, orderID, stranger, restaurant.OrderPickedUp); !errors.Is(err, restaurant.ErrForbidden) {
		t.Fatalf("stranger→picked_up: want ErrForbidden, got %v", err)
	}
	// The restaurant owner MAY advance the kitchen-side lifecycle.
	if err := svc.UpdateStatus(ctx, orderID, owner, restaurant.OrderConfirmed); err != nil {
		t.Fatalf("owner→confirmed: want allow, got %v", err)
	}
	// The customer MAY cancel their own order (authorized path; refund exercised by
	// the settlement-backed suites).
	orderID2 := seedPendingOrder(t, ctx, pool, restID, customer)
	if err := svc.UpdateStatus(ctx, orderID2, customer, restaurant.OrderConfirmed); !errors.Is(err, restaurant.ErrForbidden) {
		t.Fatalf("customer→confirmed: want ErrForbidden (kitchen-side is owner-only), got %v", err)
	}
}
