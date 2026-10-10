package fx_test

// LIVE-DB integration test for FX virtual-card CREATE idempotency
// (orchestration.sqlCardStore.CreateCard).
// Proves, against a real database, that POST /api/v1/fx/cards is idempotent on
// (business_id, idempotency_key):
//   - replaying the same key returns the SAME card row (same id), never a
//     second row — even when the replayed body differs,
//   - a different key is a different intent and mints a second card,
//   - a concurrent same-key race resolves to exactly one row: the loser takes
//     23505 on orch_fx_cards_idem_uniq and re-selects the winner, and
//   - a full create-then-fund replay under one key creates one card AND one
//     funding leg (the two dedupe paths compose).
// Requires migration 20271017000000_fx_cards_create_idempotency.sql.
// SKIPPED whenever TEST_DATABASE_URL is unset (reuses liveDBPool from
// convert_live_db_test.go), so `go test ./...` without a DB stays green.
//   export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/fx/... -run CardCreateIdem -v

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/orchestration"
)

func cardRowCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, cust string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM orch_fx_cards WHERE business_id=$1`, cust).Scan(&n); err != nil {
		t.Fatalf("count cards: %v", err)
	}
	return n
}

func TestCardCreateIdem_LiveDB(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t) // skips when no DB
	t.Cleanup(pool.Close) // registered first => closes LAST, after row cleanup.

	cust := "fxcardidem_" + uuid.NewString()
	const cur = "USD"
	const fund = int64(25_000)

	if _, err := pool.Exec(ctx, `INSERT INTO orch_balances (customer_id, currency, balance_minor) VALUES ($1,$2,$3)`, cust, cur, 500_000); err != nil {
		t.Fatalf("seed wallet: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM orch_ledger_entries WHERE customer_id=$1`, cust)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM orch_fx_card_txns WHERE business_id=$1`, cust)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM orch_fx_cards WHERE business_id=$1`, cust)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM orch_balances WHERE customer_id=$1`, cust)
	})

	store := orchestration.NewCardStore(pool, nil) // nil issuer → no provider calls
	draft := orchestration.CardDraft{Currency: cur, Label: "Test", Brand: "visa", Color: "purple"}

	// ── Same key replayed → same card, one row. ────────────────────────────
	c1, err := store.CreateCard(ctx, cust, draft, "idem-create-1")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	c2, err := store.CreateCard(ctx, cust, orchestration.CardDraft{Currency: "EUR", Label: "Different", Brand: "mastercard", Color: "blue"}, "idem-create-1")
	if err != nil {
		t.Fatalf("replay create: %v", err)
	}
	if c1.ID != c2.ID {
		t.Fatalf("same-key replay must return the same card: got %s then %s", c1.ID, c2.ID)
	}
	if n := cardRowCount(t, ctx, pool, cust); n != 1 {
		t.Fatalf("same-key replay must persist one row, got %d", n)
	}

	// ── Different key → second card. ───────────────────────────────────────
	c3, err := store.CreateCard(ctx, cust, draft, "idem-create-2")
	if err != nil {
		t.Fatalf("second create: %v", err)
	}
	if c3.ID == c1.ID {
		t.Fatalf("different key must mint a different card, got %s", c3.ID)
	}
	if n := cardRowCount(t, ctx, pool, cust); n != 2 {
		t.Fatalf("want 2 card rows, got %d", n)
	}

	// ── Concurrent same-key creates → exactly one row wins. ────────────────
	const racers = 8
	ids := make([]string, racers)
	var wg sync.WaitGroup
	for i := range racers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c, err := store.CreateCard(ctx, cust, draft, "idem-race-1")
			if err != nil {
				t.Errorf("concurrent create %d: %v", i, err)
				return
			}
			ids[i] = c.ID
		}(i)
	}
	wg.Wait()
	for _, id := range ids {
		if id == "" {
			t.Fatalf("a concurrent create failed (no id)")
		}
		if id != ids[0] {
			t.Fatalf("same-key race must converge on one card: %s vs %s", id, ids[0])
		}
	}
	var raced int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM orch_fx_cards WHERE business_id=$1 AND idempotency_key='idem-race-1'`, cust).Scan(&raced); err != nil {
		t.Fatalf("count raced rows: %v", err)
	}
	if raced != 1 {
		t.Fatalf("concurrent same-key creates must persist exactly one row, got %d", raced)
	}

	// ── Create+fund replay under one key: one card, one funding leg. ───────
	cf, err := store.CreateCard(ctx, cust, draft, "idem-create-fund-1")
	if err != nil {
		t.Fatalf("create for fund replay: %v", err)
	}
	if _, err := store.FundCard(ctx, cust, cf.ID, fund, "idem-create-fund-1"); err != nil {
		t.Fatalf("fund: %v", err)
	}
	// Full-request replay: same key through BOTH legs (mirrors the handler).
	replay, err := store.CreateCard(ctx, cust, draft, "idem-create-fund-1")
	if err != nil {
		t.Fatalf("create replay: %v", err)
	}
	if replay.ID != cf.ID {
		t.Fatalf("create+fund replay must return the same card: %s vs %s", replay.ID, cf.ID)
	}
	funded, err := store.FundCard(ctx, cust, replay.ID, fund, "idem-create-fund-1")
	if err != nil {
		t.Fatalf("fund replay: %v", err)
	}
	if funded.Balance != fund {
		t.Fatalf("replayed create+fund must not double-fund: balance=%d want %d", funded.Balance, fund)
	}
	if n := cardTxnCount(t, ctx, pool, cust, cf.ID); n != 1 {
		t.Fatalf("replayed create+fund must record one funding txn, got %d", n)
	}
}
