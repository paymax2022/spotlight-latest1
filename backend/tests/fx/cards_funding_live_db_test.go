package fx_test

// ---------------------------------------------------------------------------
// LIVE-DB integration test for the FX virtual-card FUNDING money path
// (orchestration.sqlCardStore.FundCard / TerminateCard).
//
// Proves, against a real database, that funding a card:
//   - debits the customer's orch_balances wallet by exactly the amount,
//   - credits orch_fx_cards.balance_minor by exactly the amount,
//   - posts a BALANCED double-entry pair into orch_ledger_entries
//     (one DEBIT 'customer_balance' + one CREDIT 'card_balance', equal amounts),
//   - is IDEMPOTENT: a replay with the same Idempotency-Key does not double-debit,
//     double-credit, or post extra ledger legs (dedupe via orch_fx_card_txns), and
//   - FAILS CLOSED: a fund exceeding the wallet returns ErrInsufficientCardBalance
//     and leaves every balance untouched.
//
// The issuer is nil here (no provider calls) — this isolates the ledger money path.
//
// SKIPPED whenever TEST_DATABASE_URL is unset (reuses liveDBPool from
// convert_live_db_test.go), so `go test ./...` without a DB stays green.
//
// Bring-up: apply migrations incl. 20260621000000_fx_orchestration.sql and
// 20261003000000_fx_cards_collections.sql, then:
//   export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/fx/... -run CardFunding -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/orchestration"
)

func cardWalletBal(t *testing.T, ctx context.Context, pool *pgxpool.Pool, cust, cur string) int64 {
	t.Helper()
	var bal int64
	err := pool.QueryRow(ctx, `SELECT balance_minor FROM orch_balances WHERE customer_id=$1 AND currency=$2`, cust, cur).Scan(&bal)
	if err != nil {
		t.Fatalf("read wallet: %v", err)
	}
	return bal
}

func cardBal(t *testing.T, ctx context.Context, pool *pgxpool.Pool, cust, id string) int64 {
	t.Helper()
	var bal int64
	err := pool.QueryRow(ctx, `SELECT balance_minor FROM orch_fx_cards WHERE id=$1 AND business_id=$2`, id, cust).Scan(&bal)
	if err != nil {
		t.Fatalf("read card balance: %v", err)
	}
	return bal
}

// ledgerSums returns (sumDebit, sumCredit, legCount) for a customer.
func ledgerSums(t *testing.T, ctx context.Context, pool *pgxpool.Pool, cust string) (int64, int64, int) {
	t.Helper()
	var debit, credit int64
	var count int
	err := pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(amount_minor) FILTER (WHERE type='DEBIT'), 0),
			COALESCE(SUM(amount_minor) FILTER (WHERE type='CREDIT'), 0),
			COUNT(*)
		FROM orch_ledger_entries WHERE customer_id=$1`, cust).Scan(&debit, &credit, &count)
	if err != nil {
		t.Fatalf("read ledger sums: %v", err)
	}
	return debit, credit, count
}

func cardTxnCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, cust, cardID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM orch_fx_card_txns WHERE business_id=$1 AND card_id=$2`, cust, cardID).Scan(&n); err != nil {
		t.Fatalf("count card txns: %v", err)
	}
	return n
}

func TestCardFunding_LiveDB(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t) // skips when no DB
	t.Cleanup(pool.Close) // registered first => closes LAST, after the row cleanup below.
	// `defer pool.Close()` would run BEFORE any t.Cleanup and leave
	// this test's rows stranded in the money tables.

	cust := "fxcardtest_" + uuid.NewString()
	const cur = "USD"
	const opening = int64(100_000) // ₵1,000.00
	const fund = int64(30_000)     // ₵300.00

	// Seed an opening USD wallet balance.
	if _, err := pool.Exec(ctx, `INSERT INTO orch_balances (customer_id, currency, balance_minor) VALUES ($1,$2,$3)`, cust, cur, opening); err != nil {
		t.Fatalf("seed wallet: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM orch_ledger_entries WHERE customer_id=$1`, cust)
		_, _ = pool.Exec(ctx, `DELETE FROM orch_fx_card_txns WHERE business_id=$1`, cust)
		_, _ = pool.Exec(ctx, `DELETE FROM orch_fx_cards WHERE business_id=$1`, cust)
		_, _ = pool.Exec(ctx, `DELETE FROM orch_balances WHERE customer_id=$1`, cust)
	})

	store := orchestration.NewCardStore(pool, nil) // nil issuer → no provider calls

	card, err := store.CreateCard(ctx, cust, orchestration.CardDraft{Currency: cur, Label: "Test", Brand: "visa", Color: "purple"})
	if err != nil {
		t.Fatalf("create card: %v", err)
	}

	// ── Fund once ──────────────────────────────────────────────────────────────
	if _, err := store.FundCard(ctx, cust, card.ID, fund, "idem-fund-1"); err != nil {
		t.Fatalf("fund: %v", err)
	}
	if got := cardWalletBal(t, ctx, pool, cust, cur); got != opening-fund {
		t.Fatalf("wallet after fund: got %d want %d", got, opening-fund)
	}
	if got := cardBal(t, ctx, pool, cust, card.ID); got != fund {
		t.Fatalf("card balance after fund: got %d want %d", got, fund)
	}
	debit, credit, legs := ledgerSums(t, ctx, pool, cust)
	if debit != credit {
		t.Fatalf("double-entry not balanced: debit=%d credit=%d", debit, credit)
	}
	if debit != fund {
		t.Fatalf("ledger debit total: got %d want %d", debit, fund)
	}
	if legs != 2 {
		t.Fatalf("expected exactly 2 ledger legs after one fund, got %d", legs)
	}

	// ── Replay same idempotency key: must be a no-op ─────────────────────────────
	if _, err := store.FundCard(ctx, cust, card.ID, fund, "idem-fund-1"); err != nil {
		t.Fatalf("replay fund: %v", err)
	}
	if got := cardWalletBal(t, ctx, pool, cust, cur); got != opening-fund {
		t.Fatalf("replay must not re-debit wallet: got %d want %d", got, opening-fund)
	}
	if got := cardBal(t, ctx, pool, cust, card.ID); got != fund {
		t.Fatalf("replay must not re-credit card: got %d want %d", got, fund)
	}
	if _, _, legs := ledgerSums(t, ctx, pool, cust); legs != 2 {
		t.Fatalf("replay must not post extra ledger legs, got %d", legs)
	}
	if n := cardTxnCount(t, ctx, pool, cust, card.ID); n != 1 {
		t.Fatalf("replay must not create a second funding txn, got %d", n)
	}

	// ── Fail closed: fund beyond wallet balance ─────────────────────────────────
	_, err = store.FundCard(ctx, cust, card.ID, opening*10, "idem-fund-2")
	if !errors.Is(err, orchestration.ErrInsufficientCardBalance) {
		t.Fatalf("over-fund: want ErrInsufficientCardBalance, got %v", err)
	}
	if got := cardWalletBal(t, ctx, pool, cust, cur); got != opening-fund {
		t.Fatalf("failed fund must not move wallet: got %d want %d", got, opening-fund)
	}

	// ── Terminate refunds the residual card balance to the wallet ───────────────
	if err := store.TerminateCard(ctx, cust, card.ID); err != nil {
		t.Fatalf("terminate: %v", err)
	}
	if got := cardWalletBal(t, ctx, pool, cust, cur); got != opening {
		t.Fatalf("terminate must refund residual: wallet got %d want %d", got, opening)
	}
	if got := cardBal(t, ctx, pool, cust, card.ID); got != 0 {
		t.Fatalf("terminated card balance must be 0, got %d", got)
	}
	debit2, credit2, legs2 := ledgerSums(t, ctx, pool, cust)
	if debit2 != credit2 {
		t.Fatalf("ledger unbalanced after termination: debit=%d credit=%d", debit2, credit2)
	}
	if legs2 != 4 {
		t.Fatalf("expected 4 ledger legs (fund pair + refund pair), got %d", legs2)
	}
}
