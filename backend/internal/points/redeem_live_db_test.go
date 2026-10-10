package points

// Live-DB tests for Redeem. SKIPPED whenever TEST_DATABASE_URL is unset — same
// convention as internal/finance/referrals/rewards_service_test.go.
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/points/... -v
//
// Regression: the in-tx balance projection carried FOR UPDATE on a SUM()
// aggregate — Postgres rejects that (SQLSTATE 0A000), so EVERY redeem failed.
// These tests exercise the advisory-lock + projection shape that replaced it.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func livePointsPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB points test")
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

func seedPointsUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	uid := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, uid, "pts-"+uid+"@test.local"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, uid)
	return uid
}

func seedCatalogItem(t *testing.T, pool *pgxpool.Pool, cost int64) string {
	t.Helper()
	sku := "TEST-" + uuid.NewString()[:13]
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO points_catalog (sku, title, kind, cost_points, value_kobo, active)
		 VALUES ($1,'test item','airtime',$2,0,true)`, sku, cost); err != nil {
		t.Fatalf("seed catalog: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()),
			`DELETE FROM points_catalog WHERE sku=$1`, sku)
	})
	return sku
}

func seedEarn(t *testing.T, pool *pgxpool.Pool, uid string, pts int64) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO points_ledger (user_id, type, points, rule_key, reference, idempotency_key)
		 VALUES ($1,'EARN',$2,'test.seed','ref','earn-test:'||$3)`, uid, pts, uuid.NewString()); err != nil {
		t.Fatalf("seed earn: %v", err)
	}
}

// The exact prod bug: a funded user redeeming a valid SKU must succeed (this
// errored on every call while the balance query carried FOR UPDATE).
func TestLiveDB_Redeem_SucceedsAndDebits(t *testing.T) {
	pool := livePointsPool(t)
	svc := NewService(pool, nil)
	ctx := context.Background()
	uid := seedPointsUser(t, pool)
	sku := seedCatalogItem(t, pool, 100)
	seedEarn(t, pool, uid, 500)

	red, item, err := svc.Redeem(ctx, uid, sku, "redeem-"+uuid.NewString())
	if err != nil {
		t.Fatalf("redeem: %v", err)
	}
	if red.Status != "REDEEMED" || red.CostPoints != 100 || item.SKU != sku {
		t.Fatalf("unexpected redemption: %+v / %+v", red, item)
	}
	bal, err := svc.Balance(ctx, uid)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal != 400 {
		t.Fatalf("balance after redeem: got %d, want 400", bal)
	}
}

func TestLiveDB_Redeem_InsufficientPoints(t *testing.T) {
	pool := livePointsPool(t)
	svc := NewService(pool, nil)
	ctx := context.Background()
	uid := seedPointsUser(t, pool)
	sku := seedCatalogItem(t, pool, 100)
	seedEarn(t, pool, uid, 50)

	if _, _, err := svc.Redeem(ctx, uid, sku, "redeem-"+uuid.NewString()); !errors.Is(err, ErrInsufficientPoints) {
		t.Fatalf("expected ErrInsufficientPoints, got %v", err)
	}
}

// A client-supplied idempotency key makes a replay return the SAME redemption
// with no second ledger debit.
func TestLiveDB_Redeem_ClientKeyReplaysIdempotently(t *testing.T) {
	pool := livePointsPool(t)
	svc := NewService(pool, nil)
	ctx := context.Background()
	uid := seedPointsUser(t, pool)
	sku := seedCatalogItem(t, pool, 100)
	seedEarn(t, pool, uid, 500)

	key := "client-" + uuid.NewString()
	first, _, err := svc.Redeem(ctx, uid, sku, key)
	if err != nil {
		t.Fatalf("first redeem: %v", err)
	}
	second, _, err := svc.Redeem(ctx, uid, sku, key)
	if err != nil {
		t.Fatalf("replay redeem: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("replay must return the same redemption id: %s vs %s", first.ID, second.ID)
	}
	var debits int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM points_ledger WHERE user_id=$1 AND type='REDEEM'`, uid).Scan(&debits); err != nil {
		t.Fatalf("count debits: %v", err)
	}
	if debits != 1 {
		t.Fatalf("expected exactly 1 REDEEM ledger entry, got %d", debits)
	}
	bal, _ := svc.Balance(ctx, uid)
	if bal != 400 {
		t.Fatalf("balance after replay: got %d, want 400 (no double debit)", bal)
	}
}

// Two different users sending the SAME client key must not collide — the key is
// scoped to the user inside the ledger key.
func TestLiveDB_Redeem_SameKeyDifferentUsersIsolated(t *testing.T) {
	pool := livePointsPool(t)
	svc := NewService(pool, nil)
	ctx := context.Background()
	u1 := seedPointsUser(t, pool)
	u2 := seedPointsUser(t, pool)
	sku := seedCatalogItem(t, pool, 100)
	seedEarn(t, pool, u1, 500)
	seedEarn(t, pool, u2, 500)

	key := "shared-" + uuid.NewString()
	r1, _, err := svc.Redeem(ctx, u1, sku, key)
	if err != nil {
		t.Fatalf("u1 redeem: %v", err)
	}
	r2, _, err := svc.Redeem(ctx, u2, sku, key)
	if err != nil {
		t.Fatalf("u2 redeem with same client key must not collide: %v", err)
	}
	if r1.ID == r2.ID || r1.UserID != u1 || r2.UserID != u2 {
		t.Fatalf("cross-user key collision: %+v vs %+v", r1, r2)
	}
}
