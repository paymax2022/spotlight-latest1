package wallet

// LIVE-DB money-path test for the trading fund service. Drives the REAL finance
// ledger + the fund projection against Postgres, proving: cash actually moves on
// the ledger, units mint/redeem correctly, idempotent replays never double-move
// money, a second depositor doesn't dilute the first, the performance fee leaves
// other holders' NAV unchanged, over-redeem is blocked, deposits are access-gated,
// and reconciliation holds throughout. Skipped unless DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

type allowGate struct{ allow bool }

func (g allowGate) HasTradingAccess(context.Context, string) (bool, error) { return g.allow, nil }

func liveFund(t *testing.T, feeBps, hurdleBps int64, allow bool) (*Service, *ledger.Service, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("no DATABASE_URL — skipping trading live-DB money-path test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, led, allowGate{allow}, feeBps, hurdleBps)
	return svc, led, pool
}

// resetFund empties the fund so NAV starts at par: truncate the projection and
// drain any residual cash out of the trading clearing standing account.
func resetFund(t *testing.T, ctx context.Context, pool *pgxpool.Pool, led *ledger.Service) {
	t.Helper()
	if _, err := pool.Exec(ctx, `TRUNCATE public.trading_fund_units, public.trading_fund_orders, public.trading_fee_accruals, public.trading_hwm_watermarks, public.trading_nav_snapshots`); err != nil {
		t.Fatalf("truncate fund: %v", err)
	}
	clearing, _ := led.GetOrCreateStandingAccount(ctx, ledger.AccountTradingFundClearing)
	sink, _ := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	bal, _ := led.GetAccountBalance(ctx, clearing.ID)
	if bal > 0 {
		_ = led.PostJournal(ctx, ledger.JournalEntry{Reference: "test:reset", IdempotencyKey: "test:reset:" + uuid.NewString(), AmountKobo: bal, DebitAccountID: clearing.ID, CreditAccountID: sink.ID})
	}
}

// seedUser inserts a synthetic auth.users row so the ledger's user_wallet FK
// (user_id → auth.users) is satisfied, and returns the id.
func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	return id
}

// fundWallet seeds a user's Paymax wallet with cash so deposits can debit it.
func fundWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, kobo int64) {
	t.Helper()
	src, _ := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err := led.Credit(ctx, userID, "test:seed", "test:seed:"+userID+":"+uuid.NewString(), src.ID, kobo); err != nil {
		t.Fatalf("seed wallet: %v", err)
	}
}

func TestLiveDB_TradingWallet_MoneyPath(t *testing.T) {
	svc, led, pool := liveFund(t, 2000, 0, true) // 20% perf fee, no hurdle
	defer pool.Close()
	ctx := context.Background()
	resetFund(t, ctx, pool, led)
	run := uuid.NewString() + ":"
	clearing, _ := led.GetOrCreateStandingAccount(ctx, ledger.AccountTradingFundClearing)
	feeAcct, _ := led.GetOrCreateStandingAccount(ctx, ledger.AccountTradingFeeIncome)
	userA := seedUser(t, ctx, pool)
	userB := seedUser(t, ctx, pool)
	fundWallet(t, ctx, led, userA, 10_000_000)
	fundWallet(t, ctx, led, userB, 10_000_000)

	// --- A subscribes ₦10,000 → first deposit at par mints 1.0 unit; cash moves. ---
	walA0, _ := led.GetBalance(ctx, userA)
	oA, err := svc.Subscribe(ctx, userA, run+"sub:A1", 1_000_000)
	if err != nil {
		t.Fatalf("A subscribe: %v", err)
	}
	if oA.UnitsDelta != UnitScale {
		t.Fatalf("first deposit should mint 1.0 unit (%d), got %d", UnitScale, oA.UnitsDelta)
	}
	if walA, _ := led.GetBalance(ctx, userA); walA != walA0-1_000_000 {
		t.Fatalf("A wallet not debited: before=%d after=%d", walA0, walA)
	}
	if cb, _ := led.GetAccountBalance(ctx, clearing.ID); cb != 1_000_000 {
		t.Fatalf("clearing balance = %d, want 1_000_000", cb)
	}
	assertReconciled(t, svc, ctx)

	// --- Idempotent replay: same key must NOT move money again. ---
	walBeforeReplay, _ := led.GetBalance(ctx, userA)
	if _, err := svc.Subscribe(ctx, userA, run+"sub:A1", 1_000_000); err != nil {
		t.Fatalf("A subscribe replay: %v", err)
	}
	if walAfter, _ := led.GetBalance(ctx, userA); walAfter != walBeforeReplay {
		t.Fatalf("idempotent replay double-debited: %d → %d", walBeforeReplay, walAfter)
	}

	// --- B subscribes the same ₦10,000 at par (no P&L yet) → ~1.0 unit; A not diluted. ---
	aUnits0 := userUnits(t, ctx, pool, userA)
	oB, err := svc.Subscribe(ctx, userB, run+"sub:B1", 1_000_000)
	if err != nil {
		t.Fatalf("B subscribe: %v", err)
	}
	if oB.UnitsDelta <= 0 {
		t.Fatalf("B got no units: %d", oB.UnitsDelta)
	}
	if userUnits(t, ctx, pool, userA) != aUnits0 {
		t.Fatal("A's units changed when B deposited (dilution)")
	}
	assertReconciled(t, svc, ctx)

	// --- Inject trading profit: raise fund clearing by ₦4,000 (→ NAV +20%). ---
	src, _ := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err := led.PostJournal(ctx, ledger.JournalEntry{Reference: "test:pnl", IdempotencyKey: "test:pnl:" + uuid.NewString(), AmountKobo: 400_000, DebitAccountID: src.ID, CreditAccountID: clearing.ID}); err != nil {
		t.Fatalf("inject pnl: %v", err)
	}

	// --- Assess A's performance fee: fee income rises; A's units drop; B's NAV value unaffected. ---
	feeBal0, _ := led.GetAccountBalance(ctx, feeAcct.ID)
	bValue0 := unitValue(t, ctx, svc, pool, userB)
	fee, err := svc.AssessPerformanceFee(ctx, userA, run+"fee:A:2026Q3", "2026Q3")
	if err != nil {
		t.Fatalf("assess fee: %v", err)
	}
	if fee <= 0 {
		t.Fatalf("expected a positive performance fee after +20%%, got %d", fee)
	}
	if fb, _ := led.GetAccountBalance(ctx, feeAcct.ID); fb != feeBal0+fee {
		t.Fatalf("fee income not credited: %d → %d (fee %d)", feeBal0, fb, fee)
	}
	// B's holding value must be unchanged by A's fee (fee is charged only to A).
	if bv := unitValue(t, ctx, svc, pool, userB); abs(bv-bValue0) > 2 {
		t.Fatalf("B's value moved on A's fee assessment: %d → %d", bValue0, bv)
	}
	// Fee replay must not double-charge.
	feeBalNow, _ := led.GetAccountBalance(ctx, feeAcct.ID)
	if _, err := svc.AssessPerformanceFee(ctx, userA, run+"fee:A:2026Q3", "2026Q3"); err != nil {
		t.Fatalf("fee replay: %v", err)
	}
	if fb, _ := led.GetAccountBalance(ctx, feeAcct.ID); fb != feeBalNow {
		t.Fatalf("fee replay double-charged: %d → %d", feeBalNow, fb)
	}
	assertReconciled(t, svc, ctx)

	// --- A redeems half their units → cash returns to wallet, units drop. ---
	aUnitsNow := userUnits(t, ctx, pool, userA)
	walA1, _ := led.GetBalance(ctx, userA)
	oR, err := svc.Redeem(ctx, userA, run+"red:A1", aUnitsNow/2)
	if err != nil {
		t.Fatalf("A redeem: %v", err)
	}
	if oR.CashKobo <= 0 {
		t.Fatalf("redeem paid no cash: %d", oR.CashKobo)
	}
	if walA2, _ := led.GetBalance(ctx, userA); walA2 != walA1+oR.CashKobo {
		t.Fatalf("redeem cash not credited: %d + %d != %d", walA1, oR.CashKobo, walA2)
	}
	assertReconciled(t, svc, ctx)

	// --- Over-redeem is blocked. ---
	if _, err := svc.Redeem(ctx, userA, run+"red:over", 1_000_000_000_000); err != ErrInsufficientUnit {
		t.Fatalf("over-redeem must be rejected, got %v", err)
	}
}

// Regression for audit CRITICAL 1: reusing a subscribe's idempotency key on a
// Redeem must NOT pay out (it would refund the deposit AND keep the units). It
// must be rejected as an idem conflict, with no cash movement.
func TestLiveDB_TradingWallet_IdemConflictNoCashout(t *testing.T) {
	svc, led, pool := liveFund(t, 2000, 0, true)
	defer pool.Close()
	ctx := context.Background()
	resetFund(t, ctx, pool, led)
	run := uuid.NewString() + ":"
	a := seedUser(t, ctx, pool)
	fundWallet(t, ctx, led, a, 5_000_000)

	if _, err := svc.Subscribe(ctx, a, run+"K", 1_000_000); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	walBefore, _ := led.GetBalance(ctx, a)
	unitsBefore := userUnits(t, ctx, pool, a)

	// Redeem with the SAME key → must be refused, never pay out.
	if _, err := svc.Redeem(ctx, a, run+"K", 100); err != ErrIdemConflict {
		t.Fatalf("reused subscribe key on redeem must be ErrIdemConflict, got %v", err)
	}
	if wal, _ := led.GetBalance(ctx, a); wal != walBefore {
		t.Fatalf("idem-conflict redeem moved cash: %d → %d", walBefore, wal)
	}
	if u := userUnits(t, ctx, pool, a); u != unitsBefore {
		t.Fatalf("idem-conflict redeem changed units: %d → %d", unitsBefore, u)
	}
	// And the reverse: reusing a key across a fresh subscribe returns the SAME order.
	o2, err := svc.Subscribe(ctx, a, run+"K", 1_000_000)
	if err != nil || o2 == nil {
		t.Fatalf("subscribe replay should return the original order, got %v", err)
	}
}

// Regression for audit CRITICAL 2: a subscribe replay must return the ORIGINAL
// reserved units even after the fund's clearing balance has grown (P&L) — it must
// NOT recompute NAV against the post-deposit balance and under-mint, and must NOT
// debit the wallet again.
func TestLiveDB_TradingWallet_ReplayPinsUnits(t *testing.T) {
	svc, led, pool := liveFund(t, 2000, 0, true)
	defer pool.Close()
	ctx := context.Background()
	resetFund(t, ctx, pool, led)
	run := uuid.NewString() + ":"
	clearing, _ := led.GetOrCreateStandingAccount(ctx, ledger.AccountTradingFundClearing)
	src, _ := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	a := seedUser(t, ctx, pool)
	fundWallet(t, ctx, led, a, 5_000_000)

	o1, err := svc.Subscribe(ctx, a, run+"K", 1_000_000)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	walAfter1, _ := led.GetBalance(ctx, a)

	// Fund appreciates: clearing +₦8,000 → NAV would jump if recomputed.
	if err := led.PostJournal(ctx, ledger.JournalEntry{Reference: "test:pnl", IdempotencyKey: "test:pnl:" + uuid.NewString(), AmountKobo: 800_000, DebitAccountID: src.ID, CreditAccountID: clearing.ID}); err != nil {
		t.Fatalf("pnl: %v", err)
	}

	o2, err := svc.Subscribe(ctx, a, run+"K", 1_000_000)
	if err != nil {
		t.Fatalf("subscribe replay: %v", err)
	}
	if o2.UnitsDelta != o1.UnitsDelta {
		t.Fatalf("replay recomputed units against post-deposit NAV: first=%d replay=%d", o1.UnitsDelta, o2.UnitsDelta)
	}
	if walAfter2, _ := led.GetBalance(ctx, a); walAfter2 != walAfter1 {
		t.Fatalf("replay double-debited the wallet: %d → %d", walAfter1, walAfter2)
	}
}

func TestLiveDB_TradingWallet_AccessGate(t *testing.T) {
	svc, led, pool := liveFund(t, 2000, 0, false) // gate DENIES access
	defer pool.Close()
	ctx := context.Background()
	resetFund(t, ctx, pool, led)
	u := seedUser(t, ctx, pool)
	fundWallet(t, ctx, led, u, 5_000_000)
	if _, err := svc.Subscribe(ctx, u, "sub:x", 1_000_000); err != ErrNoAccess {
		t.Fatalf("deposit without module-KYC must be refused, got %v", err)
	}
}

// helpers

func assertReconciled(t *testing.T, svc *Service, ctx context.Context) {
	t.Helper()
	r, err := svc.Reconcile(ctx, 2)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if !r.OK {
		t.Fatalf("fund failed reconciliation: %+v", r)
	}
}

func userUnits(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var u int64
	_ = pool.QueryRow(ctx, `SELECT COALESCE(units,0) FROM trading_fund_units WHERE user_id=$1`, userID).Scan(&u)
	return u
}

func unitValue(t *testing.T, ctx context.Context, svc *Service, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	clearing, _ := svc.clearing(ctx)
	nav, _, _, err := svc.currentNAV(ctx, clearing)
	if err != nil {
		t.Fatalf("nav: %v", err)
	}
	return ValueOfUnits(userUnits(t, ctx, pool, userID), nav)
}

func abs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}
