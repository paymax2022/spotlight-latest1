package fx_test

// ---------------------------------------------------------------------------
// LIVE-DB suite for the UNIFIED NGN wallet (ADR-051).
//
// Before this, FX kept a private NGN pot in orch_balances. That table has no
// production writer other than a conversion's own destination leg, so every real
// user saw ₦0 on /fx while the rest of the app read their true balance out of
// ledger_entries — and a first conversion could never be started, because the
// only way to get NGN into the FX pot was to have already converted into it.
//
// The rule these tests pin: for NGN there is exactly ONE pot — the platform's
// main ledger (ledger_accounts/ledger_entries). FX reads it, spends it, and pays
// into it. orch_balances holds the non-NGN currencies only. Anything that shows
// a balance the user cannot actually spend, or spends money the balance did not
// show, is the bug class here.
//
// SKIPPED whenever TEST_DATABASE_URL is unset (reuses liveDBPool/seedUser/
// seedWallet from convert_live_db_test.go).
//
//   export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/fx/... -run OrchNGN -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/orchestration"
)

// livePool is liveDBPool with the close registered as a CLEANUP rather than a
// defer. `defer pool.Close()` returns before t.Cleanup callbacks run, so every
// cleanup that used the pool was silently closing over a dead handle and the
// rows it meant to delete stayed behind — which is why the fixtures pile up.
// Registering the close FIRST puts it last in cleanup's LIFO order.
func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	return pool
}

// mainWalletBalance projects the user's NGN wallet straight from the immutable
// main ledger — deliberately NOT through the code under test, so a bug in the
// router cannot make its own assertion pass.
func mainWalletBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var bal int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN e.type IN ('CREDIT','REVERSAL_DEBIT') THEN e.amount_kobo
		                         ELSE -e.amount_kobo END), 0)
		FROM ledger_accounts a
		LEFT JOIN ledger_entries e ON e.account_id = a.id
		WHERE a.user_id=$1 AND a.type='user_wallet'`, userID).Scan(&bal)
	if err != nil {
		t.Fatalf("project main wallet balance: %v", err)
	}
	return bal
}

// orchPotRow reports the orch_balances row for a currency (-1 when absent), so a
// test can assert that NGN never grows a second pot behind the main ledger.
func orchPotRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, customer, currency string) int64 {
	t.Helper()
	var bal int64
	err := pool.QueryRow(ctx, `SELECT balance_minor FROM orch_balances WHERE customer_id=$1 AND currency=$2`, customer, currency).Scan(&bal)
	if err != nil {
		return -1
	}
	return bal
}

func balanceOf(list []orchestration.Money, currency string) (int64, bool) {
	for _, m := range list {
		if m.Currency == currency {
			return m.AmountMinor, true
		}
	}
	return 0, false
}

// cleanupOrch drops the rows a test wrote that seedUser's cleanup does not cover.
func cleanupOrch(t *testing.T, pool *pgxpool.Pool, customer string) {
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM orch_conversions WHERE customer_id=$1`, customer)
		_, _ = pool.Exec(ctx, `DELETE FROM orch_transfers WHERE customer_id=$1`, customer)
		_, _ = pool.Exec(ctx, `DELETE FROM orch_ledger_entries WHERE customer_id=$1`, customer)
		_, _ = pool.Exec(ctx, `DELETE FROM orch_balances WHERE customer_id=$1`, customer)
	})
}

// ── 1. Reads ────────────────────────────────────────────────────────────────

// The headline defect: /fx showed ₦0 for a user whose wallet held real money.
func TestLiveDB_OrchNGN_BalancesReportTheMainWallet(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)
	seedWallet(t, ctx, newLiveLedger(pool), user, 40_000_00)

	store := orchestration.NewSQLStore(pool)

	got, err := store.Balance(ctx, user, "NGN")
	if err != nil {
		t.Fatalf("Balance NGN: %v", err)
	}
	if got != 40_000_00 {
		t.Errorf("FX NGN balance: got %d want %d (the wallet the rest of the app shows)", got, 40_000_00)
	}

	list, err := store.Balances(ctx, user)
	if err != nil {
		t.Fatalf("Balances: %v", err)
	}
	ngn, ok := balanceOf(list, "NGN")
	if !ok {
		t.Fatalf("Balances omitted NGN entirely: %+v", list)
	}
	if ngn != 40_000_00 {
		t.Errorf("Balances NGN: got %d want %d", ngn, 40_000_00)
	}
}

// A user who has never used FX must still get an NGN wallet card (at zero) so the
// screen can render a funding CTA rather than an empty list.
func TestLiveDB_OrchNGN_BalancesIncludeZeroNGNWallet(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)

	list, err := orchestration.NewSQLStore(pool).Balances(ctx, user)
	if err != nil {
		t.Fatalf("Balances: %v", err)
	}
	ngn, ok := balanceOf(list, "NGN")
	if !ok {
		t.Fatalf("Balances omitted the NGN wallet for a new user: %+v", list)
	}
	if ngn != 0 {
		t.Errorf("new user NGN balance: got %d want 0", ngn)
	}
}

// ── 2. Opening a wallet ─────────────────────────────────────────────────────

// "Add currency wallet" used to return a fabricated {available:0} and persist
// nothing, so the wallet vanished on the next refetch.
func TestLiveDB_OrchNGN_OpenWalletPersistsTheCurrency(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)
	store := orchestration.NewSQLStore(pool)

	if err := store.OpenWallet(ctx, user, "USD"); err != nil {
		t.Fatalf("OpenWallet USD: %v", err)
	}

	list, err := store.Balances(ctx, user)
	if err != nil {
		t.Fatalf("Balances: %v", err)
	}
	usd, ok := balanceOf(list, "USD")
	if !ok {
		t.Fatalf("opened USD wallet did not survive the refetch: %+v", list)
	}
	if usd != 0 {
		t.Errorf("freshly opened USD wallet: got %d want 0", usd)
	}

	// Re-opening is a no-op, never a reset or a duplicate row.
	if err := store.OpenWallet(ctx, user, "USD"); err != nil {
		t.Fatalf("OpenWallet USD (repeat): %v", err)
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM orch_balances WHERE customer_id=$1 AND currency='USD'`, user).Scan(&rows); err != nil {
		t.Fatalf("count USD rows: %v", err)
	}
	if rows != 1 {
		t.Errorf("USD pot rows: got %d want 1", rows)
	}
}

// NGN is not an orch_balances currency — opening it must not create a second pot
// that would then disagree with the main ledger.
func TestLiveDB_OrchNGN_OpenWalletNeverCreatesASecondNGNPot(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)

	if err := orchestration.NewSQLStore(pool).OpenWallet(ctx, user, "NGN"); err != nil {
		t.Fatalf("OpenWallet NGN: %v", err)
	}
	if got := orchPotRow(t, ctx, pool, user, "NGN"); got != -1 {
		t.Errorf("orch_balances grew an NGN row (%d) — NGN must live only in the main ledger", got)
	}
}

// ── 3. Spending ─────────────────────────────────────────────────────────────

func ngnConversion(cust string, sourceMinor, destMinor, spread int64) *orchestration.Conversion {
	return &orchestration.Conversion{
		ID: "cv_" + uuid.NewString(), Reference: "PMX-CV-NGN1", CustomerID: cust,
		Status:      orchestration.ConvSettled,
		Source:      orchestration.NewMoney(sourceMinor, "NGN"),
		Destination: orchestration.NewMoney(destMinor, "USD"),
		Rate:        0.00065, AllInRate: 0.00065,
		Fees: []orchestration.Fee{
			{Type: orchestration.FeeSpread, Amount: orchestration.NewMoney(spread, "NGN")},
		},
		Route:          orchestration.Route{Provider: "maplerad", Corridor: "NGN-USD", Rail: orchestration.RailBankTransfer},
		TransactionID:  "tx_" + uuid.NewString(),
		IdempotencyKey: "orch-ngn-conv-" + uuid.NewString(), CreatedAt: time.Now(),
	}
}

// Converting out of NGN must draw down the SAME money the balance showed.
func TestLiveDB_OrchNGN_ConversionDebitsTheMainWallet(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)
	seedWallet(t, ctx, newLiveLedger(pool), user, 500_000_00)

	store := orchestration.NewSQLStore(pool)
	const sourceTotal = 100_000_00
	conv := ngnConversion(user, sourceTotal, 65_00, 100)

	if err := store.ApplyConversion(ctx, conv, sourceTotal); err != nil {
		t.Fatalf("apply NGN→USD conversion: %v", err)
	}

	if got, want := mainWalletBalance(t, ctx, pool, user), int64(500_000_00-sourceTotal); got != want {
		t.Errorf("main wallet after conversion: got %d want %d", got, want)
	}
	if got := orchPotRow(t, ctx, pool, user, "NGN"); got != -1 {
		t.Errorf("conversion wrote an NGN orch_balances row (%d) — the NGN debit must land in the main ledger", got)
	}
	if got := orchPotRow(t, ctx, pool, user, "USD"); got != 65_00 {
		t.Errorf("USD pot after conversion: got %d want %d", got, 65_00)
	}

	// The main-ledger movement is a balanced pair, not a bare debit.
	var debits, credits int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'), 0),
		       COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'), 0)
		FROM ledger_entries WHERE idempotency_key LIKE $1`, "fx:"+conv.IdempotencyKey+"%").Scan(&debits, &credits); err != nil {
		t.Fatalf("roll up main-ledger legs: %v", err)
	}
	if debits != sourceTotal || credits != sourceTotal {
		t.Errorf("main-ledger legs unbalanced: debit %d credit %d, want %d each", debits, credits, sourceTotal)
	}
}

// Converting INTO NGN must land in the wallet the rest of the app spends from.
func TestLiveDB_OrchNGN_ConversionCreditsTheMainWallet(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)
	store := orchestration.NewSQLStore(pool)

	if err := store.SeedBalance(ctx, user, "USD", 1_000_00); err != nil {
		t.Fatalf("seed USD pot: %v", err)
	}
	const sourceTotal = 500_00
	const destMinor = 787_500_00
	conv := &orchestration.Conversion{
		ID: "cv_" + uuid.NewString(), Reference: "PMX-CV-NGN2", CustomerID: user,
		Status:      orchestration.ConvSettled,
		Source:      orchestration.NewMoney(sourceTotal, "USD"),
		Destination: orchestration.NewMoney(destMinor, "NGN"),
		Rate:        1575.0, AllInRate: 1575.0,
		Fees:           []orchestration.Fee{{Type: orchestration.FeeSpread, Amount: orchestration.NewMoney(50, "USD")}},
		Route:          orchestration.Route{Provider: "maplerad", Corridor: "USD-NGN", Rail: orchestration.RailBankTransfer},
		TransactionID:  "tx_" + uuid.NewString(),
		IdempotencyKey: "orch-ngn-conv-in-" + uuid.NewString(), CreatedAt: time.Now(),
	}
	if err := store.ApplyConversion(ctx, conv, sourceTotal); err != nil {
		t.Fatalf("apply USD→NGN conversion: %v", err)
	}

	if got := mainWalletBalance(t, ctx, pool, user); got != destMinor {
		t.Errorf("main wallet after inbound conversion: got %d want %d", got, destMinor)
	}
	if got := orchPotRow(t, ctx, pool, user, "NGN"); got != -1 {
		t.Errorf("inbound conversion credited an orch_balances NGN row (%d) instead of the main wallet", got)
	}
}

// Fail-closed: a conversion larger than the wallet must move nothing at all.
func TestLiveDB_OrchNGN_InsufficientBalanceMovesNothing(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)
	seedWallet(t, ctx, newLiveLedger(pool), user, 1_00)

	store := orchestration.NewSQLStore(pool)
	conv := ngnConversion(user, 100_000_00, 65_00, 100)

	err := store.ApplyConversion(ctx, conv, 100_000_00)
	if err == nil {
		t.Fatal("conversion succeeded against a ₦1.00 wallet — the sufficiency gate is open")
	}
	var apiErr *orchestration.APIError
	if !errors.As(err, &apiErr) || apiErr.Type != orchestration.ErrInsufficientBalance {
		t.Fatalf("want ErrInsufficientBalance, got %#v", err)
	}
	if got := mainWalletBalance(t, ctx, pool, user); got != 1_00 {
		t.Errorf("wallet changed on a rejected conversion: got %d want 100", got)
	}
	if got := orchPotRow(t, ctx, pool, user, "USD"); got != -1 {
		t.Errorf("rejected conversion still credited USD (%d) — the destination leg escaped the rollback", got)
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM orch_conversions WHERE idempotency_key=$1`, conv.IdempotencyKey).Scan(&rows); err != nil {
		t.Fatalf("count orch_conversions: %v", err)
	}
	if rows != 0 {
		t.Errorf("rejected conversion was still recorded (%d rows)", rows)
	}
}

// A payout funded from NGN must also draw down the main wallet.
func TestLiveDB_OrchNGN_TransferDebitsTheMainWallet(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)
	seedWallet(t, ctx, newLiveLedger(pool), user, 200_000_00)

	store := orchestration.NewSQLStore(pool)
	const sourceTotal = 50_000_00
	tr := &orchestration.Transfer{
		ID: "tr_" + uuid.NewString(), Reference: "PMX-TR-NGN1", CustomerID: user,
		Status:      orchestration.TransferProcessing,
		Source:      orchestration.NewMoney(sourceTotal, "NGN"),
		Destination: orchestration.NewMoney(sourceTotal, "NGN"),
		QuotedRate:  1, ExecutedRate: 1,
		Fees:           []orchestration.Fee{{Type: orchestration.FeeSpread, Amount: orchestration.NewMoney(0, "NGN")}},
		Route:          orchestration.Route{Provider: "maplerad", Corridor: "NGN-NGN", Rail: orchestration.RailBankTransfer},
		TransactionID:  "tx_" + uuid.NewString(),
		IdempotencyKey: "orch-ngn-tr-" + uuid.NewString(), CreatedAt: time.Now(),
	}
	if err := store.ApplyTransfer(ctx, tr, sourceTotal); err != nil {
		t.Fatalf("apply NGN transfer: %v", err)
	}
	if got, want := mainWalletBalance(t, ctx, pool, user), int64(200_000_00-sourceTotal); got != want {
		t.Errorf("main wallet after payout: got %d want %d", got, want)
	}
}
