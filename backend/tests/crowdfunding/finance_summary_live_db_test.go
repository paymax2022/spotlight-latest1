package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB test: the crowdfunding finance summary reports measured figures.
//
// WHY THIS EXISTS
// ---------------
// Three of the seven cards on /admin/crowdfunding/finance were not measurements:
//
//   - "Platform revenue" was `gmv_kobo / 40`, an assumed 2.5%. The only authority
//     for the crowdfunding split is crowdfunding.PlatformFeePct = 0.10, and the
//     money path posts that 10% through settlement.Split and records the realized
//     profit into commission_earnings. The card understated booked revenue
//     fourfold and, being a constant divided into GMV, would not have moved if
//     the fee changed.
//   - "Reconciliation gaps" was the literal 0. The one card an operator reads as
//     "the books balance" could never say anything else.
//   - Every query discarded its error (`_ = s.db.QueryRow(...)`), so a failed or
//     timed-out query left the field at its zero value and the console rendered a
//     clean ₦0 across the board. A broken database and a quiet day looked
//     identical on the page whose purpose is telling them apart.
//
// None of that failed. It rendered.
//
// The test runs the EXPORTED production SQL (adminext.SQLPlatformRevenue and
// friends), not a copy, so the queries under test cannot drift from the ones the
// console serves.
//
// EVERYTHING RUNS IN A ROLLED-BACK TRANSACTION. commission_earnings carries an
// append-only trigger (commission_earnings_immutable) that forbids UPDATE and
// DELETE, so an inserted earnings row could not be cleaned up afterwards — it
// would pollute the shared dev database permanently and skew this very summary.
// A transaction is the only safe way to exercise it.
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL, which the root .env
// points at the production pooler and this test INSERTs (see
// scripts/ci/check-live-db-gate.sh).
//
// Bring-up:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_FinanceSummary -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/crowdfunding/adminext"
)

func TestLiveDB_FinanceSummaryReportsBookedRevenueNotAPercentageOfGmv(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	// Rollback, always. See the header: commission_earnings cannot be cleaned up.
	t.Cleanup(func() {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			t.Errorf("rollback: %v (fixture rows may have been committed)", err)
		}
	})

	revenue := func(step string) int64 {
		t.Helper()
		var v int64
		if err := tx.QueryRow(ctx, adminext.SQLPlatformRevenue).Scan(&v); err != nil {
			t.Fatalf("%s: platform revenue: %v", step, err)
		}
		return v
	}
	gaps := func(step string) (int, int64) {
		t.Helper()
		var n int
		var gross int64
		if err := tx.QueryRow(ctx, adminext.SQLReconciliationGaps).Scan(&n, &gross); err != nil {
			t.Fatalf("%s: reconciliation: %v", step, err)
		}
		return n, gross
	}

	baseRevenue := revenue("baseline")
	baseGaps, baseGross := gaps("baseline")

	// A released contribution whose revenue was never booked — exactly what
	// recordCommissionSafe leaves behind when the registry write fails, which it
	// is designed to swallow so it can never reverse a release.
	const grossKobo int64 = 500_000   // ₦5,000
	const bookedKobo int64 = 50_000   // ₦500 = the real 10% platform fee
	const oldFormula = grossKobo / 40 // ₦125 — what the removed 2.5% assumption produced

	creator := uuid.NewString()
	contributor := uuid.NewString()
	campaign := uuid.NewString()
	contribution := uuid.NewString()

	for _, u := range []string{creator, contributor} {
		if _, err := tx.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')`, u, "cf-fin-"+u+"@test.local"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, deadline)
		VALUES ($1, $2, 'Finance summary fixture', 1000000, 'active', NOW() + INTERVAL '30 days')`,
		campaign, creator); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO contributions (id, campaign_id, contributor_id, amount_kobo, status, idempotency_key)
		VALUES ($1, $2, $3, $4, 'released', $5)`,
		contribution, campaign, contributor, grossKobo, "cf-fin-"+contribution); err != nil {
		t.Fatalf("seed contribution: %v", err)
	}

	t.Run("an unbooked release is a reconciliation gap", func(t *testing.T) {
		n, gross := gaps("after unbooked release")
		if n != baseGaps+1 {
			t.Errorf("reconciliation gaps = %d, want %d — a released contribution with no earnings row must be counted", n, baseGaps+1)
		}
		if gross != baseGross+grossKobo {
			t.Errorf("unbooked gross = %d, want %d", gross, baseGross+grossKobo)
		}
	})

	t.Run("revenue does not move with GMV", func(t *testing.T) {
		// The kill shot for the old implementation: GMV just grew by ₦5,000 and
		// revenue must not have grown at all, because nothing was booked.
		if got := revenue("after unbooked release"); got != baseRevenue {
			t.Errorf("platform revenue moved with GMV: got %d, want %d unchanged — revenue must be read from the registry, not derived from contributions", got, baseRevenue)
		}
	})

	// Now book the earning the way commission.RecordFor does: source_module
	// 'crowdfunding', source_ref = the contribution id.
	if _, err := tx.Exec(ctx, `
		INSERT INTO commission_earnings
		  (service_category, service, gross_amount_kobo, commission_kobo, spotlight_revenue_kobo,
		   source_module, source_ref, idempotency_key)
		VALUES ('Community', 'Crowdfunding', $1, $2, $2, 'crowdfunding', $3, $4)`,
		grossKobo, bookedKobo, contribution, "cf-fin-"+contribution); err != nil {
		t.Fatalf("book earning: %v", err)
	}

	t.Run("booking the earning closes the gap and raises revenue", func(t *testing.T) {
		n, gross := gaps("after booking")
		if n != baseGaps {
			t.Errorf("reconciliation gaps = %d, want %d — booking the revenue must close the gap", n, baseGaps)
		}
		if gross != baseGross {
			t.Errorf("unbooked gross = %d, want %d", gross, baseGross)
		}

		got := revenue("after booking")
		if got != baseRevenue+bookedKobo {
			t.Errorf("platform revenue = %d, want %d (the booked amount)", got, baseRevenue+bookedKobo)
		}
		// Belt and braces: pin that the removed formula cannot produce this. If
		// someone reinstates a percentage of GMV, these two diverge by 4x.
		if got == baseRevenue+oldFormula {
			t.Errorf("platform revenue matches the removed gmv/40 assumption (%d) instead of the booked %d", oldFormula, bookedKobo)
		}
	})
}

// TestLiveDB_FinanceSummaryDemoRowsAreCounted pins the provenance flag that lets
// the console say which half of the page is seed data. cf_refunds and
// cf_settlements have exactly one writer in the repository — the seed block in
// migration 20260622050000 — so every row an operator sees under those headings
// is a fixture, and the page used to render them beside live GMV in identical
// styling.
func TestLiveDB_FinanceSummaryDemoRowsAreCounted(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	t.Cleanup(func() {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			t.Errorf("rollback: %v", err)
		}
	})

	counts := func(step string) (int, int) {
		t.Helper()
		var r, s int
		if err := tx.QueryRow(ctx, adminext.SQLDemoRowCounts).Scan(&r, &s); err != nil {
			t.Fatalf("%s: demo counts: %v", step, err)
		}
		return r, s
	}

	baseRefunds, baseSettlements := counts("baseline")

	// A real refund inserts with the FALSE default and must NOT be labelled.
	if _, err := tx.Exec(ctx, `
		INSERT INTO cf_refunds (reference, campaign_title, contributor_name, amount_kobo, status)
		VALUES ('TEST-RF-REAL', 'Real campaign', 'Real contributor', 100000, 'REQUESTED')`); err != nil {
		t.Fatalf("insert real refund: %v", err)
	}
	if r, _ := counts("after a real refund"); r != baseRefunds {
		t.Errorf("a refund inserted with the default was counted as demo: got %d, want %d — the DEFAULT must be FALSE so a future pipeline is live without touching this code", r, baseRefunds)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO cf_refunds (reference, campaign_title, contributor_name, amount_kobo, status, is_demo)
		VALUES ('TEST-RF-DEMO', 'Seeded campaign', 'Seeded contributor', 100000, 'REQUESTED', TRUE)`); err != nil {
		t.Fatalf("insert demo refund: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO cf_settlements (reference, payout_count, gross_kobo, fee_kobo, net_kobo, status, is_demo)
		VALUES ('TEST-STL-DEMO', 1, 100000, 10000, 90000, 'SETTLED', TRUE)`); err != nil {
		t.Fatalf("insert demo settlement: %v", err)
	}

	r, s := counts("after demo rows")
	if r != baseRefunds+1 {
		t.Errorf("demo refund rows = %d, want %d", r, baseRefunds+1)
	}
	if s != baseSettlements+1 {
		t.Errorf("demo settlement rows = %d, want %d", s, baseSettlements+1)
	}

	// The rows seeded by 20260622050000 must be labelled, or the banner claims the
	// page is live when it is not.
	var seeded int
	if err := tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM cf_refunds WHERE reference IN ('SPL-RF-7001','SPL-RF-7002','SPL-RF-6990') AND NOT is_demo`).
		Scan(&seeded); err != nil {
		t.Fatalf("check seeded rows: %v", err)
	}
	if seeded != 0 {
		t.Errorf("%d seeded refund row(s) are not marked is_demo — the backfill in 20270191000000 missed them", seeded)
	}
}

// TestLiveDB_FinanceSummaryFailsLoudly is the regression for the discarded
// errors. GetFinanceSummary used to swallow every query error, so a database
// that could not answer produced a summary of zeros and a nil error — which the
// console rendered as a page of clean ₦0 figures. A cancelled context is the
// deterministic way to make every query fail at once.
//
// It reads only; nothing is written, so it needs no transaction.
func TestLiveDB_FinanceSummaryFailsLoudlyWhenTheDatabaseCannotAnswer(t *testing.T) {
	pool := liveDBPool(t)
	svc := adminext.NewService(pool)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	got, err := svc.GetFinanceSummary(ctx)
	if err == nil {
		t.Fatalf("GetFinanceSummary returned no error on a dead context; summary = %+v — zeros must never be presented as measurements", got)
	}
	if got != nil {
		t.Errorf("GetFinanceSummary returned a summary alongside an error: %+v", got)
	}
}
