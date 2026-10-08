package providerimport_test

// LIVE-DB test of the mirror's SQL: upsert idempotency, and the join that says
// whether Paymax's own book holds the same policy. Skipped unless
// TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/insurance/providerimport"
)

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB provider-mirror test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func TestRepository_UpsertIsIdempotentAndMatchesAgainstTheBook_Integration(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	repo := providerimport.NewRepository(pool)
	provider := "mycover-test-" + time.Now().Format("150405.000000")
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM insurance_provider_policy WHERE provider=$1`, provider)
		_, _ = pool.Exec(context.Background(), `DELETE FROM insurance_policy WHERE provider=$1`, provider)
	})

	boughtHere := providerimport.Summary{ProviderPolicyRef: "ref-in-paymax", ProductName: "Hospicash", PremiumKobo: 10000, Status: "active"}
	boughtAtProvider := providerimport.Summary{ProviderPolicyRef: "ref-provider-only", ProductName: "Artisan", PremiumKobo: 50000, Status: "expired"}

	for i, want := range []bool{true, false} { // first run inserts, second updates
		got, err := repo.Upsert(ctx, provider, boughtHere)
		if err != nil || got != want {
			t.Fatalf("run %d: inserted=%v err=%v, want inserted=%v", i, got, err, want)
		}
	}
	if _, err := repo.Upsert(ctx, provider, boughtAtProvider); err != nil {
		t.Fatal(err)
	}

	// Paymax's own book holds only the first one.
	var uid string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM auth.users LIMIT 1`).Scan(&uid); err != nil {
		t.Skipf("no auth.users row to own a test policy: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO insurance_policy (policyholder_user_id, product_code, provider, provider_policy_ref, state)
		VALUES ($1, 'test-product', $2, 'ref-in-paymax', 'ACTIVE')`, uid, provider); err != nil {
		t.Fatalf("seed local policy: %v", err)
	}

	ov, err := repo.Overview(ctx, provider)
	if err != nil {
		t.Fatal(err)
	}
	if ov.Total != 2 || ov.InPaymax != 1 || ov.NotInPaymax != 1 || ov.NotInPaymaxKobo != 50000 {
		t.Fatalf("overview = %+v", ov)
	}

	no := false
	rows, err := repo.List(ctx, provider, &no, 50, 0)
	if err != nil || len(rows) != 1 || rows[0].ProviderPolicyRef != "ref-provider-only" || rows[0].InPaymax {
		t.Fatalf("in_paymax=false rows = %+v err=%v", rows, err)
	}
	yes := true
	rows, err = repo.List(ctx, provider, &yes, 50, 0)
	if err != nil || len(rows) != 1 || rows[0].PaymaxState != "ACTIVE" || !rows[0].InPaymax {
		t.Fatalf("in_paymax=true rows = %+v err=%v", rows, err)
	}
	all, _ := repo.List(ctx, provider, nil, 50, 0)
	if len(all) != 2 {
		t.Fatalf("unfiltered = %d rows, want 2", len(all))
	}
}
