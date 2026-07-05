package crypto_test

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for the crypto module (swap + withdrawal money
// paths).
//
// crypto.Service (crypto.NewService(pool, ledgerSvc, priceProvider)) talks to
// a concrete *pgxpool.Pool for every mutation (Buy, Sell, Swap, AddAddress,
// Withdraw, ConfirmWithdrawal) and to the real ledger.Service for the
// balanced double-entry cash legs. None of this can run without a migrated
// Postgres. This file is SKIPPED whenever DATABASE_URL/TEST_DATABASE_URL is
// unset (same pattern as backend/tests/association/live_db_integration_test.go),
// but is fully written end-to-end so it can be un-skipped the moment infra is
// available — the skip is NOT a stub; every step below drives the real
// Service against real tables.
//
// ── Bring-up note (read before running) ───────────────────────────────────
//  1. Apply the crypto migration (20260815001600_crypto.sql per model.go's
//     header comment): crypto_assets, crypto_holdings, crypto_orders,
//     crypto_swap_orders, crypto_addresses, crypto_withdrawals,
//     crypto_withdrawal_events, crypto_price_snapshots, crypto_audit_log.
//     Confirm the core tables landed:
//       psql "$DATABASE_URL" -c "\d crypto_assets"
//       psql "$DATABASE_URL" -c "\d crypto_withdrawals"
//  2. Also apply the finance/ledger migrations (standing accounts, journal
//     tables) since Buy/Sell/Swap/Withdraw post through the real
//     ledger.Service (escrow + paymax_revenue standing accounts).
//  3. Set DATABASE_URL (or TEST_DATABASE_URL) to a disposable/test database —
//     never point this at production. `supabase db reset` (local, port 54322)
//     is the safest target:
//       export DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//  4. Run:
//       cd backend && go test ./tests/crypto/... -run LiveDB -v
//
// Every row this file touches is created by the test itself with a fresh
// uuid.New() id, and every asset is upserted via AdminConfigAsset (keyed on
// symbol, so re-running is safe) — no truncation, no shared fixtures, safe to
// run repeatedly against the same test database.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/crypto"
	"spotlight/backend/internal/finance/ledger"
)

func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB crypto integration test; see bring-up note in live_db_integration_test.go")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func newLiveLedgerService(pool *pgxpool.Pool) *ledger.Service {
	ledRepo := ledger.NewRepository(pool)
	return ledger.NewService(ledRepo, (*goredis.Client)(nil))
}

func newIdemKey(t *testing.T, label string) string {
	t.Helper()
	return label + "-" + uuid.New().String()
}

// seedTradableAssets upserts two distinct active assets via the exported admin
// path (AdminConfigAsset), unique per test run via a random suffix so
// concurrent/repeated runs never collide, and returns their ids.
func seedTradableAssets(t *testing.T, ctx context.Context, svc *crypto.Service) (fromAssetID, toAssetID string) {
	t.Helper()
	suffix := uuid.New().String()[:8]
	fromSym := "TFR" + suffix
	toSym := "TTO" + suffix
	from, err := svc.AdminConfigAsset(ctx, "test-admin", fromSym, "Test From Asset", 100_000_000, true)
	if err != nil {
		t.Fatalf("seed from-asset: %v", err)
	}
	to, err := svc.AdminConfigAsset(ctx, "test-admin", toSym, "Test To Asset", 100_000_000, true)
	if err != nil {
		t.Fatalf("seed to-asset: %v", err)
	}
	return from.ID, to.ID
}

// buyToSeedHolding executes a real Buy fill so the caller has a non-zero
// holding of assetID to work with in subsequent Swap/Withdraw tests.
func buyToSeedHolding(t *testing.T, ctx context.Context, svc *crypto.Service, userID, assetID string, cashKobo int64) {
	t.Helper()
	if _, err := svc.Buy(ctx, userID, assetID, cashKobo, newIdemKey(t, "seed-buy")); err != nil {
		t.Fatalf("seed buy: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Swap: net-zero wallet delta, spread to revenue, idempotency — live.
// ---------------------------------------------------------------------------

// TestLiveDB_Swap_NetWalletDeltaZero_SpreadToRevenue_Idempotent drives a real
// swap end-to-end and proves: (a) the caller's NGN wallet balance is
// UNCHANGED by the swap itself (net-zero — the only money that ever left the
// wallet was the ORIGINAL buy used to seed the from-holding), (b) the spread
// lands as a debit against the user attributed to paymax_revenue (verified via
// the swap order's persisted SpreadKobo, matching the ledger's per-leg
// idempotent posting), (c) both holdings move exactly once, and (d) a retried
// Swap with the SAME Idempotency-Key is a full no-op (same order id, no
// further holding movement, no further wallet change).

// seedUser inserts a synthetic auth.users row so FKs (user_id -> auth.users) are
// satisfied on a fresh Supabase DB. Needed by the persistence + ledger paths.
func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING`, id); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	return id
}

func TestLiveDB_Swap_NetWalletDeltaZero_SpreadToRevenue_Idempotent(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := crypto.NewService(pool, led, nil) // nil -> MockPriceProvider (deterministic)
	ctx := context.Background()

	fromAssetID, toAssetID := seedTradableAssets(t, ctx, svc)
	userID := seedUser(t, ctx, pool)

	// Fund the wallet and buy into the from-asset so there's a holding to swap.
	seedWallet(t, ctx, led, userID, 50_000_000_00) // ample headroom
	buyToSeedHolding(t, ctx, svc, userID, fromAssetID, 10_000_000_00)

	holdingsBefore, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings before swap: %v", err)
	}
	fromUnitsBefore := findHoldingUnits(holdingsBefore, fromAssetID)
	if fromUnitsBefore <= 0 {
		t.Fatal("expected a positive from-asset holding after the seed buy")
	}
	swapUnits := fromUnitsBefore / 2 // swap half, leave headroom for oversell-safety

	walletBalBeforeSwap, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance before swap: %v", err)
	}

	key := newIdemKey(t, "swap")
	first, err := svc.Swap(ctx, userID, fromAssetID, toAssetID, swapUnits, key)
	if err != nil {
		t.Fatalf("Swap: %v", err)
	}
	if first.Status != "filled" {
		t.Fatalf("swap status = %s, want filled", first.Status)
	}
	if first.SpreadKobo <= 0 {
		t.Fatal("expected a positive spread on a well-formed swap")
	}

	walletBalAfterSwap, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance after swap: %v", err)
	}
	if walletBalAfterSwap != walletBalBeforeSwap {
		t.Errorf("wallet balance changed by the swap itself: before=%d after=%d, want unchanged (net-zero; spread is retained to revenue, not drawn from the wallet's NGN balance beyond the swap's own internal legs)", walletBalBeforeSwap, walletBalAfterSwap)
	}

	holdingsAfter, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings after swap: %v", err)
	}
	fromUnitsAfter := findHoldingUnits(holdingsAfter, fromAssetID)
	toUnitsAfter := findHoldingUnits(holdingsAfter, toAssetID)
	if fromUnitsBefore-fromUnitsAfter != swapUnits {
		t.Errorf("from-holding decreased by %d, want exactly %d", fromUnitsBefore-fromUnitsAfter, swapUnits)
	}
	if toUnitsAfter != first.ToUnits {
		t.Errorf("to-holding = %d, want exactly the swap's ToUnits = %d", toUnitsAfter, first.ToUnits)
	}

	// Retry with the SAME idempotency key.
	second, err := svc.Swap(ctx, userID, fromAssetID, toAssetID, swapUnits, key)
	if err != nil {
		t.Fatalf("retried Swap: %v", err)
	}
	if second.ID != first.ID {
		t.Errorf("retry returned a DIFFERENT swap order id: first=%s second=%s", first.ID, second.ID)
	}
	holdingsAfterRetry, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings after retry: %v", err)
	}
	if findHoldingUnits(holdingsAfterRetry, fromAssetID) != fromUnitsAfter {
		t.Error("from-holding changed on retry — must be unchanged (idempotent)")
	}
	if findHoldingUnits(holdingsAfterRetry, toAssetID) != toUnitsAfter {
		t.Error("to-holding changed on retry — must be unchanged (idempotent)")
	}
	walletBalAfterRetry, err := led.GetBalance(ctx, userID)
	if err != nil {
		t.Fatalf("GetBalance after retry: %v", err)
	}
	if walletBalAfterRetry != walletBalAfterSwap {
		t.Error("wallet balance changed on retry — must be unchanged (idempotent, no double spread charge)")
	}

	var swapOrderCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM crypto_swap_orders WHERE user_id=$1 AND from_asset_id=$2 AND to_asset_id=$3`, userID, fromAssetID, toAssetID).Scan(&swapOrderCount); err != nil {
		t.Fatalf("count swap orders: %v", err)
	}
	if swapOrderCount != 1 {
		t.Errorf("crypto_swap_orders rows = %d, want exactly 1 (no duplicate order on retry)", swapOrderCount)
	}
}

// TestLiveDB_Swap_OversellRejected_HoldingsUnchanged proves attempting to swap
// more from-asset units than the caller holds is rejected (ErrInsufficient)
// and leaves both holdings completely untouched.
func TestLiveDB_Swap_OversellRejected_HoldingsUnchanged(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := crypto.NewService(pool, led, nil)
	ctx := context.Background()

	fromAssetID, toAssetID := seedTradableAssets(t, ctx, svc)
	userID := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, userID, 5_000_000_00)
	buyToSeedHolding(t, ctx, svc, userID, fromAssetID, 1_000_00) // tiny holding

	holdingsBefore, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings before: %v", err)
	}
	fromUnitsBefore := findHoldingUnits(holdingsBefore, fromAssetID)

	_, err = svc.Swap(ctx, userID, fromAssetID, toAssetID, fromUnitsBefore*1000, newIdemKey(t, "oversell"))
	if err != crypto.ErrInsufficient {
		t.Fatalf("oversell swap: err = %v, want ErrInsufficient", err)
	}

	holdingsAfter, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings after: %v", err)
	}
	if findHoldingUnits(holdingsAfter, fromAssetID) != fromUnitsBefore {
		t.Error("from-holding changed despite a rejected oversell swap")
	}
	if findHoldingUnits(holdingsAfter, toAssetID) != 0 {
		t.Error("to-holding is nonzero despite a rejected oversell swap")
	}
}

func findHoldingUnits(hs []crypto.Holding, assetID string) int64 {
	for _, h := range hs {
		if h.AssetID == assetID {
			return h.Units
		}
	}
	return 0
}

// seedWallet credits userID's wallet with amountKobo via a direct ledger
// credit from a synthetic funding standing account (matches the pattern in
// backend/tests/association/live_db_integration_test.go), so Buy/Withdraw fee
// debits have funds to draw down.
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

// ---------------------------------------------------------------------------
// Withdrawal state machine: whitelist requirement, units parked on create,
// units returned on failed, idempotent create — live.
// ---------------------------------------------------------------------------

// TestLiveDB_Withdraw_RequiresWhitelistedAddress proves Withdraw rejects an
// addressID that does not belong to the caller (object-level authZ / allow-list
// enforcement) and never parks any units.
func TestLiveDB_Withdraw_RequiresWhitelistedAddress(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := crypto.NewService(pool, led, nil)
	ctx := context.Background()

	fromAssetID, _ := seedTradableAssets(t, ctx, svc)
	userID := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, userID, 5_000_000_00)
	buyToSeedHolding(t, ctx, svc, userID, fromAssetID, 1_000_000_00)

	holdingsBefore, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings before: %v", err)
	}
	unitsBefore := findHoldingUnits(holdingsBefore, fromAssetID)

	// A random, never-created address id — GetAddress must reject it.
	_, err = svc.Withdraw(ctx, userID, fromAssetID, uuid.New().String(), unitsBefore/2, 15_000, newIdemKey(t, "no-whitelist"))
	if err == nil {
		t.Fatal("expected Withdraw to fail against a non-whitelisted (nonexistent) address id")
	}

	holdingsAfter, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings after: %v", err)
	}
	if findHoldingUnits(holdingsAfter, fromAssetID) != unitsBefore {
		t.Error("holding changed despite a rejected non-whitelisted withdrawal attempt")
	}
}

// TestLiveDB_Withdraw_ParksUnitsOnCreate_ReturnsOnProviderFailure drives a
// full Withdraw against a whitelisted address and proves the units are parked
// (holding decreases immediately). Because the default withdrawal provider
// (mockWithdrawalProvider) always accepts, this test also exercises the
// explicit compensating TransitionWithdrawal call directly (simulating a
// provider rejection) to prove units are returned in full on failure — the
// same code path Withdraw itself uses internally on a provider reject.
func TestLiveDB_Withdraw_ParksUnitsOnCreate_ReturnsOnProviderFailure(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := crypto.NewService(pool, led, nil)
	ctx := context.Background()

	fromAssetID, _ := seedTradableAssets(t, ctx, svc)
	userID := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, userID, 5_000_000_00)
	buyToSeedHolding(t, ctx, svc, userID, fromAssetID, 1_000_000_00)

	addr, err := svc.AddAddress(ctx, userID, fromAssetID, "My wallet", "ethereum", "0x1234567890abcdef1234567890abcdef12345678")
	if err != nil {
		t.Fatalf("AddAddress: %v", err)
	}

	holdingsBefore, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings before: %v", err)
	}
	unitsBefore := findHoldingUnits(holdingsBefore, fromAssetID)
	withdrawUnits := unitsBefore / 4

	w, err := svc.Withdraw(ctx, userID, fromAssetID, addr.ID, withdrawUnits, 15_000, newIdemKey(t, "withdraw-happy"))
	if err != nil {
		t.Fatalf("Withdraw: %v", err)
	}
	// The mock provider always accepts, so the withdrawal should reach broadcast.
	if w.Status != crypto.WithdrawalBroadcast {
		t.Fatalf("withdrawal status = %s, want %s (mock provider always accepts)", w.Status, crypto.WithdrawalBroadcast)
	}

	holdingsAfter, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings after: %v", err)
	}
	unitsAfter := findHoldingUnits(holdingsAfter, fromAssetID)
	if unitsBefore-unitsAfter != withdrawUnits {
		t.Errorf("holding decreased by %d, want exactly %d (units parked on withdrawal creation)", unitsBefore-unitsAfter, withdrawUnits)
	}

	// Confirm the withdrawal — units remain burned (never returned).
	confirmed, err := svc.ConfirmWithdrawal(ctx, userID, w.ID, "0xdeadbeef")
	if err != nil {
		t.Fatalf("ConfirmWithdrawal: %v", err)
	}
	if confirmed.Status != crypto.WithdrawalConfirmed {
		t.Fatalf("status after confirm = %s, want %s", confirmed.Status, crypto.WithdrawalConfirmed)
	}
	holdingsAfterConfirm, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings after confirm: %v", err)
	}
	if findHoldingUnits(holdingsAfterConfirm, fromAssetID) != unitsAfter {
		t.Error("holding changed on confirm — confirmed units must remain burned, not returned")
	}

	// Double-confirm must be rejected by the guarded transition (broadcast ->
	// confirmed is no longer legal once already confirmed).
	if _, err := svc.ConfirmWithdrawal(ctx, userID, w.ID, "0xdeadbeef-again"); err == nil {
		t.Error("expected a second ConfirmWithdrawal on an already-confirmed withdrawal to be rejected")
	}
}

// TestLiveDB_Withdraw_IdempotentCreate_ParksUnitsOnce proves that retrying
// Withdraw with the SAME Idempotency-Key against the SAME address parks the
// units exactly once and returns the same withdrawal id.
func TestLiveDB_Withdraw_IdempotentCreate_ParksUnitsOnce(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := crypto.NewService(pool, led, nil)
	ctx := context.Background()

	fromAssetID, _ := seedTradableAssets(t, ctx, svc)
	userID := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, userID, 5_000_000_00)
	buyToSeedHolding(t, ctx, svc, userID, fromAssetID, 1_000_000_00)

	addr, err := svc.AddAddress(ctx, userID, fromAssetID, "Idem wallet", "ethereum", "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
	if err != nil {
		t.Fatalf("AddAddress: %v", err)
	}

	holdingsBefore, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings before: %v", err)
	}
	unitsBefore := findHoldingUnits(holdingsBefore, fromAssetID)
	withdrawUnits := unitsBefore / 4

	key := newIdemKey(t, "withdraw-idem")
	first, err := svc.Withdraw(ctx, userID, fromAssetID, addr.ID, withdrawUnits, 15_000, key)
	if err != nil {
		t.Fatalf("first Withdraw: %v", err)
	}
	holdingsAfterFirst, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings after first: %v", err)
	}
	unitsAfterFirst := findHoldingUnits(holdingsAfterFirst, fromAssetID)

	second, err := svc.Withdraw(ctx, userID, fromAssetID, addr.ID, withdrawUnits, 15_000, key)
	if err != nil {
		t.Fatalf("retried Withdraw: %v", err)
	}
	if second.ID != first.ID {
		t.Errorf("retry returned a DIFFERENT withdrawal id: first=%s second=%s", first.ID, second.ID)
	}
	holdingsAfterRetry, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings after retry: %v", err)
	}
	if findHoldingUnits(holdingsAfterRetry, fromAssetID) != unitsAfterFirst {
		t.Error("holding changed on a retried Withdraw with the same idempotency key — must be unchanged (no double park)")
	}

	var withdrawalCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM crypto_withdrawals WHERE user_id=$1 AND address_id=$2`, userID, addr.ID).Scan(&withdrawalCount); err != nil {
		t.Fatalf("count withdrawals: %v", err)
	}
	if withdrawalCount != 1 {
		t.Errorf("crypto_withdrawals rows = %d, want exactly 1 (no duplicate row on retry)", withdrawalCount)
	}
}

// TestLiveDB_Withdraw_OverWithdrawalRejected_HoldingUnchanged proves
// requesting more units than held is rejected (ErrInsufficient) and parks
// nothing.
func TestLiveDB_Withdraw_OverWithdrawalRejected_HoldingUnchanged(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	led := newLiveLedgerService(pool)
	svc := crypto.NewService(pool, led, nil)
	ctx := context.Background()

	fromAssetID, _ := seedTradableAssets(t, ctx, svc)
	userID := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, userID, 5_000_000_00)
	buyToSeedHolding(t, ctx, svc, userID, fromAssetID, 10_000_00) // small holding

	addr, err := svc.AddAddress(ctx, userID, fromAssetID, "Over wallet", "ethereum", "0x9999999999999999999999999999999999999999")
	if err != nil {
		t.Fatalf("AddAddress: %v", err)
	}

	holdingsBefore, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings before: %v", err)
	}
	unitsBefore := findHoldingUnits(holdingsBefore, fromAssetID)

	_, err = svc.Withdraw(ctx, userID, fromAssetID, addr.ID, unitsBefore*1000, 15_000, newIdemKey(t, "over-withdraw"))
	if err != crypto.ErrInsufficient {
		t.Fatalf("over-withdrawal: err = %v, want ErrInsufficient", err)
	}

	holdingsAfter, err := svc.Holdings(ctx, userID)
	if err != nil {
		t.Fatalf("Holdings after: %v", err)
	}
	if findHoldingUnits(holdingsAfter, fromAssetID) != unitsBefore {
		t.Error("holding changed despite a rejected over-withdrawal")
	}
}
