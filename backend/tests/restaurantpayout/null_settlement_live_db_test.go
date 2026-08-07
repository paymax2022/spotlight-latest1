package restaurantpayout_test

// ---------------------------------------------------------------------------
// D8 regression (live-DB): an order whose settlement_id is NULL — one created
// outside the escrow path — must still be transitionable and cancellable.
//
// Before the fix, restaurant/service.go scanned the NULLABLE settlement_id
// column into a Go string in transitionInternal and cancelAndRefund; the NULL
// scan errored and was masked as "restaurant: order not found", so the order
// could never advance or be cancelled. The fix COALESCEs settlement_id to '' in
// both reads (mirroring delivery.go) and skips the refund when there is no
// escrow to return.
//
// Skips unless TEST_DATABASE_URL/DATABASE_URL is set (same gate as the sibling
// live-DB tests). seedPendingOrder deliberately inserts NO settlement_id.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/restaurant"
)

func TestLiveDB_NullSettlement_TransitionAndCancel(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveRestaurantService(pool, newLiveLedgerService(pool))

	owner := seedUser(t, ctx, pool)
	customer := seedUser(t, ctx, pool)
	restID := seedRestaurant(t, ctx, pool, owner)

	// (1) Transition path: the owner advances a settlement-less order. This is the
	// exact call that previously returned "order not found".
	o1 := seedPendingOrder(t, ctx, pool, restID, customer)
	if err := svc.UpdateStatus(ctx, o1, owner, restaurant.OrderConfirmed); err != nil {
		t.Fatalf("owner→confirmed on null-settlement order: want allow, got %v", err)
	}
	assertOrderStatus(t, ctx, pool, o1, string(restaurant.OrderConfirmed))

	// (2) Cancel path: the owner cancels a settlement-less order. There is no escrow
	// to refund, so the cancel must succeed (refund skipped) and mark it cancelled.
	o2 := seedPendingOrder(t, ctx, pool, restID, customer)
	if err := svc.CancelOrder(ctx, o2, owner); err != nil {
		t.Fatalf("owner cancel of null-settlement order: want success (no refund), got %v", err)
	}
	assertOrderStatus(t, ctx, pool, o2, string(restaurant.OrderCancelled))
}

func assertOrderStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID, want string) {
	t.Helper()
	var got string
	if err := pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, orderID).Scan(&got); err != nil {
		t.Fatalf("read order status: %v", err)
	}
	if got != want {
		t.Fatalf("order %s status = %q; want %q", orderID, got, want)
	}
}
