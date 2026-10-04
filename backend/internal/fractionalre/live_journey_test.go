package fractionalre

// LIVE-DB money-journey for fractional real estate — the module is flag-off
// locally so the suite drives the service layer end-to-end: investor activate →
// HNI classify → asset lifecycle → offering → risk ack → Subscribe (wallet
// DEBIT → escrow) → maker/checker close → distribution → investor wallet.
// Tier probes: tier-0 refused before any leg posts; unclassified retail refused
// by the 10%-income cap. Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"os"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"

	"spotlight/backend/internal/testsupport"
)

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping fractionalre live-DB journey test")
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

func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	u := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUserCtx(t, ctx, pool, u)
	return u
}

// setKycVerified writes the full KYC state fractionalre's gate reads:
// kyc_status='verified' AND kyc_tier (the Subscribe gate requires tier >= 1).
func setKycVerified(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string, tier int) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_profiles (id, email, kyc_tier, kyc_status) VALUES ($1,$2,$3,'verified')
		ON CONFLICT (id) DO UPDATE SET kyc_tier = EXCLUDED.kyc_tier, kyc_status = 'verified'`,
		userID, userID+"@seed.test", tier); err != nil {
		t.Fatalf("seed verified kyc tier %d for %s: %v", tier, userID, err)
	}
}

func fundWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, kobo int64) {
	t.Helper()
	src, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("standing account: %v", err)
	}
	if err := led.Credit(ctx, userID, "seed", "seed:"+userID+":"+uuid.NewString(), src.ID, kobo); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
}

// setupLiveOffering runs the sponsor→asset→verify→approve→live→offering chain
// both journey tests share and returns the live offering (off.AssetID carries
// the asset id for later distribution assertions).
func setupLiveOffering(t *testing.T, ctx context.Context, svc *Service, maker, verifier, name, location string, navKobo, shareCount, minThresholdKobo int64) *Offering {
	t.Helper()
	sp, err := svc.CreateSponsor(ctx, maker, &Sponsor{Name: name + " Sponsor"})
	if err != nil {
		t.Fatalf("sponsor: %v", err)
	}
	a, err := svc.CreateAsset(ctx, maker, &Asset{
		SponsorID: &sp.ID, Name: name + " Asset", AssetType: TypeIncomeProperty,
		Location: &location, NAVKobo: navKobo,
	})
	if err != nil {
		t.Fatalf("asset: %v", err)
	}
	for _, to := range []AssetStatus{AssetDueDiligence, AssetTitleVerify} {
		if _, err := svc.Transition(ctx, maker, a.ID, to); err != nil {
			t.Fatalf("transition → %s: %v", to, err)
		}
	}
	if _, err := svc.TitleVerify(ctx, verifier, a.ID, true, ""); err != nil {
		t.Fatalf("title verify: %v", err)
	}
	for _, to := range []AssetStatus{AssetApproved, AssetLive} {
		if _, err := svc.Transition(ctx, maker, a.ID, to); err != nil {
			t.Fatalf("transition → %s: %v", to, err)
		}
	}
	off, err := svc.CreateOffering(ctx, maker, &Offering{
		AssetID: a.ID, Name: name + " Round",
		UnitPriceKobo: 100_000, ShareCount: shareCount,
		MinThresholdKobo: minThresholdKobo, TicketMinKobo: 100_000,
	})
	if err != nil {
		t.Fatalf("offering: %v", err)
	}
	if err := svc.OpenOffering(ctx, maker, off.ID); err != nil {
		t.Fatalf("open offering: %v", err)
	}
	return off
}

func TestLiveDB_FractionalRESubscribeDividendJourney(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(NewRepository(pool), led, settlement.NewService(pool, led), kyc.NewService(pool), tiers.NewService(pool), nil)

	maker := seedUser(t, ctx, pool)
	checker := seedUser(t, ctx, pool)
	verifier := seedUser(t, ctx, pool)
	investor := seedUser(t, ctx, pool)
	setKycVerified(t, ctx, pool, investor, 3)
	fundWallet(t, ctx, led, investor, 20_000_000)

	// Investor onboarding: activate + classify HNI (exempts the retail cap).
	if _, err := svc.Activate(ctx, investor); err != nil {
		t.Fatalf("activate: %v", err)
	}
	if err := svc.ClassifyInvestor(ctx, maker, investor, ClassHNI, 0); err != nil {
		t.Fatalf("classify: %v", err)
	}

	// Sponsor + asset lifecycle: draft → due_diligence → title_verify →
	// independent verify (verifier != creator, SoD) → approved → live.
	// Offering: 100 units @ ₦1,000 → target ₦100,000; min threshold ₦40,000.
	off := setupLiveOffering(t, ctx, svc, maker, verifier,
		"MTL Tower", "Lekki Phase 1", 100_000_000, 100, 4_000_000)

	// Per-offer risk ack is required before Subscribe.
	if _, err := svc.AckRisk(ctx, investor, &off.ID, "disclosure-v1", true); err != nil {
		t.Fatalf("risk ack: %v", err)
	}

	// SUBSCRIBE: 50 units = 5_000_000 kobo escrowed (wallet DEBIT → escrow).
	subKey := "mtl-fresub:" + uuid.NewString()
	sub, err := svc.Subscribe(ctx, investor, subKey, off.ID, SubscribeRequest{Units: 50})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if sub.Status != SubEscrowed || sub.AmountKobo != 5_000_000 {
		t.Fatalf("subscription must be escrowed at 5_000_000, got %+v", sub)
	}
	n, sum := countLegs(t, ctx, pool, subKey+":%")
	if n != 2 || sum != 10_000_000 { // balanced pair: 2 rows × 5_000_000
		t.Fatalf("escrow must post one balanced pair of 5_000_000, got %d rows summing %d", n, sum)
	}
	// Idempotent replay: same key → same subscription, no second leg pair.
	sub2, err := svc.Subscribe(ctx, investor, subKey, off.ID, SubscribeRequest{Units: 50})
	if err != nil {
		t.Fatalf("subscribe replay: %v", err)
	}
	if sub2.ID != sub.ID {
		t.Fatalf("replay must return the same subscription, got %s vs %s", sub2.ID, sub.ID)
	}
	if n2, _ := countLegs(t, ctx, pool, subKey+":%"); n2 != 2 {
		t.Fatalf("replay must not post a second escrow pair, got %d rows", n2)
	}

	// Maker/checker close: threshold met (5.0m >= 4.0m) → Funded + cap table.
	if err := svc.ProposeClose(ctx, maker, off.ID); err != nil {
		t.Fatalf("propose close: %v", err)
	}
	// SoD: maker cannot approve their own close.
	if _, err := svc.CloseAndSettle(ctx, maker, off.ID); !errors.Is(err, ErrMakerChecker) {
		t.Fatalf("maker approving own close must fail SoD, got %v", err)
	}
	closed, err := svc.CloseAndSettle(ctx, checker, off.ID)
	if err != nil {
		t.Fatalf("close+settle: %v", err)
	}
	if closed.Status != OfferingFunded {
		t.Fatalf("offering must be funded, got %s", closed.Status)
	}
	holds, err := svc.ListHoldings(ctx, investor)
	if err != nil {
		t.Fatalf("holdings: %v", err)
	}
	if len(holds) != 1 || holds[0].Units != 50 {
		t.Fatalf("cap table must show 50 units, got %+v", holds)
	}

	// DIVIDEND: maker schedules ₦10,000 gross → checker approves → escrow pays.
	distKey := "mtl-fredist:" + uuid.NewString()
	dist, err := svc.ScheduleDistribution(ctx, maker, distKey, ScheduleDistributionRequest{
		AssetID: off.AssetID, PeriodLabel: "FY-Q1", GrossKobo: 1_000_000,
	})
	if err != nil {
		t.Fatalf("schedule distribution: %v", err)
	}
	if _, err := svc.ApproveDistribution(ctx, maker, dist.ID); !errors.Is(err, ErrMakerChecker) {
		t.Fatalf("maker approving own distribution must fail SoD, got %v", err)
	}
	paid, err := svc.ApproveDistribution(ctx, checker, dist.ID)
	if err != nil {
		t.Fatalf("approve distribution: %v", err)
	}
	if paid.Status != DistPaid {
		t.Fatalf("distribution must be fully paid, got %s", paid.Status)
	}
	// Sole holder receives the whole net pool: escrow DEBIT → investor wallet.
	dn, dsum := countLegs(t, ctx, pool, distKey+":%")
	if dn != 2 || dsum != 2_000_000 { // balanced pair: 2 rows × 1_000_000
		t.Fatalf("distribution must credit one balanced pair of 1_000_000, got %d rows summing %d", dn, dsum)
	}
}

// Tier-refusal probes on Subscribe: (a) kyc_verified tier-0 member refused at
// the KYC gate before any money moves; (b) an activated but UNCLASSIFIED retail
// member with zero declared income is refused by the fail-closed income cap.
func TestLiveDB_FractionalRESubscribeRefusalsZeroLegs(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(NewRepository(pool), led, settlement.NewService(pool, led), kyc.NewService(pool), tiers.NewService(pool), nil)

	maker := seedUser(t, ctx, pool)
	verifier := seedUser(t, ctx, pool)

	off := setupLiveOffering(t, ctx, svc, maker, verifier,
		"MTL Refusal", "Ikeja", 50_000_000, 50, 1_000_000)

	// (a) verified tier-0 investor: refused at the KYC gate (tier < 1).
	u0 := seedUser(t, ctx, pool)
	setKycVerified(t, ctx, pool, u0, 0)
	fundWallet(t, ctx, led, u0, 5_000_000)
	if _, err := svc.AckRisk(ctx, u0, &off.ID, "disclosure-v1", true); err != nil {
		t.Fatalf("ack: %v", err)
	}
	key0 := "mtl-fret0:" + uuid.NewString()
	if _, err := svc.Subscribe(ctx, u0, key0, off.ID, SubscribeRequest{Units: 10}); !errors.Is(err, ErrKYCRequired) {
		t.Fatalf("tier-0 subscribe must be refused with ErrKYCRequired, got %v", err)
	}
	if n, _ := countLegs(t, ctx, pool, key0+":%"); n != 0 {
		t.Fatalf("refused subscribe must post zero ledger legs, got %d", n)
	}

	// (b) activated retail investor with ZERO declared income: the 10%-income
	// cap is fail-closed (cap 0 → any positive request refused).
	ur := seedUser(t, ctx, pool)
	setKycVerified(t, ctx, pool, ur, 3)
	fundWallet(t, ctx, led, ur, 5_000_000)
	if _, err := svc.Activate(ctx, ur); err != nil {
		t.Fatalf("activate retail: %v", err)
	}
	if _, err := svc.AckRisk(ctx, ur, &off.ID, "disclosure-v1", true); err != nil {
		t.Fatalf("ack retail: %v", err)
	}
	keyr := "mtl-freretail:" + uuid.NewString()
	if _, err := svc.Subscribe(ctx, ur, keyr, off.ID, SubscribeRequest{Units: 10}); !errors.Is(err, ErrLimitExceeded) {
		t.Fatalf("zero-income retail subscribe must be refused with ErrLimitExceeded, got %v", err)
	}
	if n, _ := countLegs(t, ctx, pool, keyr+":%"); n != 0 {
		t.Fatalf("cap-refused subscribe must post zero ledger legs, got %d", n)
	}
}
