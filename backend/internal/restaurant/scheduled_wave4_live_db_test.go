package restaurant

// LIVE-DB regression tests for FOOD-UAT-D-002 / E-003 / E-004: the unaccepted-order,
// stalled-dispatch and offline-assigned sweeps run from the scheduler tick, and
// re-dispatch never re-offers to a rider who already declined/expired for the order.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_SweeperTickRunsUnacceptedAndStalledDispatch(t *testing.T) {
	pool := availLivePool(t)
	t.Cleanup(pool.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	svc := availService(pool)

	owner, customer := uuid.New().String(), uuid.New().String()
	for _, u := range []string{owner, customer} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, accept_sla_minutes) VALUES ($1,$2,'Wave4 Kitchen','1 St',TRUE,5)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// (a) a pending order 30 min old, past the 5-min accept SLA.
	sett := seedEscrow(t, ctx, pool, customer)
	stale := seedPendingOrderAt(t, ctx, pool, restID, customer, sett, time.Now().Add(-30*time.Minute))
	// (b) a ready/searching order that has been searching past dispatchStaleMinutes.
	old := time.Now().Add(-(dispatchStaleMinutes + 5) * time.Minute)
	stalled, stalledSett := seedOrderWithEscrow(t, ctx, pool, restID, customer, nil, "ready", "searching", &old)

	// Nothing here calls the Sweep* methods directly: only the scheduler does.
	StartUnacceptedOrderSweeper(ctx, svc, time.Hour)

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if orderStatus(t, ctx, pool, stale) == "cancelled" && orderStatus(t, ctx, pool, stalled) == "dispatch_failed" {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if st := orderStatus(t, ctx, pool, stale); st != "cancelled" {
		t.Errorf("unaccepted order status = %s, want cancelled by the scheduler tick", st)
	}
	if st := settlementStatus(t, ctx, pool, sett); st != "refunded" {
		t.Errorf("unaccepted order settlement = %s, want refunded", st)
	}
	if st := orderStatus(t, ctx, pool, stalled); st != "dispatch_failed" {
		t.Errorf("stalled order status = %s, want dispatch_failed by the scheduler tick", st)
	}
	if st := settlementStatusFSM(t, ctx, pool, stalledSett); st != "refunded" {
		t.Errorf("stalled order settlement = %s, want refunded", st)
	}
}

func TestLiveDB_RedispatchExcludesPriorDecliners(t *testing.T) {
	pool := reassignPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	if _, err := pool.Exec(ctx, `UPDATE drivers SET status='offline' WHERE status='online'`); err != nil {
		t.Fatalf("isolate drivers: %v", err)
	}
	owner, customer := uuid.New().String(), uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2),($3,$4) ON CONFLICT DO NOTHING`, owner, owner+"@t", customer, customer+"@t")
	testsupport.CleanupUser(t, pool, owner)
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, geo_lat, geo_lng) VALUES ($1,$2,'Wave4 Redispatch','1 St',TRUE,6.5,3.4)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	// baseDispatchFanOut nearer riders have already declined/expired: without the
	// exclusion they fill every fan-out slot and the farther fresh rider is starved.
	prior := map[string]string{}
	for i := 0; i < baseDispatchFanOut; i++ {
		st := "declined"
		if i%2 == 1 {
			st = "expired"
		}
		prior[seedDriverAt(t, ctx, pool, 6.5, 3.4, "online")] = st
	}
	fresh := seedDriverAt(t, ctx, pool, 6.9, 3.9, "online")

	oid := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, dispatch_status, idempotency_key, delivery_address, ready_at)
		VALUES ($1,$2,$3,1000,1000,'ready','searching',$4,'1 St',now())`,
		oid, customer, restID, "wave4-"+oid); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	for rider, st := range prior {
		if _, err := pool.Exec(ctx, `INSERT INTO restaurant_delivery_offers (id, order_id, rider_id, status) VALUES ($1,$2,$3,$4)`,
			uuid.New().String(), oid, rider, st); err != nil {
			t.Fatalf("seed offer: %v", err)
		}
	}
	if err := svc.DispatchOrder(ctx, oid); err != nil {
		t.Fatalf("re-dispatch: %v", err)
	}
	if !hasOpenOffer(t, ctx, pool, oid, fresh) {
		t.Error("the fresh rider should receive the re-dispatch offer")
	}
	for rider, st := range prior {
		if hasOpenOffer(t, ctx, pool, oid, rider) {
			t.Errorf("prior %s rider %s was re-offered the order", st, rider)
		}
	}
}
