package loyalty

// Live-DB tests for the end-to-end loyalty redeem path (loyalty tier gate →
// points.Redeem debit → loyalty_redemptions fulfilment row). SKIPPED whenever
// TEST_DATABASE_URL is unset.
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/loyalty/... -v
//
// Requires migration 20271009000000_loyalty_redemption_idem_key.sql applied
// (loyalty_redemptions.idempotency_key partial unique index).

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/points"
	"spotlight/backend/internal/testsupport"
)

func liveLoyaltyPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB loyalty test")
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

func seedLoyaltyUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	uid := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, uid, "loy-"+uid+"@test.local"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, uid)
	return uid
}

// seedReward inserts the same SKU into BOTH catalogs: loyalty_catalog gates on
// tier, then points.Redeem re-loads it from points_catalog to debit the ledger.
func seedReward(t *testing.T, pool *pgxpool.Pool, cost int64) string {
	t.Helper()
	sku := "TEST-" + uuid.NewString()[:13]
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO loyalty_catalog (sku, title, kind, cost_points, min_tier, active)
		 VALUES ($1,'test reward','airtime',$2,'TIER1',true)`, sku, cost); err != nil {
		t.Fatalf("seed loyalty catalog: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO points_catalog (sku, title, kind, cost_points, value_kobo, active)
		 VALUES ($1,'test reward','airtime',$2,0,true)`, sku, cost); err != nil {
		t.Fatalf("seed points catalog: %v", err)
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM loyalty_catalog WHERE sku=$1`, sku)
		_, _ = pool.Exec(c, `DELETE FROM points_catalog WHERE sku=$1`, sku)
	})
	return sku
}

func seedLoyaltyEarn(t *testing.T, pool *pgxpool.Pool, uid string, pts int64) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO points_ledger (user_id, type, points, rule_key, reference, idempotency_key)
		 VALUES ($1,'EARN',$2,'test.seed','ref','earn-test:'||$3)`, uid, pts, uuid.NewString()); err != nil {
		t.Fatalf("seed earn: %v", err)
	}
}

// End-to-end regression: redeem succeeds (the FOR UPDATE-on-aggregate bug made
// every redeem 400) and a same-key replay returns the original redemption with
// no duplicate debit or fulfilment row.
func TestLiveDB_LoyaltyRedeem_SucceedsAndReplaysIdempotently(t *testing.T) {
	pool := liveLoyaltyPool(t)
	pts := points.NewService(pool, nil)
	svc := NewService(pool, pts, nil)
	ctx := context.Background()
	uid := seedLoyaltyUser(t, pool)
	sku := seedReward(t, pool, 100)
	seedLoyaltyEarn(t, pool, uid, 500)

	key := "loyalty-" + uuid.NewString()
	first, err := svc.Redeem(ctx, uid, sku, key)
	if err != nil {
		t.Fatalf("first redeem: %v", err)
	}
	second, err := svc.Redeem(ctx, uid, sku, key)
	if err != nil {
		t.Fatalf("replay redeem: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("replay must return the same redemption: %s vs %s", first.ID, second.ID)
	}
	var debits, fulfilments int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM points_ledger WHERE user_id=$1 AND type='REDEEM'`, uid).Scan(&debits); err != nil {
		t.Fatalf("count debits: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM loyalty_redemptions WHERE user_id=$1 AND idempotency_key=$2`, uid, key).Scan(&fulfilments); err != nil {
		t.Fatalf("count fulfilments: %v", err)
	}
	if debits != 1 || fulfilments != 1 {
		t.Fatalf("expected exactly 1 debit + 1 fulfilment, got %d/%d", debits, fulfilments)
	}
	bal, _ := pts.Balance(ctx, uid)
	if bal != 400 {
		t.Fatalf("balance after replay: got %d, want 400", bal)
	}
}

// Headerless calls are rejected fail-closed (iron rule): the client key is
// required so a replay can never double-debit or double-fulfil.
func TestLiveDB_LoyaltyRedeem_NoKey_Rejected(t *testing.T) {
	pool := liveLoyaltyPool(t)
	pts := points.NewService(pool, nil)
	svc := NewService(pool, pts, nil)
	ctx := context.Background()
	uid := seedLoyaltyUser(t, pool)
	sku := seedReward(t, pool, 100)
	seedLoyaltyEarn(t, pool, uid, 500)

	if _, err := svc.Redeem(ctx, uid, sku, ""); !errors.Is(err, points.ErrIdempotencyRequired) {
		t.Fatalf("headerless redeem: err = %v, want points.ErrIdempotencyRequired", err)
	}
	var debits, fulfilments int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM points_ledger WHERE user_id=$1 AND type='REDEEM'`, uid).Scan(&debits); err != nil {
		t.Fatalf("count debits: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM loyalty_redemptions WHERE user_id=$1`, uid).Scan(&fulfilments); err != nil {
		t.Fatalf("count fulfilments: %v", err)
	}
	if debits != 0 || fulfilments != 0 {
		t.Fatalf("rejected redeem must write nothing, got %d debits / %d fulfilments", debits, fulfilments)
	}
}
