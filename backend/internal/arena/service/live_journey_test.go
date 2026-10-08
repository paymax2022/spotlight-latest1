package service_test

// LIVE-DB money-journey for the Arena support rail — flag-off locally, so the
// suite drives the services end-to-end: competition create → publish →
// Contribute (wallet DEBIT → arena_support_pot) → replay → PotTotal.
// Tier probe: a kyc_tier=0 backer is refused before money moves.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"os"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/arena/repo"
	"spotlight/backend/internal/arena/service"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"

	"spotlight/backend/internal/testsupport"
)

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping arena live-DB journey test")
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

func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, led *ledger.Service, tier, fundKobo int64) string {
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

func TestLiveDB_ArenaSupportContributeJourney(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	audit := repo.NewAuditRepo(pool)
	compRepo := repo.NewCompetitionRepo(pool)
	compSvc := service.NewCompetitionService(compRepo, audit)
	supSvc := service.NewSupportService(
		repo.NewSupportRepo(pool),
		repo.NewLedgerAdapter(led),
		repo.NewTierAdapter(kyc.NewService(pool)),
		compRepo, // ConfigReader: serves the published _arena gates
		audit,
	).WithDebitLimiter(repo.NewDebitLimitAdapter(tiers.NewService(pool)))

	admin := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, admin, admin+"@seed.test"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	testsupport.CleanupUser(t, pool, admin)

	c, err := compSvc.Create(ctx, admin, "mtl-support-"+uuid.NewString()[:8], "MTL Support Cup", "Africa/Lagos")
	if err != nil {
		t.Fatalf("create competition: %v", err)
	}
	if _, err := compSvc.PublishConfig(ctx, admin, c.ID, service.Config{
		RequiredKYCTier: 1, PotApprovalsRequired: 1,
	}); err != nil {
		t.Fatalf("publish config: %v", err)
	}

	backer := seedUser(t, ctx, pool, led, testsupport.KycTierUnlimited, 5_000_000)

	// SUPPORT: wallet DEBIT → arena_support_pot (pot-level gift, contestant "").
	key := "mtl-arasup:" + uuid.NewString()
	if err := supSvc.Contribute(ctx, backer, key, c.ID, "", 250_000); err != nil {
		t.Fatalf("contribute: %v", err)
	}
	var n int
	var sum int64
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE idempotency_key LIKE $1`,
		key+":%").Scan(&n, &sum); err != nil {
		t.Fatalf("ledger lookup: %v", err)
	}
	if n != 2 || sum != 500_000 { // balanced pair: 2 rows × 250_000
		t.Fatalf("support must post one balanced pair of 250_000, got %d rows summing %d", n, sum)
	}
	// Pot total derived from tagged support rows.
	total, err := supSvc.PotTotal(ctx, c.ID)
	if err != nil {
		t.Fatalf("pot total: %v", err)
	}
	if total != 250_000 {
		t.Fatalf("pot projection must equal the gift, got %d", total)
	}
	// Idempotent replay: same key → success, no second leg, no second tag row.
	if err := supSvc.Contribute(ctx, backer, key, c.ID, "", 250_000); err != nil {
		t.Fatalf("contribute replay: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key LIKE $1`, key+":%").Scan(&n); err != nil {
		t.Fatalf("ledger recount: %v", err)
	}
	if n != 2 {
		t.Fatalf("replay must not post a second leg pair, got %d", n)
	}
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM arena_support_txn WHERE idempotency_key=$1`, key).Scan(&n); err != nil {
		t.Fatalf("support row count: %v", err)
	}
	if n != 1 {
		t.Fatalf("replay must not insert a second support row, got %d", n)
	}
}

// Tier-refusal probe: a tier-0 backer fails the NDC-3 required-tier gate
// BEFORE money moves — zero ledger legs, zero support rows.
func TestLiveDB_ArenaSupportTier0RefusedZeroLegs(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	audit := repo.NewAuditRepo(pool)
	compRepo := repo.NewCompetitionRepo(pool)
	compSvc := service.NewCompetitionService(compRepo, audit)
	supSvc := service.NewSupportService(
		repo.NewSupportRepo(pool),
		repo.NewLedgerAdapter(led),
		repo.NewTierAdapter(kyc.NewService(pool)),
		compRepo,
		audit,
	).WithDebitLimiter(repo.NewDebitLimitAdapter(tiers.NewService(pool)))

	admin := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, admin, admin+"@seed.test"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	testsupport.CleanupUser(t, pool, admin)

	c, err := compSvc.Create(ctx, admin, "mtl-t0-"+uuid.NewString()[:8], "MTL Tier0 Cup", "Africa/Lagos")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := compSvc.PublishConfig(ctx, admin, c.ID, service.Config{RequiredKYCTier: 1, PotApprovalsRequired: 1}); err != nil {
		t.Fatalf("publish: %v", err)
	}

	u := seedUser(t, ctx, pool, led, 0, 5_000_000) // funded but tier 0
	key := "mtl-arat0:" + uuid.NewString()
	err = supSvc.Contribute(ctx, u, key, c.ID, "", 100_000)
	if !errors.Is(err, service.ErrKYCTierTooLow) && !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("tier-0 contribute must be refused by a tier gate, got %v", err)
	}
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key LIKE $1`, key+":%").Scan(&n); err != nil {
		t.Fatalf("ledger count: %v", err)
	}
	if n != 0 {
		t.Fatalf("refused support must post zero ledger legs, got %d", n)
	}
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM arena_support_txn WHERE idempotency_key=$1`, key).Scan(&n); err != nil {
		t.Fatalf("support row count: %v", err)
	}
	if n != 0 {
		t.Fatalf("refused support must tag zero rows, got %d", n)
	}
}
