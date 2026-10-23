package restaurant

import (
	"context"
	"errors"
	"math"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

// FOOD-UAT-C-013: bad / missing delivery coords are a 400, never a flat-fee order.
func TestValidateDeliveryCoords(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	cases := []struct {
		name string
		req  PlaceOrderRequest
		ok   bool
	}{
		{"valid flat", PlaceOrderRequest{DeliveryLat: f(6.5), DeliveryLng: f(3.4)}, true},
		{"valid nested", PlaceOrderRequest{DeliveryLocation: &LatLng{Lat: 6.5, Lng: 3.4}}, true},
		{"lat 999", PlaceOrderRequest{DeliveryLat: f(999), DeliveryLng: f(0)}, false},
		{"lng 181", PlaceOrderRequest{DeliveryLat: f(0), DeliveryLng: f(181)}, false},
		{"nested out of range", PlaceOrderRequest{DeliveryLocation: &LatLng{Lat: -91, Lng: 0}}, false},
		{"NaN", PlaceOrderRequest{DeliveryLat: f(math.NaN()), DeliveryLng: f(0)}, false},
		{"missing", PlaceOrderRequest{}, false},
		{"one-sided", PlaceOrderRequest{DeliveryLat: f(6.5)}, false},
	}
	for _, c := range cases {
		err := ValidateDeliveryCoords(c.req)
		if (err == nil) != c.ok {
			t.Errorf("%s: err=%v want ok=%v", c.name, err, c.ok)
		}
		if err != nil && (!errors.Is(err, ErrInvalidInput)) {
			t.Errorf("%s: want ErrInvalidInput, got %v", c.name, err)
		}
	}
}

func TestStatusPermission_StaffScope(t *testing.T) {
	if p, ok := statusPermission(OrderPreparing); !ok || !Can(RoleKitchen, StaffActive, p) {
		t.Error("kitchen must run preparing")
	}
	if p, _ := statusPermission(OrderConfirmed); Can(RoleKitchen, StaffActive, p) {
		t.Error("kitchen must not accept")
	}
	if p, _ := statusPermission(OrderConfirmed); !Can(RoleCashier, StaffActive, p) {
		t.Error("cashier must accept")
	}
	for _, s := range []OrderStatus{OrderCancelled, OrderPickedUp, OrderDelivered} {
		if _, ok := statusPermission(s); ok {
			t.Errorf("%s must be owner-only", s)
		}
	}
}

// FOOD-UAT-E-008 + D-006 live-DB proofs. Skipped without TEST_DATABASE_URL.
func TestLiveDB_OrderCodeLockout(t *testing.T) {
	pool := reassignPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner, customer := uuid.New().String(), uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2),($3,$4) ON CONFLICT DO NOTHING`,
		owner, owner+"@t", customer, customer+"@t")
	testsupport.CleanupUser(t, pool, owner)
	testsupport.CleanupUser(t, pool, customer)
	restID, oid := uuid.New().String(), uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, geo_lat, geo_lng) VALUES ($1,$2,'Lock Kitchen','1 St',TRUE,6.5,3.4)`, restID, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, dispatch_status, idempotency_key, delivery_address)
		VALUES ($1,$2,$3,1000,1000,'ready','none',$4,'1 St')`, oid, customer, restID, "lock-"+oid); err != nil {
		t.Fatal(err)
	}

	// Four wrong tries, then a correct one: allowed and resets the counter.
	for i := 0; i < 4; i++ {
		if err := svc.VerifyOrderCode(ctx, oid, CodeKindPickup, "0000", "1234"); err == nil || errors.Is(err, ErrCodeLocked) {
			t.Fatalf("attempt %d: want plain incorrect-code error, got %v", i+1, err)
		}
	}
	if err := svc.VerifyOrderCode(ctx, oid, CodeKindPickup, "1234", "1234"); err != nil {
		t.Fatalf("correct code before threshold must pass: %v", err)
	}
	// Reset proof: four more wrong tries still do not lock.
	for i := 0; i < 4; i++ {
		_ = svc.VerifyOrderCode(ctx, oid, CodeKindPickup, "0000", "1234")
	}
	if err := svc.VerifyOrderCode(ctx, oid, CodeKindPickup, "1234", "1234"); err != nil {
		t.Fatalf("counter was not reset by the success: %v", err)
	}

	// Five wrong → locked; the 6th call (even with the CORRECT code) is refused.
	for i := 0; i < 5; i++ {
		_ = svc.VerifyOrderCode(ctx, oid, CodeKindPickup, "0000", "1234")
	}
	if err := svc.VerifyOrderCode(ctx, oid, CodeKindPickup, "1234", "1234"); !errors.Is(err, ErrCodeLocked) {
		t.Fatalf("6th call must be locked, got %v", err)
	}
	if statusCodeFor(ErrCodeLocked) != 429 {
		t.Error("lockout must map to 429")
	}
	// Delivery code is tracked independently.
	if err := svc.VerifyOrderCode(ctx, oid, CodeKindDelivery, "9999", "9999"); err != nil {
		t.Fatalf("delivery code must be unaffected by pickup lock: %v", err)
	}
	// Admin unlock → accepted again.
	if err := svc.UnlockOrderCodes(ctx, oid); err != nil {
		t.Fatal(err)
	}
	if err := svc.VerifyOrderCode(ctx, oid, CodeKindPickup, "1234", "1234"); err != nil {
		t.Fatalf("after unlock: %v", err)
	}
	// Expiry: an elapsed lock no longer blocks.
	_, _ = pool.Exec(ctx, `UPDATE orders SET pickup_locked_until = now() - interval '1 minute' WHERE id=$1`, oid)
	if err := svc.VerifyOrderCode(ctx, oid, CodeKindPickup, "1234", "1234"); err != nil {
		t.Fatalf("expired lock must not block: %v", err)
	}
}

func TestLiveDB_StaffOrderStatusPermissions(t *testing.T) {
	pool := reassignPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner, customer, kitchen, cashier := uuid.New().String(), uuid.New().String(), uuid.New().String(), uuid.New().String()
	for _, u := range []string{owner, customer, kitchen, cashier} {
		_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@t")
		testsupport.CleanupUser(t, pool, u)
	}
	restID, oid := uuid.New().String(), uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, geo_lat, geo_lng) VALUES ($1,$2,'Staff Kitchen','1 St',TRUE,6.5,3.4)`, restID, owner); err != nil {
		t.Fatal(err)
	}
	for u, r := range map[string]string{kitchen: "KITCHEN", cashier: "CASHIER"} {
		if _, err := pool.Exec(ctx, `INSERT INTO restaurant_staff (restaurant_id,user_id,role,status) VALUES ($1,$2,$3,'ACTIVE')`, restID, u, r); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, dispatch_status, idempotency_key, delivery_address)
		VALUES ($1,$2,$3,1000,1000,'pending','none',$4,'1 St')`, oid, customer, restID, "staff-"+oid); err != nil {
		t.Fatal(err)
	}

	// Kitchen cannot accept; cashier can.
	if h, err := svc.updateStatusAsStaff(ctx, oid, kitchen, OrderConfirmed); !h || !errors.Is(err, ErrForbidden) {
		t.Fatalf("kitchen accept: handled=%v err=%v, want forbidden", h, err)
	}
	if h, err := svc.updateStatusAsStaff(ctx, oid, cashier, OrderConfirmed); !h || err != nil {
		t.Fatalf("cashier accept: handled=%v err=%v", h, err)
	}
	// Kitchen can run preparing; cannot cancel.
	if h, err := svc.updateStatusAsStaff(ctx, oid, kitchen, OrderPreparing); !h || err != nil {
		t.Fatalf("kitchen preparing: handled=%v err=%v", h, err)
	}
	if h, err := svc.updateStatusAsStaff(ctx, oid, kitchen, OrderCancelled); !h || !errors.Is(err, ErrForbidden) {
		t.Fatalf("kitchen cancel: handled=%v err=%v, want forbidden", h, err)
	}
	// Owner and customer fall through to the unchanged UpdateStatus path.
	if h, _ := svc.updateStatusAsStaff(ctx, oid, owner, OrderReady); h {
		t.Error("owner must fall through")
	}
	if h, _ := svc.updateStatusAsStaff(ctx, oid, customer, OrderCancelled); h {
		t.Error("customer must fall through")
	}
	var st string
	_ = pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, oid).Scan(&st)
	if st != "preparing" {
		t.Errorf("status = %s, want preparing", st)
	}
}
