package spotlightwealth

// LIVE-DB money-journey for Spotlight Wealth — flag-off locally, so the suite
// drives the service end-to-end: seed challenge → join → complete under an
// Idempotency-Key → reward redistributed from paymax_revenue (never minted) →
// replay pays once. Scope: completion is money-IN, so no debit tier gate
// applies; the refusal surface is completing an unjoined challenge (403).
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"

	"spotlight/backend/internal/testsupport"
)

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping spotlightwealth live-DB journey test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestLiveDB_ChallengeRewardWalletCredit(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, led, nil)

	u := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, u)

	// Seed a published, unexpired challenge (content is migration-seeded config;
	// the test owns its own row so it never depends on fixture state).
	chID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO spotlight_challenges (id, title, description, reward_kobo, currency, ends_at, kind, published)
		VALUES ($1,'MTL Challenge','money-tail probe',500000,'NGN', now() + interval '7 days','savings',true)`, chID); err != nil {
		t.Fatalf("seed challenge: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM spotlight_challenge_members WHERE challenge_id=$1`, chID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM spotlight_challenges WHERE id=$1`, chID)
	})

	if _, err := svc.JoinChallenge(ctx, u, chID); err != nil {
		t.Fatalf("join: %v", err)
	}
	key := "mtl-swcmp:" + uuid.NewString()
	w, err := svc.CompleteChallenge(ctx, u, chID, key)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if w.Balance.Amount != 5000.0 { // 500_000 kobo = ₦5,000 display
		t.Fatalf("reward wallet must show ₦5,000 after one completion, got %v", w.Balance.Amount)
	}

	// Ledger evidence: one balanced pair, DR paymax_revenue → CR member wallet.
	var n int
	var sum int64
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE idempotency_key LIKE $1`,
		key+":wallet:%").Scan(&n, &sum); err != nil {
		t.Fatalf("ledger lookup: %v", err)
	}
	if n != 2 || sum != 1_000_000 { // balanced pair: 2 rows × 500_000
		t.Fatalf("reward must post one balanced pair of 500_000, got %d rows summing %d", n, sum)
	}

	// Idempotent replay: same key → balance still ₦5,000, no second leg.
	w2, err := svc.CompleteChallenge(ctx, u, chID, key)
	if err != nil {
		t.Fatalf("complete replay: %v", err)
	}
	if w2.Balance.Amount != 5000.0 {
		t.Fatalf("replay must not double-pay, balance %v", w2.Balance.Amount)
	}
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key LIKE $1`,
		key+":wallet:%").Scan(&n); err != nil {
		t.Fatalf("ledger recount: %v", err)
	}
	if n != 2 {
		t.Fatalf("replay must not post a second leg pair, got %d rows", n)
	}

	// Refusal surface: a member who never joined cannot complete (403).
	stranger := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, stranger, stranger+"@seed.test"); err != nil {
		t.Fatalf("seed stranger: %v", err)
	}
	testsupport.CleanupUser(t, pool, stranger)
	if _, err := svc.CompleteChallenge(ctx, stranger, chID, "mtl-swstr:"+uuid.NewString()); err == nil {
		t.Fatal("completing without joining must be refused")
	}
}
