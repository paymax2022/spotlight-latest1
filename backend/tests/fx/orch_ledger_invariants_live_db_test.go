package fx_test

// ---------------------------------------------------------------------------
// LIVE-DB invariant suite for the ORCHESTRATION ledger (orch_ledger_entries).
//
// Guards the money-path iron rule from CLAUDE.md — "every money mutation MUST
// post balanced double-entry ledger entries" — for every writer of
// orch_ledger_entries, per ADR-029.
//
// The invariant under test is PER-CURRENCY balance: within any single currency,
// SUM(DEBIT) must equal SUM(CREDIT). This is the assertion that the pre-ADR-029
// code failed. ApplyConversion used to post exactly two legs — DEBIT
// customer_balance in the SOURCE currency and CREDIT customer_balance in the
// DEST currency — so each currency was single-sided: destination currency was
// created from nothing and the source debit had no counter-leg. ApplyTransfer
// was worse still: a lone DEBIT leg with no counter-leg at all.
//
// Note that a naive "SUM(all debits) == SUM(all credits)" check does NOT catch
// this — the old two-leg conversion balanced by leg COUNT and would only look
// unbalanced once the amounts differed, which they always do across an FX rate.
// Currency must be part of the GROUP BY. TestOrchLedger_LegacyShapeIsRejected
// pins that distinction so the invariant cannot be weakened back.
//
// SKIPPED whenever TEST_DATABASE_URL is unset (reuses liveDBPool
// from convert_live_db_test.go), so `go test ./...` without a DB stays green.
//
// Bring-up: apply migrations incl. 20260621000000_fx_orchestration.sql, then:
//   export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/fx/... -run OrchLedger -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/orchestration/adapters"
)

// currencyBalance is the per-currency debit/credit rollup of orch_ledger_entries.
type currencyBalance struct {
	currency string
	debit    int64
	credit   int64
	legs     int
}

// orchLedgerByCurrency rolls up every ledger entry for a customer, grouped by
// currency. This is the shape the invariant is stated over.
func orchLedgerByCurrency(t *testing.T, ctx context.Context, pool *pgxpool.Pool, cust string) []currencyBalance {
	t.Helper()
	rows, err := pool.Query(ctx, `
		SELECT currency,
		       COALESCE(SUM(amount_minor) FILTER (WHERE type='DEBIT'), 0),
		       COALESCE(SUM(amount_minor) FILTER (WHERE type='CREDIT'), 0),
		       COUNT(*)
		FROM orch_ledger_entries WHERE customer_id=$1
		GROUP BY currency ORDER BY currency`, cust)
	if err != nil {
		t.Fatalf("roll up ledger: %v", err)
	}
	defer rows.Close()
	var out []currencyBalance
	for rows.Next() {
		var cb currencyBalance
		if err := rows.Scan(&cb.currency, &cb.debit, &cb.credit, &cb.legs); err != nil {
			t.Fatalf("scan rollup: %v", err)
		}
		out = append(out, cb)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rollup rows: %v", err)
	}
	return out
}

// assertPerCurrencyBalanced is THE invariant: no currency may be single-sided.
func assertPerCurrencyBalanced(t *testing.T, ctx context.Context, pool *pgxpool.Pool, cust, stage string) []currencyBalance {
	t.Helper()
	rollup := orchLedgerByCurrency(t, ctx, pool, cust)
	if len(rollup) == 0 {
		t.Fatalf("%s: expected ledger entries, found none", stage)
	}
	for _, cb := range rollup {
		if cb.debit != cb.credit {
			t.Errorf("%s: %s ledger is single-sided: debit=%d credit=%d over %d legs (per-currency double-entry violated)",
				stage, cb.currency, cb.debit, cb.credit, cb.legs)
		}
	}
	return rollup
}

// sumByAccount returns the signed position (debit-credit) of one account in one
// currency, used to prove the FX position lands in provider_clearing.
func sumByAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, cust, account, currency string) int64 {
	t.Helper()
	var net int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor) FILTER (WHERE type='DEBIT'), 0)
		     - COALESCE(SUM(amount_minor) FILTER (WHERE type='CREDIT'), 0)
		FROM orch_ledger_entries WHERE customer_id=$1 AND account=$2 AND currency=$3`,
		cust, account, currency).Scan(&net)
	if err != nil {
		t.Fatalf("net %s/%s: %v", account, currency, err)
	}
	return net
}

func orchCleanup(t *testing.T, ctx context.Context, pool *pgxpool.Pool, cust string) {
	t.Helper()
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM orch_ledger_entries WHERE customer_id=$1`, cust)
		_, _ = pool.Exec(ctx, `DELETE FROM orch_conversions WHERE customer_id=$1`, cust)
		_, _ = pool.Exec(ctx, `DELETE FROM orch_transfers WHERE customer_id=$1`, cust)
		_, _ = pool.Exec(ctx, `DELETE FROM orch_balances WHERE customer_id=$1`, cust)
	})
}

// TestOrchLedger_ConversionIsBalancedPerCurrency drives sqlStore.ApplyConversion
// directly (no provider, no quote book) and proves both currencies balance.
func TestOrchLedger_ConversionIsBalancedPerCurrency(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t) // skips when no DB
	t.Cleanup(pool.Close) // registered first => closes LAST, after orchCleanup

	cust := "orchledger_" + uuid.NewString()
	orchCleanup(t, ctx, pool, cust)

	store := orchestration.NewSQLStore(pool)

	const opening = int64(200_000) // $2,000.00
	if err := store.SeedBalance(ctx, cust, "USD", opening); err != nil {
		t.Fatalf("seed USD: %v", err)
	}

	// A USD→NGN conversion at a representative all-in rate, with the same fee
	// shape the quote engine produces: provider + rail fees add to the debit,
	// the spread is retained markup already priced into the destination amount.
	const principal = int64(100_000) // $1,000.00
	const providerFee = int64(500)
	const railFee = int64(250)
	const spread = int64(300)
	const destAmount = int64(157_500_000) // ₦1,575,000.00
	sourceTotal := principal + providerFee + railFee

	conv := &orchestration.Conversion{
		ID: "cv_" + uuid.NewString(), Reference: "PMX-CV-INV1", CustomerID: cust,
		Status:      orchestration.ConvSettled,
		Source:      orchestration.NewMoney(principal, "USD"),
		Destination: orchestration.NewMoney(destAmount, "NGN"),
		Rate:        1575.0, AllInRate: 1575.0,
		Fees: []orchestration.Fee{
			{Type: orchestration.FeeProvider, Amount: orchestration.NewMoney(providerFee, "USD")},
			{Type: orchestration.FeeRail, Amount: orchestration.NewMoney(railFee, "USD")},
			{Type: orchestration.FeeSpread, Amount: orchestration.NewMoney(spread, "USD")},
		},
		Route:          orchestration.Route{Provider: "maplerad", Corridor: "USD-NGN", Rail: orchestration.RailBankTransfer},
		TransactionID:  "tx_" + uuid.NewString(),
		IdempotencyKey: "orch-inv-conv-" + uuid.NewString(), CreatedAt: time.Now(),
	}
	if err := store.ApplyConversion(ctx, conv, sourceTotal); err != nil {
		t.Fatalf("apply conversion: %v", err)
	}

	rollup := assertPerCurrencyBalanced(t, ctx, pool, cust, "after conversion")
	if len(rollup) != 2 {
		t.Fatalf("expected both currencies on the ledger, got %d: %+v", len(rollup), rollup)
	}

	// The customer's own USD movement is exactly the debited total, and the NGN
	// movement is exactly the credited destination — the conversion must not have
	// changed what the customer sees while fixing the counter-legs.
	if got := sumByAccount(t, ctx, pool, cust, "customer_balance", "USD"); got != sourceTotal {
		t.Errorf("customer USD debit: got %d want %d", got, sourceTotal)
	}
	if got := sumByAccount(t, ctx, pool, cust, "customer_balance", "NGN"); got != -destAmount {
		t.Errorf("customer NGN credit: got %d want %d", got, -destAmount)
	}

	// Retained markup is recognised as revenue, and the residual FX position sits
	// in provider_clearing: long the source currency, short the destination.
	if got := sumByAccount(t, ctx, pool, cust, "paymax_spread", "USD"); got != -spread {
		t.Errorf("paymax_spread USD credit: got %d want %d", got, -spread)
	}
	if got := sumByAccount(t, ctx, pool, cust, "provider_clearing", "USD"); got != -(sourceTotal - spread) {
		t.Errorf("provider_clearing USD: got %d want %d", got, -(sourceTotal - spread))
	}
	if got := sumByAccount(t, ctx, pool, cust, "provider_clearing", "NGN"); got != destAmount {
		t.Errorf("provider_clearing NGN: got %d want %d", got, destAmount)
	}

	// Balances still move exactly as before the fix (projections untouched).
	usd, err := store.Balance(ctx, cust, "USD")
	if err != nil {
		t.Fatalf("read USD balance: %v", err)
	}
	if usd != opening-sourceTotal {
		t.Errorf("USD balance: got %d want %d", usd, opening-sourceTotal)
	}
	ngn, err := store.Balance(ctx, cust, "NGN")
	if err != nil {
		t.Fatalf("read NGN balance: %v", err)
	}
	if ngn != destAmount {
		t.Errorf("NGN balance: got %d want %d", ngn, destAmount)
	}
}

// TestOrchLedger_TransferIsBalancedPerCurrency proves a payout is no longer a
// lone DEBIT. A transfer touches only ONE Paymax-held balance (the beneficiary
// is paid from provider float), so it posts source-currency legs only.
func TestOrchLedger_TransferIsBalancedPerCurrency(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close) // registered first => closes LAST, after orchCleanup

	cust := "orchledger_" + uuid.NewString()
	orchCleanup(t, ctx, pool, cust)

	store := orchestration.NewSQLStore(pool)

	const opening = int64(500_000)
	if err := store.SeedBalance(ctx, cust, "USD", opening); err != nil {
		t.Fatalf("seed USD: %v", err)
	}

	const principal = int64(50_000)
	const providerFee = int64(400)
	const railFee = int64(100)
	const spread = int64(150)
	sourceTotal := principal + providerFee + railFee

	tr := &orchestration.Transfer{
		ID: "tr_" + uuid.NewString(), Reference: "PMX-TR-INV1", CustomerID: cust,
		Status:      orchestration.TransferPaid,
		Source:      orchestration.NewMoney(principal, "USD"),
		Destination: orchestration.NewMoney(78_750_000, "NGN"),
		QuotedRate:  1575.0, ExecutedRate: 1575.0,
		Fees: []orchestration.Fee{
			{Type: orchestration.FeeProvider, Amount: orchestration.NewMoney(providerFee, "USD")},
			{Type: orchestration.FeeRail, Amount: orchestration.NewMoney(railFee, "USD")},
			{Type: orchestration.FeeSpread, Amount: orchestration.NewMoney(spread, "USD")},
		},
		Route:          orchestration.Route{Provider: "maplerad", Corridor: "USD-NGN", Rail: orchestration.RailBankTransfer},
		TransactionID:  "tx_" + uuid.NewString(),
		IdempotencyKey: "orch-inv-tr-" + uuid.NewString(), CreatedAt: time.Now(),
	}
	if err := store.ApplyTransfer(ctx, tr, sourceTotal); err != nil {
		t.Fatalf("apply transfer: %v", err)
	}

	rollup := assertPerCurrencyBalanced(t, ctx, pool, cust, "after transfer")
	if len(rollup) != 1 || rollup[0].currency != "USD" {
		t.Fatalf("a payout must touch only the source currency, got %+v", rollup)
	}
	if got := sumByAccount(t, ctx, pool, cust, "customer_balance", "USD"); got != sourceTotal {
		t.Errorf("customer USD debit: got %d want %d", got, sourceTotal)
	}
	if got := sumByAccount(t, ctx, pool, cust, "paymax_spread", "USD"); got != -spread {
		t.Errorf("paymax_spread USD credit: got %d want %d", got, -spread)
	}
	if got := sumByAccount(t, ctx, pool, cust, "provider_clearing", "USD"); got != -(sourceTotal - spread) {
		t.Errorf("provider_clearing USD: got %d want %d", got, -(sourceTotal - spread))
	}
}

// TestOrchLedger_ZeroSpreadStaysBalanced covers the degenerate pricing cases the
// splitSpread guard exists for: no spread quoted at all (same-currency payouts
// synthesize a fee-free quote), and a nonsense spread larger than the debit. In
// both, everything must fall through to provider_clearing and still balance.
func TestOrchLedger_ZeroSpreadStaysBalanced(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close) // registered first => closes LAST, after each subtest's orchCleanup

	store := orchestration.NewSQLStore(pool)

	cases := []struct {
		name   string
		spread int64
	}{
		{"no spread quoted", 0},
		{"spread exceeds the debit", 999_999_999},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cust := "orchledger_" + uuid.NewString()
			orchCleanup(t, ctx, pool, cust)

			const sourceTotal = int64(25_000)
			if err := store.SeedBalance(ctx, cust, "USD", sourceTotal*4); err != nil {
				t.Fatalf("seed USD: %v", err)
			}
			tr := &orchestration.Transfer{
				ID: "tr_" + uuid.NewString(), Reference: "PMX-TR-" + uuid.NewString()[:8], CustomerID: cust,
				Status:      orchestration.TransferPaid,
				Source:      orchestration.NewMoney(sourceTotal, "USD"),
				Destination: orchestration.NewMoney(sourceTotal, "USD"),
				QuotedRate:  1, ExecutedRate: 1,
				Fees: []orchestration.Fee{
					{Type: orchestration.FeeSpread, Amount: orchestration.NewMoney(tc.spread, "USD")},
				},
				Route:          orchestration.Route{Provider: "maplerad", Corridor: "USD-USD", Rail: orchestration.RailBankTransfer},
				TransactionID:  "tx_" + uuid.NewString(),
				IdempotencyKey: "orch-inv-spread-" + uuid.NewString(), CreatedAt: time.Now(),
			}
			if err := store.ApplyTransfer(ctx, tr, sourceTotal); err != nil {
				t.Fatalf("apply transfer: %v", err)
			}
			assertPerCurrencyBalanced(t, ctx, pool, cust, tc.name)
			// The whole debit must land in clearing — never silently dropped.
			if got := sumByAccount(t, ctx, pool, cust, "provider_clearing", "USD"); got != -sourceTotal {
				t.Errorf("provider_clearing USD: got %d want %d", got, -sourceTotal)
			}
			if got := sumByAccount(t, ctx, pool, cust, "paymax_spread", "USD"); got != 0 {
				t.Errorf("degenerate spread must not be recognised as revenue, got %d", got)
			}
		})
	}
}

// TestOrchLedger_EndToEndQuoteExecuteIsBalanced drives the FULL production path —
// orchestration.NewService over the deterministic Eversend/Maplerad adapters and
// the real sqlStore — from quote through execution, the way the QA conversions
// that surfaced this bug were made. The adapters are the no-credential fallback
// the app wires when MAPLERAD_*/EVERSEND_* are unset, so conversions settle
// locally and no provider call leaves the machine.
func TestOrchLedger_EndToEndQuoteExecuteIsBalanced(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close) // registered first => closes LAST, after orchCleanup

	cust := "orchledger_" + uuid.NewString()
	orchCleanup(t, ctx, pool, cust)

	store := orchestration.NewSQLStore(pool)
	svc := orchestration.NewService(
		[]orchestration.Provider{adapters.NewEversend(false), adapters.NewMapleradFX(false)},
		store,
		orchestration.Options{
			Spread: orchestration.NewSpreadEngine(105,
				orchestration.SpreadRule{Corridor: "USD-NGN", BPS: 120, MinBPS: 80, MaxBPS: 200},
			),
			LockWindow: 90 * time.Second,
		},
	)

	const opening = int64(500_000) // $5,000.00
	if err := svc.SeedBalance(ctx, cust, "USD", opening); err != nil {
		t.Fatalf("seed USD: %v", err)
	}

	q, apiErr := svc.CreateQuote(ctx, cust, "retail", orchestration.QuoteRequest{
		Source: "USD", Destination: "NGN", Amount: 100_000,
		Intent: orchestration.IntentConversion, Lock: true,
	})
	if apiErr != nil {
		t.Fatalf("create quote: %v", apiErr)
	}

	conv, apiErr := svc.ExecuteConversion(ctx, cust, "e2e-"+uuid.NewString(),
		orchestration.ConversionRequest{QuoteID: q.ID})
	if apiErr != nil {
		t.Fatalf("execute conversion: %v", apiErr)
	}
	if conv.Status != orchestration.ConvSettled {
		t.Fatalf("conversion status: got %q want %q", conv.Status, orchestration.ConvSettled)
	}

	rollup := assertPerCurrencyBalanced(t, ctx, pool, cust, "after end-to-end conversion")
	if len(rollup) != 2 {
		t.Fatalf("expected USD and NGN on the ledger, got %+v", rollup)
	}

	// What the customer was actually charged and credited must equal what the
	// executed conversion says — the counter-legs must not have shifted it.
	sourceTotal := conv.Source.AmountMinor +
		feeOf(conv.Fees, orchestration.FeeProvider) + feeOf(conv.Fees, orchestration.FeeRail)
	if got := sumByAccount(t, ctx, pool, cust, "customer_balance", "USD"); got != sourceTotal {
		t.Errorf("customer USD debit: got %d want %d", got, sourceTotal)
	}
	if got := sumByAccount(t, ctx, pool, cust, "customer_balance", "NGN"); got != -conv.Destination.AmountMinor {
		t.Errorf("customer NGN credit: got %d want %d", got, -conv.Destination.AmountMinor)
	}
	// The quoted spread is recognised as revenue rather than vanishing into the rate.
	if spread := feeOf(conv.Fees, orchestration.FeeSpread); spread > 0 && spread < sourceTotal {
		if got := sumByAccount(t, ctx, pool, cust, "paymax_spread", "USD"); got != -spread {
			t.Errorf("paymax_spread USD credit: got %d want %d", got, -spread)
		}
	}
}

// feeOf reads one itemized fee amount off an executed conversion.
func feeOf(fees []orchestration.Fee, t orchestration.FeeType) int64 {
	for _, f := range fees {
		if f.Type == t {
			return f.Amount.AmountMinor
		}
	}
	return 0
}

// TestOrchLedger_LegacyShapeIsRejected pins the invariant's teeth. It writes the
// exact two-leg shape the old ApplyConversion produced and asserts the
// per-currency check FAILS on it — while a whole-ledger debit-vs-credit check
// would also fail here only by amount, and passes outright when the FX rate
// happens to be 1. If someone later relaxes the invariant to ignore currency,
// this test tells them what they gave up.
func TestOrchLedger_LegacyShapeIsRejected(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close) // registered first => closes LAST, after orchCleanup

	cust := "orchledger_legacy_" + uuid.NewString()
	orchCleanup(t, ctx, pool, cust)

	// The legacy shape, at a 1:1 rate so total debits == total credits overall.
	// Only the per-currency grouping exposes it as single-sided.
	const amt = int64(100_000)
	for _, leg := range []struct {
		currency, typ, idem string
	}{
		{"USD", "DEBIT", "legacy:src"},
		{"NGN", "CREDIT", "legacy:dst"},
	} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO orch_ledger_entries (customer_id, account, currency, type, amount_minor, reference, idempotency_key)
			VALUES ($1,'customer_balance',$2,$3,$4,'PMX-CV-LEGACY',$5)`,
			cust, leg.currency, leg.typ, amt, cust+":"+leg.idem); err != nil {
			t.Fatalf("seed legacy leg: %v", err)
		}
	}

	// Whole-ledger check: passes, because 100000 debit == 100000 credit.
	var totalDebit, totalCredit int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor) FILTER (WHERE type='DEBIT'), 0),
		       COALESCE(SUM(amount_minor) FILTER (WHERE type='CREDIT'), 0)
		FROM orch_ledger_entries WHERE customer_id=$1`, cust).Scan(&totalDebit, &totalCredit); err != nil {
		t.Fatalf("whole-ledger sums: %v", err)
	}
	if totalDebit != totalCredit {
		t.Fatalf("precondition: this fixture is meant to pass a currency-blind check, got %d vs %d", totalDebit, totalCredit)
	}

	// Per-currency check: must find BOTH currencies single-sided.
	unbalanced := 0
	for _, cb := range orchLedgerByCurrency(t, ctx, pool, cust) {
		if cb.debit != cb.credit {
			unbalanced++
		}
	}
	if unbalanced != 2 {
		t.Fatalf("per-currency invariant failed to flag the legacy single-sided shape: %d of 2 currencies flagged", unbalanced)
	}
}
