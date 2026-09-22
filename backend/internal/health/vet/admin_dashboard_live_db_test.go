package healthvet_test

// ---------------------------------------------------------------------------
// LIVE-DB coverage for the Veterinary (Module 17) admin-portal gap closure:
// GET /admin/dashboard (appointment-state aggregate + trailing-7-day platform
// revenue + APPROVED-vet count, mirroring Lab's own AdminDashboard fix and
// PHARMACY-001's AdminDashboard exactly).
//
// Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	healthvet "spotlight/backend/internal/health/vet"
	"spotlight/backend/internal/testsupport"
)

func vetAdminDashboardPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping vet admin-dashboard live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

type vetAdminFixture struct {
	owner, patient, other string
	provider               string
	serviceID              string
	requestedID, completedID, cancelledID string
}

// newVetAdminFixture seeds one APPROVED vet provider and three appointments
// in DISTINCT, known states (REQUESTED/COMPLETED/CANCELLED) so the
// dashboard's per-state counts have an unambiguous, assertable baseline.
// Mirrors newLabAdminFixture (admin_dashboard_live_db_test.go, healthlab).
func newVetAdminFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) vetAdminFixture {
	t.Helper()
	f := vetAdminFixture{
		owner: uuid.New().String(), patient: uuid.New().String(), other: uuid.New().String(),
		requestedID: uuid.New().String(), completedID: uuid.New().String(), cancelledID: uuid.New().String(),
	}
	for _, u := range []string{f.owner, f.patient, f.other} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}

	// provider_type='vet' (the business entity) — the EXACT predicate
	// AdminDashboard.TotalVets and vetProviderGateAdapter.IsApprovedVet
	// (health_vet_routes.go) both use.
	f.provider = uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		 VALUES ($1,$2,'VET','vet',$3,'APPROVED')`,
		f.provider, f.owner, "Admin Dashboard Fixture Vet"); err != nil {
		t.Fatalf("seed provider: %v", err)
	}

	f.serviceID = uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO vet_services (id, provider_id, name, visit_type, price_kobo) VALUES ($1,$2,'Checkup','TELE',500000)`,
		f.serviceID, f.provider); err != nil {
		t.Fatalf("seed service: %v", err)
	}

	petID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO pets (id, owner_user_id, name, species) VALUES ($1,$2,'Rex','DOG')`, petID, f.patient); err != nil {
		t.Fatalf("seed pet: %v", err)
	}

	now := time.Now()
	appts := []struct {
		id, state string
	}{
		{f.requestedID, "REQUESTED"},
		{f.completedID, "COMPLETED"},
		{f.cancelledID, "CANCELLED"},
	}
	for _, a := range appts {
		if _, err := pool.Exec(ctx,
			`INSERT INTO health_appointments (id, provider_id, patient_id, visit_type, state, slot_start, slot_end)
			 VALUES ($1,$2,$3,'TELE',$4,$5,$6)`,
			a.id, f.provider, f.patient, a.state, now.Add(time.Hour), now.Add(2*time.Hour)); err != nil {
			t.Fatalf("seed appointment %s: %v", a.id, err)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO vet_appointment_payments (appointment_id, owner_id, provider_id, pet_id, service_id, visit_type, total_kobo, idempotency_key)
			 VALUES ($1,$2,$3,$4,$5,'TELE',500000,$6)`,
			a.id, f.patient, f.provider, petID, f.serviceID, "idem-vetadmin-"+a.id); err != nil {
			t.Fatalf("seed appointment payment %s: %v", a.id, err)
		}
	}

	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM vet_appointment_payments WHERE appointment_id IN ($1,$2,$3)`,
			f.requestedID, f.completedID, f.cancelledID)
		pool.Exec(bg, `DELETE FROM health_appointments WHERE id IN ($1,$2,$3)`,
			f.requestedID, f.completedID, f.cancelledID)
		pool.Exec(bg, `DELETE FROM pets WHERE id=$1`, petID)
		pool.Exec(bg, `DELETE FROM vet_services WHERE id=$1`, f.serviceID)
		pool.Exec(bg, `DELETE FROM health_providers WHERE id=$1`, f.provider)
	})
	return f
}

// TestLiveDB_AdminDashboard_CountsAndTotalsAreExact seeds a KNOWN set of
// appointments and asserts the dashboard's per-state counts / total include
// exactly those rows (>=, since the shared DB may carry rows from other
// tests/fixtures — the assertion is that OUR rows are correctly counted, not
// that we own the whole table) and that every ApptState key is present even
// at zero. Mirrors healthlab's TestLiveDB_AdminDashboard_CountsAndTotalsAreExact.
func TestLiveDB_AdminDashboard_CountsAndTotalsAreExact(t *testing.T) {
	pool := vetAdminDashboardPool(t)
	ctx := context.Background()

	svc := healthvet.NewService(pool, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	before, err := svc.AdminDashboard(ctx)
	if err != nil {
		t.Fatalf("AdminDashboard (baseline): %v", err)
	}
	beforeRequested := before.AppointmentsByState["REQUESTED"]
	beforeCompleted := before.AppointmentsByState["COMPLETED"]
	beforeCancelled := before.AppointmentsByState["CANCELLED"]
	beforeTotal := before.TotalAppointments
	beforeVets := before.TotalVets

	// Seed AFTER the baseline read so we know exactly what this fixture added.
	f := newVetAdminFixture(t, ctx, pool)
	_ = f

	after, err := svc.AdminDashboard(ctx)
	if err != nil {
		t.Fatalf("AdminDashboard: %v", err)
	}

	if got, want := after.AppointmentsByState["REQUESTED"], beforeRequested+1; got != want {
		t.Errorf("REQUESTED count = %d, want %d", got, want)
	}
	if got, want := after.AppointmentsByState["COMPLETED"], beforeCompleted+1; got != want {
		t.Errorf("COMPLETED count = %d, want %d", got, want)
	}
	if got, want := after.AppointmentsByState["CANCELLED"], beforeCancelled+1; got != want {
		t.Errorf("CANCELLED count = %d, want %d", got, want)
	}
	if got, want := after.TotalAppointments, beforeTotal+3; got != want {
		t.Errorf("TotalAppointments = %d, want %d", got, want)
	}
	// Every documented ApptState must be present in the map (even 0), so the
	// admin console can render a complete breakdown.
	for _, st := range []string{"REQUESTED", "ACCEPTED", "CONFIRMED", "IN_PROGRESS", "COMPLETED",
		"CANCELLED", "NO_SHOW", "RESCHEDULED"} {
		if _, ok := after.AppointmentsByState[st]; !ok {
			t.Errorf("AppointmentsByState missing key %q", st)
		}
	}
	// TotalVets must include the ONE APPROVED vet this fixture seeded.
	if got, want := after.TotalVets, beforeVets+1; got != want {
		t.Errorf("TotalVets = %d, want %d (baseline %d + this fixture's 1 APPROVED vet)", got, want, beforeVets)
	}
	// PlatformRevenueKoboWeek must never be negative — it is a SUM of
	// non-negative recorded earnings (commission_earnings.spotlight_revenue_kobo
	// CHECK's the column, but assert defensively at this layer too).
	if after.PlatformRevenueKoboWeek < 0 {
		t.Errorf("PlatformRevenueKoboWeek = %d, must be >= 0", after.PlatformRevenueKoboWeek)
	}
}

// TestLiveDB_AdminDashboard_ExcludesNonVetAppointments locks in the join-
// through-vet_appointment_payments scoping: health_appointments is the
// SHARED cross-vertical table (telemedicine/lab/vet all book onto it), so a
// bare COUNT(*) on it would silently include non-vet rows. This seeds one
// health_appointments row with NO vet_appointment_payments leg (simulating a
// different vertical's appointment) and asserts it is never counted.
func TestLiveDB_AdminDashboard_ExcludesNonVetAppointments(t *testing.T) {
	pool := vetAdminDashboardPool(t)
	ctx := context.Background()
	svc := healthvet.NewService(pool, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	before, err := svc.AdminDashboard(ctx)
	if err != nil {
		t.Fatalf("AdminDashboard (baseline): %v", err)
	}
	beforeTotal := before.TotalAppointments

	patient := uuid.New().String()
	provider := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, patient, patient+"@seed.test"); err != nil {
		t.Fatalf("seed patient: %v", err)
	}
	testsupport.CleanupUser(t, pool, patient)
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, provider, provider+"@seed.test"); err != nil {
		t.Fatalf("seed provider user: %v", err)
	}
	testsupport.CleanupUser(t, pool, provider)

	// health_appointments.provider_id FKs to health_providers — the "foreign"
	// (non-vet) appointment still needs a real provider row, just one from a
	// DIFFERENT domain (LAB), so it is a genuine non-vet appointment rather
	// than an orphaned FK violation.
	foreignProviderID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		 VALUES ($1,$2,'LAB','lab',$3,'APPROVED')`,
		foreignProviderID, provider, "Admin Dashboard Fixture Non-Vet Provider"); err != nil {
		t.Fatalf("seed foreign provider: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM health_providers WHERE id=$1`, foreignProviderID)
	})

	foreignApptID := uuid.New().String()
	now := time.Now()
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_appointments (id, provider_id, patient_id, visit_type, state, slot_start, slot_end)
		 VALUES ($1,$2,$3,'TELE','REQUESTED',$4,$5)`,
		foreignApptID, foreignProviderID, patient, now.Add(time.Hour), now.Add(2*time.Hour)); err != nil {
		t.Fatalf("seed foreign appointment: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM health_appointments WHERE id=$1`, foreignApptID)
	})

	after, err := svc.AdminDashboard(ctx)
	if err != nil {
		t.Fatalf("AdminDashboard: %v", err)
	}
	if after.TotalAppointments != beforeTotal {
		t.Errorf("TotalAppointments = %d, want unchanged %d — a non-vet health_appointments row (no vet_appointment_payments leg) leaked into the vet dashboard count",
			after.TotalAppointments, beforeTotal)
	}
}
