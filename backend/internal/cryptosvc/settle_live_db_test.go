package cryptosvc

// Live-DB tests: the settler against the REAL ledger and tier gate. SKIPPED unless
// TEST_DATABASE_URL is set. Standing accounts are shared across tests and sessions, so
// every assertion is on deltas, never absolutes.

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"
	"github.com/shopspring/decimal"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/testsupport"
)

type liveRig struct {
	ctx      context.Context
	pool     *pgxpool.Pool
	led      *ledger.Service
	s        *Settler
	user     string
	wallet   *ledger.Account
	clearing *ledger.Account
	revenue  *ledger.Account
}

func newLiveRig(t *testing.T, tier int, fundKobo int64) *liveRig {
	t.Helper()
	ctx := context.Background()
	pool := livePool(t)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	led.SetDebitGuard(tiers.NewService(pool).EnforceWalletDebitLimitTx)

	u := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUserCtx(t, ctx, pool, u)
	testsupport.SetKycTier(t, ctx, pool, u, tier)
	src, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatal(err)
	}
	if fundKobo > 0 {
		if err := led.Credit(ctx, u, "seed", "seed:"+u, src.ID, fundKobo); err != nil {
			t.Fatalf("fund: %v", err)
		}
	}
	w, _ := led.GetOrCreateUserWallet(ctx, u)
	c, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountCryptoClearing)
	if err != nil {
		t.Fatalf("crypto_clearing account (is migration 20271028000000 applied?): %v", err)
	}
	r, _ := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	return &liveRig{ctx: ctx, pool: pool, led: led, s: NewSettler(led), user: u, wallet: w, clearing: c, revenue: r}
}

func (r *liveRig) bal(t *testing.T, a *ledger.Account) int64 {
	t.Helper()
	b, err := r.led.GetAccountBalance(r.ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

type snap struct{ w, c, rev int64 }

func (r *liveRig) snap(t *testing.T) snap {
	return snap{r.bal(t, r.wallet), r.bal(t, r.clearing), r.bal(t, r.revenue)}
}

func liveBuy(user string) SwapLedgerInput {
	return SwapLedgerInput{SwapID: "live-" + uuid.NewString(), UserID: user, Side: SideBuy, NGNKobo: 1_000_000, FeeKobo: 7_500, FeeBps: 75}
}

func TestLive_BuyHoldThenCompleteConservesMoney(t *testing.T) {
	r := newLiveRig(t, 1, 3_000_000)
	in := liveBuy(r.user)
	before := r.snap(t)
	if err := r.s.HoldBuy(r.ctx, in); err != nil {
		t.Fatal(err)
	}
	if err := r.s.CompleteBuy(r.ctx, in); err != nil {
		t.Fatal(err)
	}
	after := r.snap(t)
	if after.w-before.w != -1_007_500 || after.c-before.c != 1_000_000 || after.rev-before.rev != 7_500 {
		t.Fatalf("deltas wallet=%d clearing=%d revenue=%d", after.w-before.w, after.c-before.c, after.rev-before.rev)
	}
	if d := (after.w - before.w) + (after.c - before.c) + (after.rev - before.rev); d != 0 {
		t.Fatalf("value not conserved: %d", d)
	}
}

func TestLive_FailedBuyMakesTheUserWhole(t *testing.T) {
	r := newLiveRig(t, 1, 3_000_000)
	in := liveBuy(r.user)
	before := r.snap(t)
	if err := r.s.HoldBuy(r.ctx, in); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ { // replay must not double-credit
		if err := r.s.FailBuy(r.ctx, in); err != nil {
			t.Fatal(err)
		}
	}
	if after := r.snap(t); after != before {
		t.Fatalf("not made whole: before=%+v after=%+v", before, after)
	}
}

func TestLive_HoldIsGatedByBalanceAndTier(t *testing.T) {
	r := newLiveRig(t, 1, 500_000) // far less than principal + fee
	in := liveBuy(r.user)
	before := r.snap(t)
	if err := r.s.HoldBuy(r.ctx, in); !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("insufficient funds err = %v", err)
	}
	if r.snap(t) != before {
		t.Fatal("a refused hold moved money")
	}

	// Plenty of money but over the tier-1 daily debit cap: refused, zero legs.
	r2 := newLiveRig(t, 1, 900_000_000)
	big := liveBuy(r2.user)
	big.NGNKobo, big.FeeKobo = 800_000_000, 6_000_000
	before2 := r2.snap(t)
	if err := r2.s.HoldBuy(r2.ctx, big); err == nil {
		t.Fatal("a hold over the tier cap was accepted")
	}
	if r2.snap(t) != before2 {
		t.Fatal("a cap-refused hold moved money")
	}
}

func TestLive_ConcurrentHoldsForOneSwapPostOnce(t *testing.T) {
	r := newLiveRig(t, 1, 3_000_000)
	in := liveBuy(r.user)
	before := r.snap(t)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := r.s.HoldBuy(r.ctx, in); err != nil {
				t.Errorf("hold: %v", err)
			}
		}()
	}
	wg.Wait()
	if got := before.w - r.snap(t).w; got != 1_007_500 {
		t.Fatalf("wallet debited %d, want exactly one hold of 1007500", got)
	}
}

func TestLive_SellPaysNetAndConserves(t *testing.T) {
	r := newLiveRig(t, 1, 0)
	in := SwapLedgerInput{SwapID: "live-" + uuid.NewString(), UserID: r.user, Side: SideSell, FeeBps: 75, NGNKobo: 1_000_000}
	before := r.snap(t)
	recv := decimal.RequireFromString("10000") // 1,000,000 kobo
	for i := 0; i < 2; i++ {
		if err := r.s.CompleteSell(r.ctx, in, recv); err != nil {
			t.Fatal(err)
		}
	}
	after := r.snap(t)
	if after.w-before.w != 992_500 || after.rev-before.rev != 7_500 || after.c-before.c != -1_000_000 {
		t.Fatalf("deltas wallet=%d revenue=%d clearing=%d", after.w-before.w, after.rev-before.rev, after.c-before.c)
	}
}

func TestLive_ReplayWithADifferentAmountFailsClosed(t *testing.T) {
	r := newLiveRig(t, 1, 3_000_000)
	in := liveBuy(r.user)
	if err := r.s.HoldBuy(r.ctx, in); err != nil {
		t.Fatal(err)
	}
	tampered := in
	tampered.NGNKobo, tampered.FeeKobo = 2_000_000, 15_000
	if err := r.s.HoldBuy(r.ctx, tampered); err == nil {
		t.Fatal("a different journal under the same swap key was accepted")
	}
}

func TestLive_CompleteAndFailRacingPostExactlyOneOutcome(t *testing.T) {
	r := newLiveRig(t, 1, 5_000_000) // 4 holds of 1,007,500 stay under the tier-1 daily cap
	r.s.WithLocker(NewPGSwapLocker(r.pool))
	for i := 0; i < 4; i++ {
		in := liveBuy(r.user)
		before := r.snap(t)
		if err := r.s.HoldBuy(r.ctx, in); err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); _ = r.s.CompleteBuy(r.ctx, in) }()
		go func() { defer wg.Done(); _ = r.s.FailBuy(r.ctx, in) }()
		wg.Wait()
		after := r.snap(t)
		d := snap{after.w - before.w, after.c - before.c, after.rev - before.rev}
		completed := snap{-1_007_500, 1_000_000, 7_500}
		refunded := snap{0, 0, 0}
		if d != completed && d != refunded {
			t.Fatalf("iteration %d: contradictory outcome %+v (want exactly completed or refunded)", i, d)
		}
		if d.w+d.c+d.rev != 0 {
			t.Fatalf("iteration %d: value not conserved: %+v", i, d)
		}
	}
}
