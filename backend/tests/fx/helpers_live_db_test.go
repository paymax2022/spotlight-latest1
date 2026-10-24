package fx_test

// Shared live-DB helpers for the FX integration tests. Every test that uses
// them is SKIPPED whenever TEST_DATABASE_URL is unset, so `go test ./...`
// without a database stays green.
//   export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/fx/... -run LiveDB -v

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

// liveDBPool connects using TEST_DATABASE_URL, or skips.
func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB FX convert integration test; see bring-up note in helpers_live_db_test.go")
	}
	pool, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(t.Context()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func newLiveLedger(pool *pgxpool.Pool) *ledger.Service {
	return ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
}

// seedUser inserts a synthetic auth.users row so FKs (fx_quotes.user_id,
// fx_conversions.user_id, currency_wallets.user_id, ledger wallet) resolve. email
// is required by the handle_new_user trigger (user_profiles.email NOT NULL) —
// identical to the crypto/association seedUser helpers.
func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	testsupport.SetKycTier(t, ctx, pool, id, testsupport.KycTierUnlimited)
	t.Cleanup(func() {
		ctx := t.Context()
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM public.fx_conversions WHERE user_id=$1`, id)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM public.fx_quotes WHERE user_id=$1`, id)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM public.currency_wallets WHERE user_id=$1`, id)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM auth.users WHERE id=$1`, id)
	})
	return id
}

// seedWallet credits userID's NGN wallet from the settlement standing account so
// Convert's source-leg Debit has funds to draw down.
func seedWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, amountKobo int64) {
	t.Helper()
	settle, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("seed wallet: standing account: %v", err)
	}
	if err := led.Credit(ctx, userID, "test-seed:"+uuid.New().String(), "test-seed-idem:"+uuid.New().String(), settle.ID, amountKobo); err != nil {
		t.Fatalf("seed wallet: credit: %v", err)
	}
}
