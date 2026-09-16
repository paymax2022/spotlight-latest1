package fx_test

// ---------------------------------------------------------------------------
// WHOLE-TABLE per-currency conservation for orch_ledger_entries (ADR-029).
//
// orch_ledger_invariants_live_db_test.go proves that each WRITER posts balanced
// legs, but every assertion there is scoped to a synthetic customer the test
// created. That scoping was not a stylistic choice — before the backfill in
// migration 20261206000100, the table itself carried four legacy conversions
// whose legs were single-sided per currency (NGN residual -106669225, USD
// residual +67668 on the QA database), so a whole-table assertion could not
// pass and the property could not be guarded at all.
//
// This file closes that hole. The invariant is:
//
//     for every currency:  SUM(DEBIT amount_minor) == SUM(CREDIT amount_minor)
//
// over the ENTIRE table, regardless of which writer or which customer produced
// the rows. A per-writer test cannot catch a writer nobody thought to test, a
// hand-run repair script, or history; this one can.
//
// WHY THIS LIVES IN package fx_test (do not move it):
// TestOrchLedger_LegacyShapeIsRejected deliberately inserts an unbalanced
// fixture to prove the invariant has teeth. Go runs tests within a package
// sequentially, so keeping this assertion in the SAME package guarantees it
// never observes that fixture mid-flight. `backend/tests/fx` and
// `backend/internal/orchestration` are the only packages that touch orch_*
// tables, so no other parallel package can race it either.
//
// SKIPPED whenever TEST_DATABASE_URL is unset (reuses liveDBPool from
// convert_live_db_test.go). It does NOT fall back to DATABASE_URL — that is the
// PRODUCTION Supabase pooler and this suite posts ledger entries.
//
// Bring-up:
//   export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/fx/... -run OrchGlobal -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/orchestration"
)

// globalPerCurrencyResidualSQL is the invariant, stated once. Kept inline rather
// than reading orch_ledger_conservation_check so the assertion still works on a
// database that predates that view, and so the rule under test is visible here.
const globalPerCurrencyResidualSQL = `
	SELECT currency,
	       COALESCE(SUM(amount_minor) FILTER (WHERE type='DEBIT'),  0)
	     - COALESCE(SUM(amount_minor) FILTER (WHERE type='CREDIT'), 0) AS residual,
	       COUNT(*)
	FROM public.orch_ledger_entries
	GROUP BY currency
	ORDER BY currency`

type globalCurrencyResidual struct {
	currency string
	residual int64
	legs     int64
}

func orchGlobalResiduals(t *testing.T, ctx context.Context, pool *pgxpool.Pool) []globalCurrencyResidual {
	t.Helper()
	rows, err := pool.Query(ctx, globalPerCurrencyResidualSQL)
	if err != nil {
		t.Fatalf("project global per-currency residuals: %v", err)
	}
	defer rows.Close()

	var out []globalCurrencyResidual
	for rows.Next() {
		var r globalCurrencyResidual
		if err := rows.Scan(&r.currency, &r.residual, &r.legs); err != nil {
			t.Fatalf("scan residual: %v", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate residuals: %v", err)
	}
	return out
}

// TestOrchGlobalConservation_EveryCurrencyBalances is the ADR-029 whole-table
// invariant: whatever history the database carries and whichever writer produced
// it, every currency in orch_ledger_entries conserves value.
func TestOrchGlobalConservation_EveryCurrencyBalances(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	residuals := orchGlobalResiduals(t, ctx, pool)
	if len(residuals) == 0 {
		t.Skip("orch_ledger_entries is empty — nothing to conserve")
	}

	for _, r := range residuals {
		if r.residual != 0 {
			t.Errorf("currency %s: residual %d minor units over %d legs, want 0.\n"+
				"Some writer posted a leg with no counter-leg IN THE SAME CURRENCY. Find it with:\n"+
				"  SELECT customer_id, reference, currency,\n"+
				"         SUM(amount_minor) FILTER (WHERE type='DEBIT') - SUM(amount_minor) FILTER (WHERE type='CREDIT') AS residual\n"+
				"    FROM orch_ledger_entries GROUP BY 1,2,3 HAVING SUM(amount_minor) FILTER (WHERE type='DEBIT') <> SUM(amount_minor) FILTER (WHERE type='CREDIT');\n"+
				"See docs/adr/ADR-029-orch-ledger-per-currency-double-entry.md.",
				r.currency, r.residual, r.legs)
			continue
		}
		t.Logf("currency %s conserves: residual 0 over %d legs", r.currency, r.legs)
	}
}

// TestOrchGlobalConservation_CheckViewAgrees pins the ops-facing probe to the
// same projection this test computes, so a query drift in the view is caught.
func TestOrchGlobalConservation_CheckViewAgrees(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	want := map[string]int64{}
	for _, r := range orchGlobalResiduals(t, ctx, pool) {
		want[r.currency] = r.residual
	}

	rows, err := pool.Query(ctx, `SELECT currency, residual_minor FROM public.orch_ledger_conservation_check`)
	if err != nil {
		t.Fatalf("read orch_ledger_conservation_check (is migration 20261206000100 applied?): %v", err)
	}
	defer rows.Close()

	got := map[string]int64{}
	for rows.Next() {
		var c string
		var residual int64
		if err := rows.Scan(&c, &residual); err != nil {
			t.Fatalf("scan view row: %v", err)
		}
		got[c] = residual
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate view: %v", err)
	}

	if len(got) != len(want) {
		t.Fatalf("view reports %d currencies, direct projection reports %d — the view's grouping has drifted", len(got), len(want))
	}
	for c, w := range want {
		if g, ok := got[c]; !ok || g != w {
			t.Errorf("view residual for %s = %d (present=%v), direct projection = %d — the view's projection has drifted", c, g, ok, w)
		}
	}
}

// TestOrchGlobalConservation_SurvivesPosting proves the invariant is preserved by
// real postings rather than merely true of a quiescent table: it captures the
// per-currency residuals, drives a real conversion through the production store,
// and re-checks. This is the regression that would have caught the original bug
// — the pre-ADR-029 ApplyConversion moved BOTH currencies off zero.
func TestOrchGlobalConservation_SurvivesPosting(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	before := map[string]int64{}
	for _, r := range orchGlobalResiduals(t, ctx, pool) {
		before[r.currency] = r.residual
	}

	cust := "orchglobal_" + uuid.NewString()
	orchCleanup(t, ctx, pool, cust)

	store := orchestration.NewSQLStore(pool)
	const opening = int64(200_000)
	if err := store.SeedBalance(ctx, cust, "USD", opening); err != nil {
		t.Fatalf("seed USD: %v", err)
	}

	// Same fee shape the quote engine produces, and a rate far from 1:1 — a
	// currency-blind check would pass on a 1:1 rate, which is precisely how the
	// original defect stayed hidden.
	const principal = int64(100_000)
	const providerFee = int64(500)
	const railFee = int64(250)
	const spread = int64(300)
	const destAmount = int64(157_500_000)
	sourceTotal := principal + providerFee + railFee

	conv := &orchestration.Conversion{
		ID: "cv_" + uuid.NewString(), Reference: "PMX-CV-GLOBAL", CustomerID: cust,
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
		IdempotencyKey: "orch-global-conv-" + uuid.NewString(), CreatedAt: time.Now(),
	}
	if err := store.ApplyConversion(ctx, conv, sourceTotal); err != nil {
		t.Fatalf("apply conversion: %v", err)
	}

	after := map[string]int64{}
	for _, r := range orchGlobalResiduals(t, ctx, pool) {
		after[r.currency] = r.residual
	}

	// Every currency that existed before must be unmoved, and any currency the
	// posting introduced must arrive at zero.
	for c, a := range after {
		b, existed := before[c]
		if !existed {
			b = 0
		}
		if a != b {
			t.Errorf("currency %s residual moved from %d to %d after a conversion — the posting was not balanced within that currency", c, b, a)
		}
	}
	for c, b := range before {
		if _, ok := after[c]; !ok {
			t.Errorf("currency %s disappeared from the ledger (residual was %d) — entries are meant to be immutable", c, b)
		}
	}
}
