package invest

// LIVE-DB money-journey for invest — flag-off locally, so the suite drives the
// service end-to-end: profile → suitability → KYC lift → Deposit (wallet DEBIT
// → settlement bridge + invest-cash leg) → market Buy on a seeded stock (mock
// broker) → filled → PendingSettlement → portfolio + alert evaluation.
// Tier probe: kyc_tier=0 refused before any ledger leg posts.
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
		t.Skip("no TEST_DATABASE_URL — skipping invest live-DB journey test")
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

// onboard runs the full investor onboarding the handlers drive, then lifts the
// INVEST-profile tier (separate from user_profiles.kyc_tier — preTradeChecks
// reads the invest profile row).
func onboard(t *testing.T, ctx context.Context, svc *Service, userID string, tier int) {
	t.Helper()
	if _, err := svc.Start(ctx, userID, "NG", "NG"); err != nil {
		t.Fatalf("start: %v", err)
	}
	if err := svc.AcceptAgreements(ctx, userID); err != nil {
		t.Fatalf("agreements: %v", err)
	}
	answers := map[string]int{}
	for _, q := range svc.SuitabilityQuestions() {
		answers[q["id"].(string)] = 2
	}
	if _, err := svc.SubmitSuitability(ctx, userID, answers); err != nil {
		t.Fatalf("suitability: %v", err)
	}
	if err := svc.SetKYCTier(ctx, userID, tier); err != nil {
		t.Fatalf("set invest kyc tier: %v", err)
	}
}

func TestLiveDB_InvestDepositBuyAlertJourney(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	md := NewMockMarketData()
	md.SetForceStatus("open") // deterministic: mock broker fills immediately
	svc := NewService(pool, led, NewMockBroker(), md, NewMockPublicOffer())

	u := seedUser(t, ctx, pool, led, testsupport.KycTierUnlimited, 20_000_000)
	onboard(t, ctx, svc, u, 3)

	// DEPOSIT: main-wallet DEBIT → settlement bridge + invest-cash CREDIT.
	depKey := "mtl-invdep:" + uuid.NewString()
	w, err := svc.Deposit(ctx, u, depKey, 10_000_000, "paymax_wallet")
	if err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if w.AvailableCashKobo != 10_000_000 {
		t.Fatalf("invest cash must equal the deposit, got %d", w.AvailableCashKobo)
	}
	// Main-ledger evidence: one balanced pair under depKey+":main:*" (2 rows,
	// each carrying the full amount → sum is 2×).
	n, sum := countLegs(t, ctx, pool, depKey+":main:%")
	if n != 2 || sum != 20_000_000 {
		t.Fatalf("deposit main leg must post one balanced pair of 10_000_000, got %d rows summing %d", n, sum)
	}
	// Invest-ledger evidence: the :inv leg exists too.
	var invLegs int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM invest_ledger_entries WHERE idempotency_key LIKE $1`, depKey+":inv%").Scan(&invLegs); err != nil {
		t.Fatalf("invest ledger lookup: %v", err)
	}
	if invLegs == 0 {
		t.Fatal("deposit must post the invest-cash credit leg")
	}
	// Replay: same key → the SAME wallet view, no second main-ledger pair and no
	// error — the idempotency contract returns the first result (E2E-MTL-002).
	w2, err := svc.Deposit(ctx, u, depKey, 10_000_000, "paymax_wallet")
	if err != nil {
		t.Fatalf("deposit replay must return the first result, got %v", err)
	}
	if *w2 != *w {
		t.Fatalf("deposit replay must return the same wallet view: %+v vs %+v", w2, w)
	}
	if n2, _ := countLegs(t, ctx, pool, depKey+":main:%"); n2 != 2 {
		t.Fatalf("deposit replay must not double-post, got %d rows", n2)
	}

	// BUY: market order on seeded GTCO (min order 500_000) with confirmation PIN.
	buyKey := "mtl-invbuy:" + uuid.NewString()
	rc, err := svc.Buy(ctx, u, buyKey, BuyOrderRequest{Symbol: "GTCO", OrderType: TypeMarket, AmountKobo: 5_000_000, PIN: "1234"})
	if err != nil {
		t.Fatalf("buy: %v", err)
	}
	if rc.Order.Status != StatusPendingSettlement && rc.Order.Status != StatusFilled {
		t.Fatalf("buy must reach filled/pending_settlement, got %s", rc.Order.Status)
	}
	if rc.Order.FilledQuantity <= 0 {
		t.Fatalf("fill quantity must be positive, got %v", rc.Order.FilledQuantity)
	}
	// Idempotent replay: same key → same order, no second invest-ledger lock.
	rc2, err := svc.Buy(ctx, u, buyKey, BuyOrderRequest{Symbol: "GTCO", OrderType: TypeMarket, AmountKobo: 5_000_000, PIN: "1234"})
	if err != nil {
		t.Fatalf("buy replay: %v", err)
	}
	if rc2.Order.ID != rc.Order.ID {
		t.Fatalf("replay must return the same order, got %s vs %s", rc2.Order.ID, rc.Order.ID)
	}
	// Portfolio + positions load without error for the filled user.
	if _, err := svc.Portfolio(ctx, u); err != nil {
		t.Fatalf("portfolio: %v", err)
	}

	// ALERT: below-target alert on GTCO triggers on the next evaluation pass
	// (target far above any seeded mock price → fires deterministically).
	if _, err := svc.CreateAlert(ctx, u, "GTCO", "below", 999_999_999_999); err != nil {
		t.Fatalf("create alert: %v", err)
	}
	triggered, err := svc.EvaluateAlerts(ctx)
	if err != nil {
		t.Fatalf("evaluate alerts: %v", err)
	}
	if triggered < 1 {
		t.Fatal("evaluation must trigger the seeded below-target alert")
	}
	var active int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM invest_price_alerts WHERE user_id=$1 AND status='active'`, u).Scan(&active); err != nil {
		t.Fatalf("alert status lookup: %v", err)
	}
	if active != 0 {
		t.Fatalf("triggered alert must not remain active, got %d", active)
	}
}

// Tier-refusal probe: tier-0 deposit refused BEFORE money moves — zero legs on
// BOTH ledgers (no wallet debit, no invest-cash credit).
func TestLiveDB_InvestDepositTier0RefusedZeroLegs(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	md := NewMockMarketData()
	md.SetForceStatus("open")
	svc := NewService(pool, led, NewMockBroker(), md, NewMockPublicOffer())

	u := seedUser(t, ctx, pool, led, 0, 5_000_000) // funded but wallet-debit disabled
	key := "mtl-invt0:" + uuid.NewString()
	if _, err := svc.Deposit(ctx, u, key, 1_000_000, "paymax_wallet"); !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("tier-0 deposit must be refused with ErrWalletDisabled, got %v", err)
	}
	if n, _ := countLegs(t, ctx, pool, key+":%"); n != 0 {
		t.Fatalf("refused deposit must post zero main-ledger legs, got %d", n)
	}
	var invLegs int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM invest_ledger_entries WHERE idempotency_key LIKE $1`, key+":%").Scan(&invLegs); err != nil {
		t.Fatalf("invest ledger lookup: %v", err)
	}
	if invLegs != 0 {
		t.Fatalf("refused deposit must post zero invest-ledger legs, got %d", invLegs)
	}
}
