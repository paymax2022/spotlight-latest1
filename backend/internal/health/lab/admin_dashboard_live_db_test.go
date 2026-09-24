package healthlab_test

// ---------------------------------------------------------------------------
// LIVE-DB coverage for the Laboratory (Module 16) admin-portal gap closure:
// GET /admin/dashboard (order-state aggregate + trailing-7-day platform
// revenue + APPROVED-lab count, mirroring PHARMACY-001's AdminDashboard
// exactly), and the AdminCustodyAudit sample_id filter added so the admin
// console's per-sample custody-chain drawer can reuse the existing
// custody-audit query instead of a second read path.
//
// Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	healthlab "spotlight/backend/internal/health/lab"
	"spotlight/backend/internal/testsupport"
)

func adminDashboardPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping lab admin-dashboard live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

type labAdminFixture struct {
	svc                     *healthlab.Service
	pool                    *pgxpool.Pool
	owner, patient, phlebo  string
	lab                     string
	scheduledID, releasedID string
	closedID                string
	sampleID                string
}

// newLabAdminFixture seeds one APPROVED lab and three orders in DISTINCT,
// known states so the dashboard's per-state counts have an unambiguous,
// assertable baseline, plus one sample with two custody events so the
// sample_id filter has something real to narrow.
func newLabAdminFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) labAdminFixture {
	t.Helper()
	f := labAdminFixture{
		// Every admin read here is read-only — none of the write-path
		// collaborators (escrow, dispatch, provider gate, payout, notifier,
		// vault, audit) participate, so nil is honest (mirrors
		// seedAdminQueryFixture in admin_query_live_db_test.go).
		svc:  healthlab.NewService(pool, nil, nil, nil, nil, nil, nil, nil),
		pool: pool,

		owner: uuid.New().String(), patient: uuid.New().String(), phlebo: uuid.New().String(),
		lab:         uuid.New().String(),
		scheduledID: uuid.New().String(), releasedID: uuid.New().String(), closedID: uuid.New().String(),
		sampleID: uuid.New().String(),
	}
	for _, u := range []string{f.owner, f.patient, f.phlebo} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	// provider_type='lab' (the business entity) — the EXACT predicate
	// AdminDashboard.TotalLabs and labProviderGateAdapter.IsApprovedLab
	// (health_lab_routes.go) both use. A 'lab_scientist'/'phlebotomist'
	// capability row here would silently never be counted.
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		 VALUES ($1,$2,'LAB','lab',$3,'APPROVED')`,
		f.lab, f.owner, "Admin Fixture Lab"); err != nil {
		t.Fatalf("seed provider: %v", err)
	}

	orders := []struct {
		id, state, method string
		totalKobo         int64
	}{
		{f.scheduledID, "SCHEDULED", "HOME", 150000},
		{f.releasedID, "RELEASED", "WALK_IN", 350000},
		{f.closedID, "CLOSED", "WALK_IN", 75000},
	}
	for _, o := range orders {
		if _, err := pool.Exec(ctx,
			`INSERT INTO lab_orders (id, patient_id, lab_provider_id, state, collection_method, total_kobo, idempotency_key)
			 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			o.id, f.patient, f.lab, o.state, o.method, o.totalKobo, "idem-labadmin-"+o.id); err != nil {
			t.Fatalf("seed order %s: %v", o.id, err)
		}
	}

	// One sample on the scheduled order with two custody events, so the
	// sample_id filter (AdminCustodyAudit's new second parameter) has a real,
	// assertable, narrower result than the unfiltered lab-scoped read.
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_samples (id, order_id, state, collection_method, barcode_ref, collected_by)
		 VALUES ($1,$2,'COLLECTED','HOME','BC-ADMIN-DASH-UAT',$3)`,
		f.sampleID, f.scheduledID, f.phlebo); err != nil {
		t.Fatalf("seed sample: %v", err)
	}
	for _, ev := range []struct{ from, to string }{
		{"", "COLLECTED"},
		{"COLLECTED", "IN_CUSTODY"},
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO lab_custody_events (sample_id, from_state, to_state, actor_id, note)
			 VALUES ($1,$2,$3,$4,'admin-dashboard live-db fixture')`,
			f.sampleID, ev.from, ev.to, f.phlebo); err != nil {
			t.Fatalf("seed custody event %s->%s: %v", ev.from, ev.to, err)
		}
	}

	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM lab_custody_events WHERE sample_id=$1`, f.sampleID)
		pool.Exec(bg, `DELETE FROM lab_samples WHERE id=$1`, f.sampleID)
		pool.Exec(bg, `DELETE FROM lab_orders WHERE id IN ($1,$2,$3)`, f.scheduledID, f.releasedID, f.closedID)
		pool.Exec(bg, `DELETE FROM health_providers WHERE id = $1`, f.lab)
	})
	return f
}

// TestLiveDB_AdminDashboard_CountsAndTotalsAreExact seeds a KNOWN set of
// orders and asserts the dashboard's per-state counts / total include exactly
// those rows (>=, since the shared DB may carry rows from other tests/
// fixtures — the assertion is that OUR rows are correctly counted, not that
// we own the whole table) and that every OrderState key is present even at
// zero. Mirrors PHARMACY-001's TestLiveDB_AdminDashboard_CountsAndTotalsAreExact.
func TestLiveDB_AdminDashboard_CountsAndTotalsAreExact(t *testing.T) {
	pool := adminDashboardPool(t)
	ctx := context.Background()

	svc := healthlab.NewService(pool, nil, nil, nil, nil, nil, nil, nil)

	before, err := svc.AdminDashboard(ctx)
	if err != nil {
		t.Fatalf("AdminDashboard (baseline): %v", err)
	}
	beforeScheduled := before.OrdersByState["SCHEDULED"]
	beforeReleased := before.OrdersByState["RELEASED"]
	beforeClosed := before.OrdersByState["CLOSED"]
	beforeTotal := before.TotalOrders
	beforeLabs := before.TotalLabs

	// Seed AFTER the baseline read so we know exactly what this fixture added.
	f := newLabAdminFixture(t, ctx, pool)
	_ = f

	after, err := svc.AdminDashboard(ctx)
	if err != nil {
		t.Fatalf("AdminDashboard: %v", err)
	}

	if got, want := after.OrdersByState["SCHEDULED"], beforeScheduled+1; got != want {
		t.Errorf("SCHEDULED count = %d, want %d", got, want)
	}
	if got, want := after.OrdersByState["RELEASED"], beforeReleased+1; got != want {
		t.Errorf("RELEASED count = %d, want %d", got, want)
	}
	if got, want := after.OrdersByState["CLOSED"], beforeClosed+1; got != want {
		t.Errorf("CLOSED count = %d, want %d", got, want)
	}
	if got, want := after.TotalOrders, beforeTotal+3; got != want {
		t.Errorf("TotalOrders = %d, want %d", got, want)
	}
	// Every documented OrderState must be present in the map (even 0), so the
	// admin console can render a complete breakdown.
	for _, st := range []string{"CREATED", "SCHEDULED", "SAMPLE_COLLECTED", "IN_TRANSIT", "ACCESSIONED",
		"PROCESSING", "RESULT_READY", "ESCALATED", "RELEASED", "CLOSED", "CANCELLED", "REFUNDED"} {
		if _, ok := after.OrdersByState[st]; !ok {
			t.Errorf("OrdersByState missing key %q", st)
		}
	}
	// TotalLabs must include the ONE APPROVED lab this fixture seeded.
	if got, want := after.TotalLabs, beforeLabs+1; got != want {
		t.Errorf("TotalLabs = %d, want %d (baseline %d + this fixture's 1 APPROVED lab)", got, want, beforeLabs)
	}
	// PlatformRevenueKoboWeek must never be negative — it is a SUM of
	// non-negative recorded earnings (commission_earnings.spotlight_revenue_kobo
	// CHECK's the column, but assert defensively at this layer too).
	if after.PlatformRevenueKoboWeek < 0 {
		t.Errorf("PlatformRevenueKoboWeek = %d, must be >= 0", after.PlatformRevenueKoboWeek)
	}
}

// TestLiveDB_AdminCustodyAudit_FilterBySampleIDNarrowsToThatSample locks the
// new sample_id parameter: with both a lab_provider_id and a sample_id
// supplied together, the result must be exactly that sample's own events
// (2, seeded above), never the whole lab's custody history and never a
// Postgres uuid/text type error.
func TestLiveDB_AdminCustodyAudit_FilterBySampleIDNarrowsToThatSample(t *testing.T) {
	pool := adminDashboardPool(t)
	ctx := context.Background()
	f := newLabAdminFixture(t, ctx, pool)

	rows, err := f.svc.AdminCustodyAudit(ctx, f.lab, f.sampleID)
	if err != nil {
		t.Fatalf("AdminCustodyAudit(labProviderID, sampleID): %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("AdminCustodyAudit(sample_id=%s) = %d rows, want exactly 2", f.sampleID, len(rows))
	}
	for _, r := range rows {
		if r["sample_id"] != f.sampleID {
			t.Fatalf("row sample_id = %v, want %s (filter leaked another sample)", r["sample_id"], f.sampleID)
		}
		if r["patient_id"] != f.patient {
			t.Fatalf("row patient_id = %v, want %s", r["patient_id"], f.patient)
		}
	}

	// sample_id alone (no lab filter) must also work and return the same 2 rows.
	rowsNoLab, err := f.svc.AdminCustodyAudit(ctx, "", f.sampleID)
	if err != nil {
		t.Fatalf("AdminCustodyAudit(sampleID only): %v", err)
	}
	if len(rowsNoLab) != 2 {
		t.Fatalf("AdminCustodyAudit(sample_id only) = %d rows, want exactly 2", len(rowsNoLab))
	}

	// A different (real, but non-matching) sample id must return zero rows,
	// not error and not return this fixture's events.
	other := uuid.New().String()
	rowsOther, err := f.svc.AdminCustodyAudit(ctx, f.lab, other)
	if err != nil {
		t.Fatalf("AdminCustodyAudit with a non-matching sample_id must not error: %v", err)
	}
	if len(rowsOther) != 0 {
		t.Fatalf("AdminCustodyAudit(sample_id=%s) = %d rows, want 0", other, len(rowsOther))
	}
}
