package orchestration

// LIVE-DB test for the FX console overview reader. The aggregation math is
// covered without a database in admin_overview_test.go; this one proves
// AdminOverviewSource reads the real orchestration tables with the same window
// boundary the endpoint uses. Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAdminOverviewSourceReadsLiveLedger(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping FX overview live-DB test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()

	// A month-wide window so the assertion does not depend on what happened to be
	// written in the last 24h.
	since := time.Now().Add(-30 * 24 * time.Hour)
	rows, err := NewAdminOverviewSource(pool).rows(ctx, since)
	if err != nil {
		t.Fatalf("rows: %v", err)
	}

	var want int
	if err := pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM orch_conversions WHERE created_at >= $1)
		     + (SELECT count(*) FROM orch_transfers WHERE created_at >= $1)
		     + (SELECT count(*) FROM orch_collection_events WHERE created_at >= $1)`, since).Scan(&want); err != nil {
		t.Fatalf("count: %v", err)
	}
	if len(rows) != want {
		t.Fatalf("reader returned %d rows, ledger has %d", len(rows), want)
	}
	for _, r := range rows {
		switch r.kind {
		case "conversion", "transfer", "collection":
		default:
			t.Fatalf("unexpected row kind %q", r.kind)
		}
		if r.amount <= 0 {
			t.Fatalf("%s row %+v has non-positive amount", r.kind, r)
		}
	}

	// The headline must account for exactly the rows the reader returned.
	ov := buildAdminOverview(rows, nil, time.Now())
	if ov.TxCount24h != len(rows) {
		t.Fatalf("TxCount24h = %d, want %d", ov.TxCount24h, len(rows))
	}
	if ov.UnpricedRows != 0 && ov.GMVUsdCents == 0 && len(rows) > 0 {
		t.Logf("all %d rows unpriced — no USD rate covering their currencies", ov.UnpricedRows)
	}
}
