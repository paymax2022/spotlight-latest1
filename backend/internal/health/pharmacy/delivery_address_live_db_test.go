package healthpharmacy

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

// Live-DB coverage for the delivery_address/delivery_lat/delivery_lng columns
// (migration 20270200000000_pharmacy_order_delivery_address.sql). Before this,
// pharmacy_orders had no per-order dropoff, so patientDropoff() (backend/
// internal/app/health_pharmacy_routes.go) always returned ok=false and every
// DELIVERY order failed at Dispatch. See bring-up note in
// delivery_proof_live_db_test.go for TEST_DATABASE_URL.
func deliveryAddressLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB pharmacy delivery-address test")
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

// A DELIVERY order with no dropoff coordinates must be rejected before any
// money moves (escrow.Hold is never reached — this fires earlier in
// CreateOrder). All collaborators are nil-safe here since the check runs
// before any of them would be touched.
func TestCreateOrder_DeliveryRequiresAddress(t *testing.T) {
	pool := deliveryAddressLivePool(t)
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)

	_, err := svc.CreateOrder(context.Background(), uuid.New().String(), CreateOrderInput{
		PharmacyProviderID: uuid.New().String(),
		FulfilmentMethod:   FulfilDelivery,
		IdempotencyKey:     "test:" + uuid.New().String(),
		Lines:              []OrderLineInput{{ProductID: uuid.New().String(), Quantity: 1}},
		// DeliveryAddress/Lat/Lng deliberately omitted.
	})
	if err == nil {
		t.Fatal("expected CreateOrder to reject a DELIVERY order with no dropoff address/coordinates")
	}
}

// Round-trips delivery_address/delivery_lat/delivery_lng through the same
// load() query Get() (GET /orders/:id) and patientDropoff() both rely on —
// proves the migration's columns are wired correctly end-to-end, and that a
// PICKUP order (which never sets them) is read back as nil, not zeroed.
func TestPharmacyOrder_DeliveryFieldsRoundTrip(t *testing.T) {
	ctx := context.Background()
	pool := deliveryAddressLivePool(t)
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)

	patientID := uuid.New().String()
	pharmacyID := uuid.New().String()
	deliveryOrderID := uuid.New().String()
	pickupOrderID := uuid.New().String()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}

	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		patientID, patientID+"@seed.test")
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		pharmacyID, pharmacyID+"@seed.test")
	testsupport.CleanupUsers(t, pool, patientID, pharmacyID)

	seed(`INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status)
	      VALUES ($1,$2,'PHARMACY','pharmacy','Seed Pharmacy','APPROVED') ON CONFLICT DO NOTHING`,
		pharmacyID, pharmacyID)

	seed(`INSERT INTO public.pharmacy_orders
	        (id, patient_id, pharmacy_provider_id, state, fulfilment_method, total_kobo, idempotency_key, created_at,
	         delivery_address, delivery_lat, delivery_lng)
	      VALUES ($1,$2,$3,'CREATED','DELIVERY',50000,$4,now(), $5,$6,$7)`,
		deliveryOrderID, patientID, pharmacyID, deliveryOrderID+"_idem",
		"12B Ozumba Mbadiwe Ave, Victoria Island, Lagos", 6.4281, 3.4219)

	seed(`INSERT INTO public.pharmacy_orders (id, patient_id, pharmacy_provider_id, state, fulfilment_method, total_kobo, idempotency_key, created_at)
	      VALUES ($1,$2,$3,'CREATED','PICKUP',50000,$4,now())`,
		pickupOrderID, patientID, pharmacyID, pickupOrderID+"_idem")

	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM public.pharmacy_orders WHERE id IN ($1,$2)`, deliveryOrderID, pickupOrderID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_providers WHERE id=$1`, pharmacyID)
	})

	got, err := svc.Get(ctx, patientID, deliveryOrderID, false)
	if err != nil {
		t.Fatalf("Get delivery order: %v", err)
	}
	if got.DeliveryAddress == nil || *got.DeliveryAddress != "12B Ozumba Mbadiwe Ave, Victoria Island, Lagos" {
		t.Errorf("expected delivery_address to round-trip, got %v", got.DeliveryAddress)
	}
	if got.DeliveryLat == nil || *got.DeliveryLat != 6.4281 {
		t.Errorf("expected delivery_lat 6.4281, got %v", got.DeliveryLat)
	}
	if got.DeliveryLng == nil || *got.DeliveryLng != 3.4219 {
		t.Errorf("expected delivery_lng 3.4219, got %v", got.DeliveryLng)
	}

	gotPickup, err := svc.Get(ctx, patientID, pickupOrderID, false)
	if err != nil {
		t.Fatalf("Get pickup order: %v", err)
	}
	if gotPickup.DeliveryLat != nil || gotPickup.DeliveryLng != nil || gotPickup.DeliveryAddress != nil {
		t.Errorf("expected a PICKUP order to have nil delivery fields, got address=%v lat=%v lng=%v",
			gotPickup.DeliveryAddress, gotPickup.DeliveryLat, gotPickup.DeliveryLng)
	}
}
