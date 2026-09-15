package healthvet

// Live-DB regression for the patient appointment-history read the mobile Vet
// module calls (getAppointments()) but which had no backend route at all
// until now:
//   GET /health/vet/appointments  (patient's own appointment history, ListAppointmentsForPatient)
//
// Previously 404ed unconditionally — this pins that the service method behind
// the new route actually returns real rows, correctly scoped.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func listAppointmentsLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping vet list-appointments live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedVetTestUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed user %s: %v", id, err)
	}
	testsupport.CleanupUser(t, pool, id)
}

func seedVetProvider(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status)
		 VALUES ($1,$2,'VET','vet','List Appointments Test Vet','APPROVED')`, id, ownerID); err != nil {
		t.Fatalf("seed vet provider: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM health_providers WHERE id=$1`, id)
	})
	return id
}

func seedVetService(t *testing.T, ctx context.Context, pool *pgxpool.Pool, providerID string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO vet_services (id, provider_id, name, visit_type, price_kobo) VALUES ($1,$2,'Checkup','TELE',500000)`,
		id, providerID); err != nil {
		t.Fatalf("seed vet service: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM vet_services WHERE id=$1`, id)
	})
	return id
}

func seedVetPet(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO pets (id, owner_user_id, name, species) VALUES ($1,$2,'Rex','DOG')`, id, ownerID); err != nil {
		t.Fatalf("seed pet: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM pets WHERE id=$1`, id)
	})
	return id
}

// seedVetAppointment inserts a health_appointments row (patient_id=patientID)
// joined 1:1 with a vet_appointment_payments row (owner_id=patientID), the
// same shape load()/ListAppointmentsForPatient join over.
func seedVetAppointment(t *testing.T, ctx context.Context, pool *pgxpool.Pool, patientID, providerID, petID, serviceID string) string {
	t.Helper()
	apptID := uuid.New().String()
	now := time.Now()
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_appointments (id, provider_id, patient_id, visit_type, state, slot_start, slot_end)
		 VALUES ($1,$2,$3,'TELE','REQUESTED',$4,$5)`,
		apptID, providerID, patientID, now.Add(time.Hour), now.Add(2*time.Hour)); err != nil {
		t.Fatalf("seed appointment: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM health_appointments WHERE id=$1`, apptID)
	})
	// service_id mirrors the real Book() path, which always pins a valid,
	// active vet_services row before inserting the payment leg.
	if _, err := pool.Exec(ctx,
		`INSERT INTO vet_appointment_payments (appointment_id, owner_id, provider_id, pet_id, service_id, visit_type, total_kobo, idempotency_key)
		 VALUES ($1,$2,$3,$4,$5,'TELE',500000,$6)`,
		apptID, patientID, providerID, petID, serviceID, "idem-"+apptID); err != nil {
		t.Fatalf("seed appointment payment: %v", err)
	}
	return apptID
}

func TestLiveDB_ListAppointmentsForPatient_ScopedToCaller(t *testing.T) {
	pool := listAppointmentsLivePool(t)
	ctx := context.Background()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	patient := uuid.New().String()
	other := uuid.New().String()
	vetOwner := uuid.New().String()
	seedVetTestUser(t, ctx, pool, patient)
	seedVetTestUser(t, ctx, pool, other)
	seedVetTestUser(t, ctx, pool, vetOwner)
	providerID := seedVetProvider(t, ctx, pool, vetOwner)
	serviceID := seedVetService(t, ctx, pool, providerID)

	minePet := seedVetPet(t, ctx, pool, patient)
	notMinePet := seedVetPet(t, ctx, pool, other)

	mine := seedVetAppointment(t, ctx, pool, patient, providerID, minePet, serviceID)
	seedVetAppointment(t, ctx, pool, other, providerID, notMinePet, serviceID)

	got, err := svc.ListAppointmentsForPatient(ctx, patient)
	if err != nil {
		t.Fatalf("ListAppointmentsForPatient: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d appointments, want exactly 1 (the caller's own)", len(got))
	}
	if got[0].ID != mine {
		t.Errorf("returned appointment %s, want the caller's own appointment %s", got[0].ID, mine)
	}
	if got[0].OwnerID != patient {
		t.Errorf("OwnerID = %q, want %q", got[0].OwnerID, patient)
	}
}

// A patient with no appointments yet must get an empty list, not an error or
// null — the exact shape mismatch that crashed the mobile lab tests client
// (see health/lab's ListOrdersForPatient regression).
func TestLiveDB_ListAppointmentsForPatient_EmptyIsEmptyNotNil(t *testing.T) {
	pool := listAppointmentsLivePool(t)
	ctx := context.Background()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	got, err := svc.ListAppointmentsForPatient(ctx, uuid.New().String())
	if err != nil {
		t.Fatalf("ListAppointmentsForPatient: %v", err)
	}
	if got == nil {
		t.Error("got nil slice, want a non-nil empty slice so the handler serialises [] rather than null")
	}
	if len(got) != 0 {
		t.Errorf("got %d appointments for a brand-new patient id, want 0", len(got))
	}
}
