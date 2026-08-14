package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for scheduled + group orders (Phase 18): the scheduled-slot
// activation (release-if-open / cancel+refund-if-closed, SG-002/005) and the group
// order create→add→cap→finalize flow (SG-003/004). Skipped unless the DB env is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
)

func schedPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB scheduled/group test")
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

func TestLiveDB_ScheduledAndGroup(t *testing.T) {
	pool := schedPool(t)
	defer pool.Close()
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led).WithTiers(tiers.NewService(pool))

	owner := uuid.New().String()
	host := uuid.New().String()
	friend := uuid.New().String()
	for _, u := range []string{owner, host, friend} {
		_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test")
	}
	// The host pays for the finalized group order, and that escrow is tier-gated
	// (fail-closed). Tier 3 is unlimited — this test is about the group flow, not caps.
	seedKYCTier(t, ctx, pool, host, 3)
	// Open restaurant (no weekly hours → governed by is_open) with a menu item.
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Group Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	cat, _ := svc.CreateCategory(ctx, restID, owner, "Mains")
	item, err := svc.CreateItem(ctx, restID, owner, CreateItemRequest{CategoryID: cat.ID, Name: "Jollof", PriceKobo: 100000})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}

	// --- Scheduled activation (SG-002/005): a closed restaurant's due slot is cancelled
	// + refunded; an open restaurant's due slot is released. Seed the orders + escrow directly. ---
	closedRest := uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Closed Kitchen','9 St',FALSE)`, closedRest, owner)
	settID := uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, idempotency_key, status) VALUES ($1,$2,'food_delivery',$3,100000,$4,'escrowed')`, settID, "order:"+settID, host, "sched-"+settID)
	dueClosed := uuid.New().String()
	past := time.Now().Add(-time.Minute)
	_, _ = pool.Exec(ctx, `INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, idempotency_key, delivery_address, settlement_id, scheduled_for) VALUES ($1,$2,$3,100000,100000,'pending',$4,'1 St',$5,$6)`,
		dueClosed, host, closedRest, "schedorder-"+dueClosed, settID, past)
	dueOpen := uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, idempotency_key, delivery_address, scheduled_for) VALUES ($1,$2,$3,100000,100000,'pending',$4,'1 St',$5)`,
		dueOpen, host, restID, "schedorder-"+dueOpen, past)

	released, cancelled, err := svc.ActivateScheduledOrders(ctx, time.Now())
	if err != nil {
		t.Fatalf("activate scheduled: %v", err)
	}
	if released < 1 || cancelled < 1 {
		t.Fatalf("expected >=1 released and >=1 cancelled, got released=%d cancelled=%d", released, cancelled)
	}
	if st := orderStatusFSM(t, ctx, pool, dueClosed); st != "cancelled" {
		t.Errorf("closed-slot order = %s, want cancelled (SG-002)", st)
	}
	if st := settlementStatusFSM(t, ctx, pool, settID); st != "refunded" {
		t.Errorf("closed-slot settlement = %s, want refunded", st)
	}
	var stillScheduled *time.Time
	_ = pool.QueryRow(ctx, `SELECT scheduled_for FROM orders WHERE id=$1`, dueOpen).Scan(&stillScheduled)
	if stillScheduled != nil {
		t.Error("released order should have scheduled_for cleared")
	}

	// --- Group orders (SG-003/004). ---
	g, err := svc.CreateGroupOrder(ctx, host, restID, 150000) // ₦1,500 per-person cap
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	if _, err := svc.AddGroupItem(ctx, g.ID, host, item.ID, 1); err != nil {
		t.Fatalf("host add item: %v", err)
	}
	if _, err := svc.AddGroupItem(ctx, g.ID, friend, item.ID, 1); err != nil {
		t.Fatalf("friend add item: %v", err)
	}
	// SG-004: the friend's 2nd unit would total ₦2,000 > ₦1,500 cap → rejected.
	if _, err := svc.AddGroupItem(ctx, g.ID, friend, item.ID, 1); err == nil {
		t.Error("adding past the per-contributor cap must be rejected")
	}
	// A non-host cannot finalize.
	if _, err := svc.FinalizeGroupOrder(ctx, g.ID, friend, PlaceOrderRequest{DeliveryAddress: "1 St", IdempotencyKey: "gf-" + uuid.New().String()}); !errors.Is(err, ErrForbidden) {
		t.Errorf("non-host finalize: want ErrForbidden, got %v", err)
	}

	// Fund the host wallet so the finalize escrow (₦2,000 items + delivery) succeeds.
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, host, "seed-fund", "seedfund-"+host, revAcc.ID, 500000); err != nil {
		t.Fatalf("fund host: %v", err)
	}
	order, err := svc.FinalizeGroupOrder(ctx, g.ID, host, PlaceOrderRequest{DeliveryAddress: "1 St", IdempotencyKey: "gf-" + uuid.New().String()})
	if err != nil {
		t.Fatalf("finalize group: %v", err)
	}
	if order.SubtotalKobo != 200000 { // 2 × ₦1,000
		t.Errorf("finalized order subtotal = %d, want 200000 (both contributors' items)", order.SubtotalKobo)
	}
	// The group is marked placed and linked to the order.
	var status string
	var linked *string
	_ = pool.QueryRow(ctx, `SELECT status, order_id FROM group_orders WHERE id=$1`, g.ID).Scan(&status, &linked)
	if status != "placed" || linked == nil || *linked != order.ID {
		t.Errorf("group after finalize: status=%s order_id=%v, want placed + linked", status, linked)
	}
	// Adding to a placed group is rejected.
	if _, err := svc.AddGroupItem(ctx, g.ID, host, item.ID, 1); err == nil {
		t.Error("adding to a placed group must be rejected")
	}
}
