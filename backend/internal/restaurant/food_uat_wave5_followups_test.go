package restaurant

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

// FOOD-UAT-E-008 wiring: ConfirmPickup / ConfirmHandoff must enforce the lockout —
// brute-forcing the rider-side code through the real entry points gets locked out,
// and even the correct code is refused while locked.
func TestLiveDB_ConfirmCodesLockoutAtCallSites(t *testing.T) {
	pool := reassignPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner, customer, rider := uuid.New().String(), uuid.New().String(), uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2),($3,$4),($5,$6) ON CONFLICT DO NOTHING`,
		owner, owner+"@t", customer, customer+"@t", rider, rider+"@t")
	for _, u := range []string{owner, customer, rider} {
		testsupport.CleanupUser(t, pool, u)
	}
	restID, oid := uuid.New().String(), uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, geo_lat, geo_lng) VALUES ($1,$2,'Lock2','1 St',TRUE,6.5,3.4)`, restID, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, dispatch_status, idempotency_key, delivery_address, rider_id, pickup_code, delivery_code)
		VALUES ($1,$2,$3,1000,1000,'ready','assigned',$4,'1 St',$5,'1234','5678')`, oid, customer, restID, "lk2-"+oid, rider); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		_ = svc.ConfirmPickup(ctx, oid, rider, "0000")
	}
	if err := svc.ConfirmPickup(ctx, oid, rider, "1234"); !errors.Is(err, ErrCodeLocked) {
		t.Fatalf("pickup: correct code after 5 wrong must be locked, got %v", err)
	}
	for i := 0; i < 5; i++ {
		_ = svc.ConfirmHandoff(ctx, oid, rider, "0000")
	}
	if err := svc.ConfirmHandoff(ctx, oid, rider, "5678"); !errors.Is(err, ErrCodeLocked) {
		t.Fatalf("handoff: correct code after 5 wrong must be locked, got %v", err)
	}
	if err := svc.UnlockOrderCodes(ctx, oid); err != nil {
		t.Fatal(err)
	}
}
