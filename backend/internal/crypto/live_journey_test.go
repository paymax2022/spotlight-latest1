package crypto

// LIVE-DB money-journey for crypto — flag-off locally, so the suite drives the
// service end-to-end: seed asset → fund wallet → Buy (wallet DEBIT → escrow
// CREDIT, balanced, audited) → replay → Sell.
// Tier probe: kyc_tier=0 refused before the wallet leg posts.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"os"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"

	"spotlight/backend/internal/testsupport"
)

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping crypto live-DB journey test")
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

// countLegs returns (rows, summed amount_kobo) under an idempotency-key LIKE
// pattern — the ledger-of-record evidence for a money move.
func countLegs(t *testing.T, ctx context.Context, pool *pgxpool.Pool, like string) (int, int64) {
	t.Helper()
	var n int
	var sum int64
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE idempotency_key LIKE $1`,
		like).Scan(&n, &sum); err != nil {
		t.Fatalf("count legs %q: %v", like, err)
	}
	return n, sum
}

func seedLiveUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, led *ledger.Service, tier, fundKobo int64) string {
	t.Helper()
	u := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUserCtx(t, ctx, pool, u)
	testsupport.SetKycTier(t, ctx, pool, u, int(tier))
	if fundKobo > 0 {
		src, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
		if err != nil {
			t.Fatalf("standing account: %v", err)
		}
		if err := led.Credit(ctx, u, "seed", "seed:"+u+":"+uuid.NewString(), src.ID, fundKobo); err != nil {
			t.Fatalf("fund wallet: %v", err)
		}
	}
	return u
}

func TestLiveDB_CryptoBuySellJourney(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, led, NewMockPriceProvider())

	admin := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, admin, admin+"@seed.test"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	testsupport.CleanupUser(t, pool, admin)

	// Seed a fresh active asset (upsert on symbol → replay-safe).
	a, err := svc.AdminConfigAsset(ctx, admin, "MTLT", "MTL Test Asset", 100_000_000, true)
	if err != nil {
		t.Fatalf("config asset: %v", err)
	}

	u := seedLiveUser(t, ctx, pool, led, testsupport.KycTierUnlimited, 5_000_000)

	// BUY: cashKobo wallet debit → escrow credit; holding projection credits.
	buyKey := "mtl-crybuy:" + uuid.NewString()
	o, err := svc.Buy(ctx, u, a.ID, 1_000_000, buyKey)
	if err != nil {
		t.Fatalf("buy: %v", err)
	}
	if o.Status != "filled" || o.Units <= 0 {
		t.Fatalf("buy must fill with positive units, got %+v", o)
	}
	// Ledger evidence: DR user_wallet / CR escrow under key buyKey+":wallet:*".
	// A balanced pair = 2 rows each carrying the full amount → sum is 2×.
	n, sum := countLegs(t, ctx, pool, buyKey+":wallet:%")
	if n != 2 || sum != 2_000_000 {
		t.Fatalf("buy cash leg must post exactly one balanced pair of 1_000_000 kobo, got %d rows summing %d", n, sum)
	}
	// Audit event emitted (money rule).
	var aud int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM crypto_audit_log WHERE entity_id=$1 AND action='crypto.buy'`, o.ID).Scan(&aud); err != nil {
		t.Fatalf("audit lookup: %v", err)
	}
	if aud != 1 {
		t.Fatalf("buy must emit exactly one crypto.buy audit row, got %d", aud)
	}

	// Idempotent replay: same key returns the filled order, posts NO second leg.
	o2, err := svc.Buy(ctx, u, a.ID, 1_000_000, buyKey)
	if err != nil {
		t.Fatalf("buy replay: %v", err)
	}
	if o2.ID != o.ID {
		t.Fatalf("replay must return the same order id, got %s vs %s", o2.ID, o.ID)
	}
	if n2, _ := countLegs(t, ctx, pool, buyKey+":wallet:%"); n2 != 2 {
		t.Fatalf("replay must not post a second leg pair, got %d rows", n2)
	}
	hs, err := svc.Holdings(ctx, u)
	if err != nil || len(hs) == 0 {
		t.Fatalf("holding must be credited after buy: %v", err)
	}

	// SELL part of the position: escrow → wallet credit.
	sellKey := "mtl-crysell:" + uuid.NewString()
	so, err := svc.Sell(ctx, u, a.ID, o.Units/2, sellKey)
	if err != nil {
		t.Fatalf("sell: %v", err)
	}
	if so.Status != "filled" || so.CashKobo <= 0 {
		t.Fatalf("sell must fill with positive proceeds, got %+v", so)
	}
	sn, ssum := countLegs(t, ctx, pool, sellKey+":wallet:%")
	if sn != 2 || ssum != 2*so.CashKobo {
		t.Fatalf("sell cash leg must post one balanced pair of %d kobo, got %d rows summing %d", so.CashKobo, sn, ssum)
	}
	if _, err := svc.Sell(ctx, u, a.ID, o.Units/2, sellKey); err != nil {
		t.Fatalf("sell replay: %v", err)
	}
	if sn2, _ := countLegs(t, ctx, pool, sellKey+":wallet:%"); sn2 != 2 {
		t.Fatalf("sell replay must not post a second leg pair, got %d rows", sn2)
	}
}

// Tier-refusal probe: tier-0 (wallet-debit disabled) is refused BEFORE money
// moves — zero ledger entries for the attempted buy.
func TestLiveDB_CryptoBuyTier0RefusedZeroLegs(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, led, NewMockPriceProvider())

	admin := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, admin, admin+"@seed.test"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	testsupport.CleanupUser(t, pool, admin)
	a, err := svc.AdminConfigAsset(ctx, admin, "MTLT0", "MTL Tier0 Probe", 100_000_000, true)
	if err != nil {
		t.Fatalf("config asset: %v", err)
	}

	// Funded but tier-0: the debit gate must refuse despite the balance.
	u := seedLiveUser(t, ctx, pool, led, 0, 5_000_000)
	key := "mtl-crytier0:" + uuid.NewString()
	if _, err := svc.Buy(ctx, u, a.ID, 1_000_000, key); !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("tier-0 buy must be refused with ErrWalletDisabled, got %v", err)
	}
	if n, _ := countLegs(t, ctx, pool, key+":%"); n != 0 {
		t.Fatalf("refused buy must post zero ledger legs, got %d", n)
	}
}
