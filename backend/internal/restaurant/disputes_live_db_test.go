package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for food-order disputes (Phase 9): party-only raise on a
// delivered order, the one-active-dispute guard, and admin resolution with a
// PLATFORM-FUNDED refund (debit paymax_revenue → credit customer wallet), including
// idempotency. Skipped unless TEST_DATABASE_URL/DATABASE_URL is set. Requires the
// restaurant, disputes, ledger, and restaurant-disputes migrations.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
)

func disputesLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB disputes test")
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

func walletBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var bal int64
	// Sum of the user's wallet ledger entries (credits positive, debits negative).
	_ = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN e.type IN ('CREDIT','REVERSAL_CREDIT') THEN e.amount_kobo ELSE -e.amount_kobo END),0)
		FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
		WHERE a.user_id=$1`, userID).Scan(&bal)
	return bal
}

func TestLiveDB_FoodDisputes(t *testing.T) {
	pool := disputesLivePool(t)
	defer pool.Close()
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, nil).WithLedger(led)

	owner := uuid.New().String()
	customer := uuid.New().String()
	stranger := uuid.New().String()
	admin := uuid.New().String()
	for _, u := range []string{owner, customer, stranger, admin} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Dispute Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	// A DELIVERED order (total ₦100.00 = 100000 kobo).
	orderID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, idempotency_key, delivery_address)
		VALUES ($1,$2,$3,100000,100000,'delivered',$4,'1 Test Street')`,
		orderID, customer, restID, "disp-"+orderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}

	const longDesc = "the order arrived with the wrong items and was missing the drinks"

	// A stranger cannot raise a dispute.
	if _, err := svc.RaiseFoodDispute(ctx, orderID, stranger, "wrong_item", longDesc); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stranger raise: want ErrForbidden, got %v", err)
	}
	// The customer raises it.
	d, err := svc.RaiseFoodDispute(ctx, orderID, customer, "wrong_item", longDesc)
	if err != nil {
		t.Fatalf("raise: %v", err)
	}
	// A second active dispute on the same order is blocked.
	if _, err := svc.RaiseFoodDispute(ctx, orderID, customer, "wrong_item", longDesc); !errors.Is(err, ErrDisputeInvalid) {
		t.Fatalf("double raise: want ErrDisputeInvalid, got %v", err)
	}

	before := walletBalance(t, ctx, pool, customer)

	// Admin resolves with a partial refund of ₦40.00 → customer credited 40000 kobo.
	if _, err := svc.AdminResolveFoodDispute(ctx, d.ID, admin, FoodRefundPartial, 40000, "wrong items, partial refund"); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	after := walletBalance(t, ctx, pool, customer)
	if after-before != 40000 {
		t.Fatalf("customer should be credited 40000 kobo, got delta %d", after-before)
	}

	// Idempotent: re-resolving must NOT double-refund (dispute already resolved).
	if _, err := svc.AdminResolveFoodDispute(ctx, d.ID, admin, FoodRefundPartial, 40000, "retry"); !errors.Is(err, ErrDisputeInvalid) {
		t.Fatalf("re-resolve should reject (already resolved), got %v", err)
	}
	if bal := walletBalance(t, ctx, pool, customer); bal != after {
		t.Fatalf("balance changed on rejected re-resolve: %d != %d", bal, after)
	}

	// The ticket is resolved and the order is flagged disputed.
	var st string
	var disputedAt *string
	if err := pool.QueryRow(ctx, `SELECT status FROM disputes WHERE id=$1`, d.ID).Scan(&st); err != nil {
		t.Fatalf("read ticket: %v", err)
	}
	if st != "resolved" {
		t.Errorf("ticket status = %s, want resolved", st)
	}
	if err := pool.QueryRow(ctx, `SELECT disputed_at::text FROM orders WHERE id=$1`, orderID).Scan(&disputedAt); err != nil {
		t.Fatalf("read order: %v", err)
	}
	if disputedAt == nil {
		t.Error("order should be flagged disputed_at after resolution")
	}
}
