package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for availability (Phase 11): holiday overrides + the
// accept-SLA sweeper (auto-cancel + refund of never-accepted orders). Skipped unless
// TEST_DATABASE_URL is set. Requires the availability migration.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
)

func availLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB availability test")
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

func availService(pool *pgxpool.Pool) *Service {
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	return NewService(pool, settlement.NewService(pool, led))
}

func TestLiveDB_AvailabilityHolidayAndSweep(t *testing.T) {
	pool := availLivePool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := availService(pool)

	owner := uuid.New().String()
	stranger := uuid.New().String()
	customer := uuid.New().String()
	for _, u := range []string{owner, stranger, customer} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, accept_sla_minutes) VALUES ($1,$2,'Avail Kitchen','1 St',TRUE,5)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// --- Holiday overrides ---
	today := time.Now().In(lagosTZ).Format("2006-01-02")
	if err := svc.SetHoliday(ctx, restID, stranger, HolidayHour{Date: today, IsClosed: true}); err == nil {
		t.Fatal("stranger must not set a holiday")
	}
	if err := svc.SetHoliday(ctx, restID, owner, HolidayHour{Date: today, IsClosed: true}); err != nil {
		t.Fatalf("owner set holiday: %v", err)
	}
	hol, err := svc.loadHolidayForDate(ctx, restID, time.Now(), lagosTZ)
	if err != nil || hol == nil || !hol.IsClosed {
		t.Fatalf("today's closed holiday should load: hol=%+v err=%v", hol, err)
	}
	// An open holiday needs a valid window.
	if err := svc.SetHoliday(ctx, restID, owner, HolidayHour{Date: today, IsClosed: false, OpenMinute: 800, CloseMinute: 700}); err == nil {
		t.Fatal("an open holiday with close<=open must be rejected")
	}
	if err := svc.DeleteHoliday(ctx, restID, owner, today); err != nil {
		t.Fatalf("delete holiday: %v", err)
	}
	if hol, _ := svc.loadHolidayForDate(ctx, restID, time.Now(), lagosTZ); hol != nil {
		t.Fatal("holiday should be gone after delete")
	}

	// --- Accept-SLA sweeper ---
	// An escrowed settlement + a pending order created 30 min ago (past the 5-min SLA).
	oldSett := seedEscrow(t, ctx, pool, customer)
	oldOrder := seedPendingOrderAt(t, ctx, pool, restID, customer, oldSett, time.Now().Add(-30*time.Minute))
	// A fresh pending order (within SLA) must NOT be swept.
	freshSett := seedEscrow(t, ctx, pool, customer)
	freshOrder := seedPendingOrderAt(t, ctx, pool, restID, customer, freshSett, time.Now())

	swept, err := svc.SweepUnacceptedOrders(ctx, time.Now())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if swept < 1 {
		t.Fatalf("expected at least the stale order swept, got %d", swept)
	}
	if st := orderStatus(t, ctx, pool, oldOrder); st != "cancelled" {
		t.Errorf("stale order status = %s, want cancelled", st)
	}
	if st := settlementStatus(t, ctx, pool, oldSett); st != "refunded" {
		t.Errorf("stale order settlement = %s, want refunded", st)
	}
	if st := orderStatus(t, ctx, pool, freshOrder); st != "pending" {
		t.Errorf("fresh order status = %s, want still pending", st)
	}
}

func seedEscrow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, payer string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, idempotency_key, status)
		 VALUES ($1,$2,'food_delivery',$3,100000,$4,'escrowed')`,
		id, "order:"+id, payer, "sweep-"+id); err != nil {
		t.Fatalf("seed escrow: %v", err)
	}
	return id
}

func seedPendingOrderAt(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restID, customer, settID string, createdAt time.Time) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status,
		                    idempotency_key, delivery_address, settlement_id, created_at)
		VALUES ($1,$2,$3,100000,100000,'pending',$4,'1 St',$5,$6)`,
		id, customer, restID, "sweeporder-"+id, settID, createdAt); err != nil {
		t.Fatalf("seed pending order: %v", err)
	}
	return id
}

func orderStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, id).Scan(&st); err != nil {
		t.Fatalf("read order status: %v", err)
	}
	return st
}

func settlementStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, id).Scan(&st); err != nil {
		t.Fatalf("read settlement status: %v", err)
	}
	return st
}
