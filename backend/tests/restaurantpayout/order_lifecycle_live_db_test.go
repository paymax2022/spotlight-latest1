package restaurantpayout_test

// ---------------------------------------------------------------------------
// LIVE-DB test for the merchant order-management happy path (slice 3): the
// restaurant owner advances a placed order through the kitchen-side lifecycle
// pending → confirmed → preparing → ready. Marking `ready` kicks off rider
// auto-dispatch; a dispatch hiccup in the test env (no geocoder / no riders)
// must NOT roll back the transition (service.transitionInternal contract), so
// the status must still land on `ready`.
//
// This locks the state transitions the merchant order-detail screen drives
// (app/food/restaurant/order/[orderId].tsx: Confirm → Start preparing →
// Mark ready). Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"spotlight/backend/internal/restaurant"
)

func TestLiveDB_MerchantOrderLifecycle(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newLiveRestaurantService(pool, newLiveLedgerService(pool))

	owner := seedUser(t, ctx, pool)
	customer := seedUser(t, ctx, pool)
	restID := seedRestaurant(t, ctx, pool, owner)
	orderID := seedPendingOrder(t, ctx, pool, restID, customer)

	steps := []restaurant.OrderStatus{
		restaurant.OrderConfirmed,
		restaurant.OrderPreparing,
		restaurant.OrderReady,
	}
	for _, next := range steps {
		if err := svc.UpdateStatus(ctx, orderID, owner, next); err != nil {
			t.Fatalf("owner advance to %s: %v", next, err)
		}
		assertOrderStatus(t, ctx, pool, orderID, string(next))
	}
}
