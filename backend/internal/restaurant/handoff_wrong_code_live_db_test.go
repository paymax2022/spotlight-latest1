package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test closing the "R6–R7" gap left open in this
// session's mobile UAT pilot (docs/qa/test-release-runbook.md): rider
// handoff was navigated in the mobile UI but never verified against a wrong
// delivery code, since that needs a second rider-role session and an order
// actually in flight — real setup cost the UI pass didn't spend. Verifying
// it directly against the service, the same way tip_live_db_test.go already
// drives ConfirmHandoff for its own settlement assertions, is more reliable
// than a browser walkthrough for this specific question anyway.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"

	"spotlight/backend/internal/testsupport"
)

func handoffPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB handoff test")
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

func TestLiveDB_ConfirmHandoff_WrongCodeRejectedThenRightCodeSucceeds(t *testing.T) {
	pool := handoffPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led).WithTiers(tiers.NewService(pool))

	owner := uuid.New().String()
	customer := uuid.New().String()
	rider := uuid.New().String()
	otherRider := uuid.New().String()
	for _, u := range []string{owner, customer, rider, otherRider} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	seedKYCTier(t, ctx, pool, customer, 3)

	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, packaging_fee_kobo) VALUES ($1,$2,'Handoff Kitchen','1 St',TRUE,0)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	cat, err := svc.CreateCategory(ctx, restID, owner, "Mains")
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	item, err := svc.CreateItem(ctx, restID, owner, CreateItemRequest{CategoryID: cat.ID, Name: "Jollof", PriceKobo: 450_000})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}

	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	if err := led.Credit(ctx, customer, "seed-fund", "handofffund-"+customer, revAcc.ID, 5_000_000); err != nil {
		t.Fatalf("fund customer: %v", err)
	}

	order, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "handoff-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}

	const realCode = "7788"
	if _, err := pool.Exec(ctx,
		`UPDATE orders SET rider_id=$2, status='picked_up', dispatch_status='assigned', delivery_code=$3 WHERE id=$1`,
		order.ID, rider, realCode); err != nil {
		t.Fatalf("assign rider: %v", err)
	}

	// --- Wrong code: rejected, order stays exactly where it was. ---
	if err := svc.ConfirmHandoff(ctx, order.ID, rider, "0000"); err == nil {
		t.Fatal("ConfirmHandoff with a wrong code returned nil error, want rejection")
	}
	var status, dispatchStatus string
	var deliveredAt *string
	if err := pool.QueryRow(ctx,
		`SELECT status, dispatch_status, delivered_at::text FROM orders WHERE id=$1`, order.ID,
	).Scan(&status, &dispatchStatus, &deliveredAt); err != nil {
		t.Fatalf("read order after wrong code: %v", err)
	}
	if status != "picked_up" || dispatchStatus != "assigned" || deliveredAt != nil {
		t.Fatalf("order advanced on a WRONG code: status=%s dispatch_status=%s delivered_at=%v (want picked_up/assigned/nil)",
			status, dispatchStatus, deliveredAt)
	}
	// Escrow must still be fully held — no settlement legs posted yet.
	legRef := "settle:order:" + order.ID
	if got := creditLegKobo(t, ctx, pool, legRef+":rider"); got != 0 {
		t.Fatalf("rider settlement leg posted after a WRONG code: %d kobo (want 0, escrow must stay held)", got)
	}

	// --- Someone who isn't the assigned rider: also rejected, regardless of code. ---
	if err := svc.ConfirmHandoff(ctx, order.ID, otherRider, realCode); err == nil {
		t.Fatal("ConfirmHandoff from a non-assigned rider returned nil error, want rejection")
	}

	// --- Right code: succeeds, order actually completes. ---
	if err := svc.ConfirmHandoff(ctx, order.ID, rider, realCode); err != nil {
		t.Fatalf("ConfirmHandoff with the correct code failed: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT status, dispatch_status, delivered_at::text FROM orders WHERE id=$1`, order.ID,
	).Scan(&status, &dispatchStatus, &deliveredAt); err != nil {
		t.Fatalf("read order after right code: %v", err)
	}
	if dispatchStatus != "delivered" || deliveredAt == nil {
		t.Fatalf("order did not complete on the CORRECT code: dispatch_status=%s delivered_at=%v", dispatchStatus, deliveredAt)
	}
}
