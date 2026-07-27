package restaurantpayout_test

// ---------------------------------------------------------------------------
// LIVE-DB integration test for the Phase-2 delivery-zone gate
// (restaurant.Service.PlaceOrder + maps.OwnerZoneChecker over PostGIS
// service_areas). Skipped unless TEST_DATABASE_URL/DATABASE_URL is set — the same
// gate as the other live-DB suites. Requires the maps_core migration
// (service_areas + PostGIS) and the restaurant migration (restaurants, menu_items,
// orders, orders.tip_kobo).
//
// The gate runs BEFORE any money moves, so the out-of-zone rejection needs no
// funded wallet: PlaceOrder must return ErrOutsideDeliveryZone and write no order.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/maps"
	"spotlight/backend/internal/restaurant"
)

// seedOpenRestaurant inserts an OPEN restaurant (with a pin) owned by ownerID.
func seedOpenRestaurant(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO restaurants (id, owner_id, name, address, is_open, geo_lat, geo_lng)
		VALUES ($1, $2, $3, '1 Test Street', TRUE, 6.5, 3.4)`,
		id, ownerID, "Zone Kitchen "+id[:8]); err != nil {
		t.Fatalf("seed open restaurant: %v", err)
	}
	return id
}

// seedMenuItem inserts one available menu item and returns its id.
func seedMenuItem(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restaurantID string, priceKobo int64) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO menu_items (id, restaurant_id, name, price_kobo, is_available)
		VALUES ($1, $2, 'Jollof', $3, TRUE)`, id, restaurantID, priceKobo); err != nil {
		t.Fatalf("seed menu item: %v", err)
	}
	return id
}

// seedOwnerZone inserts a service-area square (lng 3.3..3.5, lat 6.4..6.6) owned by
// ownerID — so (6.5,3.4) is inside and (7.5,4.5) is outside.
func seedOwnerZone(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO service_areas (id, owner_id, name, geog)
		VALUES ($1, $2, 'test-zone',
		        ST_GeogFromText('POLYGON((3.3 6.4, 3.5 6.4, 3.5 6.6, 3.3 6.6, 3.3 6.4))'))`,
		"zone-"+uuid.New().String(), ownerID); err != nil {
		t.Fatalf("seed service_area: %v", err)
	}
}

func newZoneAwareRestaurantService(pool *pgxpool.Pool) *restaurant.Service {
	settlementSvc := settlement.NewService(pool, newLiveLedgerService(pool))
	return restaurant.NewService(pool, settlementSvc).
		WithZoneChecker(maps.NewOwnerZoneChecker(pool))
}

// TestLiveDB_DeliveryZoneGate is the Phase-2 regression: when the restaurant owner
// has drawn a service area, a destination outside it is rejected (no money moves, no
// order row), while a destination inside it passes the gate.
func TestLiveDB_DeliveryZoneGate(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newZoneAwareRestaurantService(pool)

	owner := seedUser(t, ctx, pool)
	customer := seedUser(t, ctx, pool)
	restID := seedOpenRestaurant(t, ctx, pool, owner)
	itemID := seedMenuItem(t, ctx, pool, restID, 2_000)
	seedOwnerZone(t, ctx, pool, owner)

	outReq := restaurant.PlaceOrderRequest{
		Items:           []restaurant.OrderItemInput{{MenuItemID: itemID, Quantity: 1}},
		DeliveryAddress: "Somewhere far",
		IdempotencyKey:  "zone-out-" + uuid.New().String(),
		DeliveryLat:     f64(7.5), // outside the seeded square
		DeliveryLng:     f64(4.5),
	}
	if _, err := svc.PlaceOrder(ctx, restID, customer, outReq); !errors.Is(err, restaurant.ErrOutsideDeliveryZone) {
		t.Fatalf("out-of-zone PlaceOrder: want ErrOutsideDeliveryZone, got %v", err)
	}
	// No order (and thus no escrow) should have been created for the rejected request.
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM orders WHERE idempotency_key=$1`, outReq.IdempotencyKey).Scan(&n); err != nil {
		t.Fatalf("count orders: %v", err)
	}
	if n != 0 {
		t.Fatalf("rejected order must not be persisted, found %d rows", n)
	}

	// A destination INSIDE the zone passes the gate. It may still fail later (e.g. the
	// customer's wallet is unfunded for the escrow debit) — the ONLY assertion is that
	// it is not blocked by the zone gate.
	inReq := restaurant.PlaceOrderRequest{
		Items:           []restaurant.OrderItemInput{{MenuItemID: itemID, Quantity: 1}},
		DeliveryAddress: "In town",
		IdempotencyKey:  "zone-in-" + uuid.New().String(),
		DeliveryLat:     f64(6.5), // inside the seeded square
		DeliveryLng:     f64(3.4),
	}
	if _, err := svc.PlaceOrder(ctx, restID, customer, inReq); errors.Is(err, restaurant.ErrOutsideDeliveryZone) {
		t.Fatalf("in-zone PlaceOrder must pass the zone gate, got ErrOutsideDeliveryZone")
	}
}

func f64(v float64) *float64 { return &v }
