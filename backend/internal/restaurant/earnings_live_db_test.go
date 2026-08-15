package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for payouts completeness (Phase 17): the KYB-verified
// payout gate (PY-007), refunded settlements excluded (PY-005), and the earnings
// statement (PY-008). Skipped unless TEST_DATABASE_URL is set.
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

func earningsPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB earnings test")
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

// seedSettledOrder inserts a settled settlement (provider_kobo/fee_kobo) + its order.
func seedSettledOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restID, customer string, provider, fee int64, status string) string {
	t.Helper()
	oid := uuid.New().String()
	settID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, provider_kobo, fee_kobo, idempotency_key, status, settled_at)
		VALUES ($1,$2,'food_delivery',$3,100000,$4,$5,$6,$7,now())`,
		settID, "order:"+oid, customer, provider, fee, "earn-"+settID, status); err != nil {
		t.Fatalf("seed settlement: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, idempotency_key, delivery_address, settlement_id)
		VALUES ($1,$2,$3,100000,100000,'delivered',$4,'1 St',$5)`,
		oid, customer, restID, "earnorder-"+oid, settID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	return oid
}

func TestLiveDB_PayoutsComplete(t *testing.T) {
	pool := earningsPool(t)
	defer pool.Close()
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led)

	owner := uuid.New().String()
	customer := uuid.New().String()
	for _, u := range []string{owner, customer} {
		_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test")
	}
	// A KYB-approved restaurant is payable; an unverified one is not (PY-007).
	verified := uuid.New().String()
	unverified := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, kyb_status) VALUES ($1,$2,'Verified','1 St',TRUE,'approved'),($3,$2,'Unverified','2 St',TRUE,NULL)`,
		verified, owner, unverified); err != nil {
		t.Fatalf("seed restaurants: %v", err)
	}

	// Verified: two settled orders (₦600 + ₦900 provider share) + one REFUNDED (excluded).
	seedSettledOrder(t, ctx, pool, verified, customer, 60000, 10000, "settled")
	seedSettledOrder(t, ctx, pool, verified, customer, 90000, 10000, "settled")
	seedSettledOrder(t, ctx, pool, verified, customer, 50000, 10000, "refunded") // PY-005: must NOT count
	// Unverified: a settled order that must be EXCLUDED from payout (PY-007).
	seedSettledOrder(t, ctx, pool, unverified, customer, 70000, 10000, "settled")

	// PY-007 + PY-005: the payout run for the owner includes only the two settled orders
	// from the VERIFIED restaurant (₦1,500), not the refunded one nor the unverified one.
	run, err := svc.BuildRun(ctx, "2026-07", "restaurant", owner)
	if err != nil {
		t.Fatalf("build run: %v", err)
	}
	// Net (disbursed provider share) = ₦1,500 from the two verified settled orders;
	// the refunded (PY-005) and the unverified restaurant (PY-007) are excluded.
	if run.NetMinor != 150000 {
		t.Fatalf("payout net = %d, want 150000 (two verified settled orders; refunded + unverified excluded)", run.NetMinor)
	}

	// PY-008: the earnings statement for the verified restaurant lists the two settled
	// orders with correct totals; the refunded one is excluded.
	from := time.Now().AddDate(0, 0, -1)
	to := time.Now()
	stmt, err := svc.EarningsStatement(ctx, verified, owner, from, to)
	if err != nil {
		t.Fatalf("earnings statement: %v", err)
	}
	if stmt.OrderCount != 2 {
		t.Fatalf("statement order count = %d, want 2 (refunded excluded)", stmt.OrderCount)
	}
	if stmt.TotalProviderKobo != 150000 {
		t.Errorf("statement provider total = %d, want 150000", stmt.TotalProviderKobo)
	}
	// A non-owner cannot pull the statement.
	if _, err := svc.EarningsStatement(ctx, verified, customer, from, to); err == nil {
		t.Error("a non-owner must not read the earnings statement")
	}
}
