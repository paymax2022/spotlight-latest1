package crypto

// LIVE-DB regression for the F-5 re-audit finding — the cap-boundary leg split.
// The old swap posted TWO wallet debit legs (:buy netCash gated, :spread gated
// wallet→revenue): :buy could commit while :spread refused at the cap, leaving
// the order filled with the spread uncollected. The wallet charge is now ONE
// gated journal for the gross cashKobo (cap evaluated once, atomically), the
// spread is a standing-account escrow→revenue journal that can never be
// cap-refused, and the order/holdings record runs LAST. These tests pin:
//   - a refused swap leaves NO ledger legs, NO order row, NO holdings move;
//   - a partial replay (sell+buy durable, spread missing, order unrecorded)
//     converges to a filled order with every leg present;
//   - a same-key replay never double-posts;
//   - a fresh at-cap attempt still refuses.
// SKIPPED whenever TEST_DATABASE_URL is unset.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/testsupport"
)

// swapRig builds a swap-capable service: the ledger carries the strict in-tx
// debit guard, two mock-priced assets exist (USDT at ₦1,600/whole-unit and BTC
// at ₦90,000,000/whole-unit in the mock provider), and the member holds USDT.
// USDT scale 1_000_000 ⇒ cashKobo = fromUnits × 160_000 / 1_000_000 exactly.
func swapRig(t *testing.T) (context.Context, *Service, *ledger.Service, *pgxpool.Pool, string, *Asset, *Asset) {
	t.Helper()
	ctx := context.Background()
	pool := livePool(t)
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	led.SetDebitGuard(tiers.NewService(pool).EnforceWalletDebitLimitTx)
	svc := NewService(pool, led, NewMockPriceProvider())

	admin := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, admin, admin+"@seed.test"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	testsupport.CleanupUser(t, pool, admin)

	usdt, err := svc.AdminConfigAsset(ctx, admin, "USDT", "Tether USD", 1_000_000, true)
	if err != nil {
		t.Fatalf("config USDT: %v", err)
	}
	btc, err := svc.AdminConfigAsset(ctx, admin, "BTC", "Bitcoin", 100_000_000, true)
	if err != nil {
		t.Fatalf("config BTC: %v", err)
	}

	user := seedLiveUser(t, ctx, pool, led, 1 /*tier-1: ₦50k/day cap*/, 0)
	return ctx, svc, led, pool, user, usdt, btc
}

func seedHoldings(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID, assetID string, units int64) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`INSERT INTO crypto_holdings (user_id, asset_id, units) VALUES ($1,$2,$3)
		 ON CONFLICT (user_id, asset_id) DO UPDATE SET units = crypto_holdings.units + EXCLUDED.units`,
		userID, assetID, units); err != nil {
		t.Fatalf("seed holdings: %v", err)
	}
}

func swapOrders(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM crypto_swap_orders WHERE user_id=$1`, userID).Scan(&n); err != nil {
		t.Fatalf("count swap orders: %v", err)
	}
	return n
}

// 25_000_000 minor units of USDT × ₦1,600 = exactly ₦40,000 = 4_000_000 kobo.
// Spread at 50 bps = 20_000 kobo. Daily debited after the swap = 4_000_000.
func TestLiveDB_Swap_CapBoundary_AllOrNothing(t *testing.T) {
	ctx, svc, led, pool, user, usdt, btc := swapRig(t)
	seedHoldings(t, ctx, pool, user, usdt.ID, 40_000_000)

	escrowAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}

	key := "swap-cap-" + uuid.NewString()
	o, err := svc.Swap(ctx, user, usdt.ID, btc.ID, 25_000_000, key)
	if err != nil {
		t.Fatalf("swap within cap must fill: %v", err)
	}
	if o.Status != "filled" {
		t.Fatalf("swap status = %q, want filled", o.Status)
	}

	// Every leg durable: :sell pair (escrow→wallet), :buy pair (wallet→escrow,
	// GROSS 4_000_000), :spread pair (escrow→revenue, 20_000).
	if n, sum := countLegs(t, ctx, pool, key+":sell:%"); n != 2 || sum != 8_000_000 {
		t.Fatalf("sell leg: want balanced pair of 4_000_000, got %d rows summing %d", n, sum)
	}
	if n, sum := countLegs(t, ctx, pool, key+":buy:%"); n != 2 || sum != 8_000_000 {
		t.Fatalf("buy leg: want ONE balanced pair for the gross 4_000_000, got %d rows summing %d", n, sum)
	}
	if n, sum := countLegs(t, ctx, pool, key+":spread:%"); n != 2 || sum != 40_000 {
		t.Fatalf("spread leg: want balanced pair of 20_000, got %d rows summing %d", n, sum)
	}

	// Wallet net delta is zero — self-funding: sell proceeds covered the debit.
	wallet, err := led.GetOrCreateUserWallet(ctx, user)
	if err != nil {
		t.Fatalf("wallet: %v", err)
	}
	bal, err := led.GetBalance(ctx, user)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal != 0 {
		t.Fatalf("unfunded swap must leave wallet at 0, got %d", bal)
	}
	var revBal int64
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(CASE WHEN type='CREDIT' THEN amount_kobo ELSE -amount_kobo END),0)
		 FROM ledger_entries WHERE account_id=$1`, revAcc.ID).Scan(&revBal); err != nil {
		t.Fatalf("revenue balance: %v", err)
	}
	var spreadCredits int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM ledger_entries WHERE account_id=$1 AND idempotency_key=$2`,
		revAcc.ID, key+":spread:credit").Scan(&spreadCredits); err != nil {
		t.Fatalf("spread leg: %v", err)
	}
	if spreadCredits != 1 {
		t.Fatal("revenue must collect exactly one spread credit")
	}
	_ = escrowAcc
	_ = wallet

	// A same-key replay converges to the same order and posts nothing twice.
	o2, err := svc.Swap(ctx, user, usdt.ID, btc.ID, 25_000_000, key)
	if err != nil {
		t.Fatalf("replay must converge: %v", err)
	}
	if o2.ID != o.ID {
		t.Fatalf("replay must return the same order, got %s vs %s", o2.ID, o.ID)
	}
	if n, _ := countLegs(t, ctx, pool, key+":%"); n != 6 {
		t.Fatalf("replay must not add legs — want 6 total, got %d", n)
	}

	// FRESH swap at-cap: 4_000_000 used of 5_000_000; another ₦40k pushes over.
	// Must refuse with ZERO new legs, NO second order, holdings untouched.
	key2 := "swap-cap-" + uuid.NewString()
	_, err = svc.Swap(ctx, user, usdt.ID, btc.ID, 15_000_000, key2) // ₦24k > ₦10k remaining
	if err == nil {
		t.Fatal("a second swap over the daily cap must refuse")
	}
	if !errors.Is(err, tiers.ErrDailyLimitExceeded) {
		t.Fatalf("want ErrDailyLimitExceeded, got %v", err)
	}
	if n, _ := countLegs(t, ctx, pool, key2+":%"); n != 0 {
		t.Fatalf("refused swap must post ZERO legs, got %d", n)
	}
	if swapOrders(t, ctx, pool, user) != 1 {
		t.Fatal("refused swap must not record an order")
	}
}

// The audit's exact wedge: :buy committed, the run died before :spread and
// before the order recorded. The retry must heal — post the missing spread,
// record the order, converge filled — never re-charge or refuse at-cap.
func TestLiveDB_Swap_PartialLegs_ReplayHeals(t *testing.T) {
	ctx, svc, led, pool, user, usdt, btc := swapRig(t)
	seedHoldings(t, ctx, pool, user, usdt.ID, 40_000_000)

	escrowAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	wallet, err := led.GetOrCreateUserWallet(ctx, user)
	if err != nil {
		t.Fatalf("wallet: %v", err)
	}

	key := "swap-heal-" + uuid.NewString()
	ref := "crypto:swap:USDT->BTC"
	// Simulate the crash window: :sell + :buy journals durable, nothing else.
	if err := led.Credit(ctx, user, ref+":sell", key+":sell", escrowAcc.ID, 4_000_000); err != nil {
		t.Fatalf("plant sell leg: %v", err)
	}
	if err := led.PostJournalGated(ctx, ledger.JournalEntry{
		Reference: ref + ":buy", IdempotencyKey: key + ":buy",
		AmountKobo: 4_000_000, DebitAccountID: wallet.ID, CreditAccountID: escrowAcc.ID,
	}, user); err != nil {
		t.Fatalf("plant buy leg: %v", err)
	}

	o, err := svc.Swap(ctx, user, usdt.ID, btc.ID, 25_000_000, key)
	if err != nil {
		t.Fatalf("partial replay must heal, got %v", err)
	}
	if o.Status != "filled" {
		t.Fatalf("healed swap status = %q, want filled", o.Status)
	}
	// Exactly one pair per leg — no double-post on the pre-existing journals.
	if n, _ := countLegs(t, ctx, pool, key+":%"); n != 6 {
		t.Fatalf("healed swap must hold exactly 6 legs, got %d", n)
	}
	if n, sum := countLegs(t, ctx, pool, key+":spread:%"); n != 2 || sum != 40_000 {
		t.Fatalf("healed swap must post the missing spread pair, got %d rows summing %d", n, sum)
	}
	if swapOrders(t, ctx, pool, user) != 1 {
		t.Fatal("healed swap must record exactly one order")
	}
}

// R-1: a non-duplicate :buy failure must unwind the committed :sell credit
// under the wallet advisory lock AND tombstone the key — the stale :sell legs
// can never re-verify and drive a fresh :buy with no proceeds to offset it.
// The forced in-tx refusal simulates any non-dup buy failure (guard refusal,
// transient post error); the pooled gate passes first so the :sell leg really
// commits before the refusal.
func TestLiveDB_Swap_BuyRefused_UnwindsSell_TombstonesKey(t *testing.T) {
	ctx, svc, led, pool, user, usdt, btc := swapRig(t)
	seedHoldings(t, ctx, pool, user, usdt.ID, 40_000_000)

	forced := errors.New("test: forced in-tx buy refusal")
	led.SetDebitGuard(func(context.Context, pgx.Tx, string, int64) error { return forced })

	key := "swap-unwind-" + uuid.NewString()
	if _, err := svc.Swap(ctx, user, usdt.ID, btc.ID, 25_000_000, key); !errors.Is(err, forced) {
		t.Fatalf("want forced refusal, got %v", err)
	}

	// The :sell pair is durable (reversals never delete legs), the :buy pair
	// never landed, and the unwind reversal pair IS durable — the tombstone.
	if n, sum := countLegs(t, ctx, pool, key+":sell:%"); n != 2 || sum != 8_000_000 {
		t.Fatalf("sell legs: want balanced pair of 4_000_000, got %d rows summing %d", n, sum)
	}
	if n, _ := countLegs(t, ctx, pool, key+":buy:%"); n != 0 {
		t.Fatalf("refused buy must post ZERO legs, got %d", n)
	}
	if n, _ := countLegs(t, ctx, pool, key+":unwind:sell:%"); n != 2 {
		t.Fatalf("unwind reversal pair must be durable, got %d rows", n)
	}

	// Wallet net delta is zero: +cashKobo sell credit, −cashKobo unwind.
	if bal, err := led.GetBalance(ctx, user); err != nil || bal != 0 {
		t.Fatalf("unwound swap must leave wallet at 0, got %d err=%v", bal, err)
	}
	// No order, holdings untouched — the swap never filled.
	if swapOrders(t, ctx, pool, user) != 0 {
		t.Fatal("refused+unwound swap must not record an order")
	}
	if held, err := svc.repo.HoldingUnits(ctx, user, usdt.ID); err != nil || held != 40_000_000 {
		t.Fatalf("from-holdings must be untouched, got %d err=%v", held, err)
	}

	// THE tombstone: a same-key retry must refuse PERMANENTLY — without it the
	// stale :sell legs would re-verify and a fresh :buy would debit the gross
	// amount with no proceeds to offset (double charge). Early probe refusal
	// here; the in-tx guard covers the concurrent-interleave case.
	if _, err := svc.Swap(ctx, user, usdt.ID, btc.ID, 25_000_000, key); !errors.Is(err, ErrSwapUnwound) {
		t.Fatalf("post-unwind replay must refuse ErrSwapUnwound, got %v", err)
	}
	if n, _ := countLegs(t, ctx, pool, key+":%"); n != 4 {
		t.Fatalf("post-unwind replay must add ZERO legs — want 4 total (sell+unwind), got %d", n)
	}
	if swapOrders(t, ctx, pool, user) != 0 {
		t.Fatal("post-unwind replay must not record an order")
	}
}

// R-1 (ambiguous commit): when the :buy journal turns out durable after all,
// unwindSwapSell must NO-OP — the same-key retry converges on the fill, never
// unwinds a debit that actually landed.
func TestLiveDB_Swap_UnwindNoOp_WhenBuyCommitted(t *testing.T) {
	ctx, svc, led, pool, user, usdt, _ := swapRig(t)
	seedHoldings(t, ctx, pool, user, usdt.ID, 40_000_000)

	escrowAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	wallet, err := led.GetOrCreateUserWallet(ctx, user)
	if err != nil {
		t.Fatalf("wallet: %v", err)
	}

	key := "swap-ambig-" + uuid.NewString()
	ref := "crypto:swap:USDT->BTC"
	// Plant BOTH cash journals durable — the ambiguous-commit shape a retried
	// unwind could see when the original PostJournalWithGuard actually landed.
	if err := led.Credit(ctx, user, ref+":sell", key+":sell", escrowAcc.ID, 4_000_000); err != nil {
		t.Fatalf("plant sell leg: %v", err)
	}
	if err := led.PostJournalGated(ctx, ledger.JournalEntry{
		Reference: ref + ":buy", IdempotencyKey: key + ":buy",
		AmountKobo: 4_000_000, DebitAccountID: wallet.ID, CreditAccountID: escrowAcc.ID,
	}, user); err != nil {
		t.Fatalf("plant buy leg: %v", err)
	}

	if err := svc.unwindSwapSell(ctx, user, key, ref+":sell", wallet.ID, escrowAcc.ID, 4_000_000); err != nil {
		t.Fatalf("unwind over a committed buy must no-op, got %v", err)
	}
	if n, _ := countLegs(t, ctx, pool, key+":unwind:sell:%"); n != 0 {
		t.Fatalf("ambiguous-commit unwind must post ZERO reversal legs, got %d", n)
	}
	// Wallet still holds the +sell −buy = 0 self-funded delta — nothing drained.
	if bal, err := led.GetBalance(ctx, user); err != nil || bal != 0 {
		t.Fatalf("no-op unwind must not touch the wallet, got balance %d err=%v", bal, err)
	}
}
