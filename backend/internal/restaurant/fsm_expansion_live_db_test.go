package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for the expanded order lifecycle (Phase 14): restaurant
// reject→refund, dispatch-failed→refund, delivery-failed marker (no refund), and the
// authz on each. Skipped unless TEST_DATABASE_URL is set.
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
)

func fsmPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB FSM test")
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

func fsmService(pool *pgxpool.Pool) *Service {
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	return NewService(pool, settlement.NewService(pool, led))
}

// seedOrderWithEscrow inserts an escrowed settlement + an order in `status` for
// (restaurant, customer, rider?). Returns the order + settlement ids.
func seedOrderWithEscrow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restID, customer string, rider *string, status string, dispatchStatus string, readyAt *time.Time) (string, string) {
	t.Helper()
	settID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, idempotency_key, status)
		 VALUES ($1,$2,'food_delivery',$3,100000,$4,'escrowed')`,
		settID, "order:"+settID, customer, "fsm-"+settID); err != nil {
		t.Fatalf("seed escrow: %v", err)
	}
	oid := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, rider_id, subtotal_kobo, total_kobo, status,
		                    dispatch_status, idempotency_key, delivery_address, settlement_id, ready_at)
		VALUES ($1,$2,$3,$4,100000,100000,$5,$6,$7,'1 St',$8,$9)`,
		oid, customer, restID, rider, status, dispatchStatus, "fsmorder-"+oid, settID, readyAt); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	return oid, settID
}

func TestLiveDB_OrderFSMExpansion(t *testing.T) {
	pool := fsmPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := fsmService(pool)

	owner := uuid.New().String()
	customer := uuid.New().String()
	rider := uuid.New().String()
	stranger := uuid.New().String()
	for _, u := range []string{owner, customer, rider, stranger} {
		_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test")
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'FSM Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// --- Reject (RM-003): owner rejects a pending order → refund. ---
	oid, settID := seedOrderWithEscrow(t, ctx, pool, restID, customer, nil, "pending", "none", nil)
	if err := svc.RejectOrder(ctx, oid, stranger, "x"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stranger reject: want ErrForbidden, got %v", err)
	}
	if err := svc.RejectOrder(ctx, oid, owner, ""); err == nil {
		t.Fatal("reject without a reason must fail")
	}
	if err := svc.RejectOrder(ctx, oid, owner, "out of stock"); err != nil {
		t.Fatalf("owner reject: %v", err)
	}
	if st := orderStatusFSM(t, ctx, pool, oid); st != "rejected" {
		t.Errorf("status = %s, want rejected", st)
	}
	if st := settlementStatusFSM(t, ctx, pool, settID); st != "refunded" {
		t.Errorf("settlement = %s, want refunded", st)
	}

	// --- Dispatch failed (DP-003): a ready+searching order with no rider → refund. ---
	oid2, settID2 := seedOrderWithEscrow(t, ctx, pool, restID, customer, nil, "ready", "searching", nil)
	if err := svc.MarkDispatchFailed(ctx, oid2, "no_rider_available"); err != nil {
		t.Fatalf("mark dispatch failed: %v", err)
	}
	if st := orderStatusFSM(t, ctx, pool, oid2); st != "dispatch_failed" {
		t.Errorf("status = %s, want dispatch_failed", st)
	}
	if st := settlementStatusFSM(t, ctx, pool, settID2); st != "refunded" {
		t.Errorf("settlement = %s, want refunded", st)
	}

	// --- Stalled-dispatch sweeper: a ready+searching order that went stale is swept. ---
	stale := time.Now().Add(-(dispatchStaleMinutes + 5) * time.Minute)
	oid3, settID3 := seedOrderWithEscrow(t, ctx, pool, restID, customer, nil, "ready", "searching", &stale)
	swept, err := svc.SweepStalledDispatch(ctx, time.Now())
	if err != nil {
		t.Fatalf("sweep stalled: %v", err)
	}
	if swept < 1 {
		t.Fatalf("expected the stale order swept, got %d", swept)
	}
	if st := settlementStatusFSM(t, ctx, pool, settID3); st != "refunded" {
		t.Errorf("swept order %s settlement = %s, want refunded", oid3, st)
	}

	// --- Delivery failed (DL): assigned rider marks a picked-up order failed; NO refund. ---
	oid4, settID4 := seedOrderWithEscrow(t, ctx, pool, restID, customer, &rider, "picked_up", "assigned", nil)
	if err := svc.MarkDeliveryFailed(ctx, oid4, stranger, "x"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stranger delivery-failed: want ErrForbidden, got %v", err)
	}
	if err := svc.MarkDeliveryFailed(ctx, oid4, rider, "customer unreachable"); err != nil {
		t.Fatalf("rider delivery-failed: %v", err)
	}
	if st := orderStatusFSM(t, ctx, pool, oid4); st != "delivery_failed" {
		t.Errorf("status = %s, want delivery_failed", st)
	}
	// The escrow is NOT refunded (food is with the rider; resolved via dispute/cancel).
	if st := settlementStatusFSM(t, ctx, pool, settID4); st != "escrowed" {
		t.Errorf("delivery-failed settlement = %s, want still escrowed (no auto-refund)", st)
	}
}

func orderStatusFSM(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, id).Scan(&st); err != nil {
		t.Fatalf("read order status: %v", err)
	}
	return st
}

func settlementStatusFSM(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, id).Scan(&st); err != nil {
		t.Fatalf("read settlement status: %v", err)
	}
	return st
}
