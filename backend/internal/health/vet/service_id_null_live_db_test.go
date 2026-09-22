package healthvet

// ---------------------------------------------------------------------------
// LIVE-DB regression: vet_appointment_payments.service_id is a nullable FK to
// vet_services with ON DELETE SET NULL — deleting a vet_services row (not the
// existing AdminDeactivateService soft-delete, but a direct row delete) nulls
// out service_id on every historical appointment that referenced it.
// Appointment.ServiceID was a plain string, so load() (used by Get/Accept/
// Confirm/Cancel/...) failed the scan with "cannot scan NULL into *string" —
// every future read of that appointment 500s. Fixed by making ServiceID a
// *string, matching EscrowID/ConsultID/DeliveryRef.
//
// Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func vetServiceIDNullPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping vet service_id-null live-DB test")
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

func TestLiveDB_Get_TolerateNullServiceIDAfterServiceDeletion(t *testing.T) {
	ctx := context.Background()
	pool := vetServiceIDNullPool(t)
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	ownerID := uuid.New().String()
	vetOwnerID := uuid.New().String()
	providerID := uuid.New().String()
	petID := uuid.New().String()
	serviceID := uuid.New().String()
	apptID := uuid.New().String()
	payID := uuid.New().String()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, ownerID, ownerID+"@seed.test")
	testsupport.CleanupUser(t, pool, ownerID)
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, vetOwnerID, vetOwnerID+"@seed.test")
	testsupport.CleanupUser(t, pool, vetOwnerID)
	seed(`INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status)
	      VALUES ($1,$2,'VET','vet','Seed Vet Clinic','APPROVED')`, providerID, vetOwnerID)
	seed(`INSERT INTO public.pets (id, owner_user_id, name, species) VALUES ($1,$2,'Fixture Pet','DOG')`, petID, ownerID)
	seed(`INSERT INTO public.vet_services (id, provider_id, name, visit_type, price_kobo, active)
	      VALUES ($1,$2,'Fixture Service','CLINIC',500000,true)`, serviceID, providerID)
	seed(`INSERT INTO public.health_appointments (id, provider_id, patient_id, subject_type, visit_type, state, slot_start, slot_end)
	      VALUES ($1,$2,$3,'PET','CLINIC','REQUESTED', now(), now() + interval '30 minutes')`, apptID, providerID, ownerID)
	seed(`INSERT INTO public.vet_appointment_payments
	        (id, appointment_id, owner_id, provider_id, pet_id, service_id, visit_type, total_kobo, pay_state, idempotency_key)
	      VALUES ($1,$2,$3,$4,$5,$6,'CLINIC',500000,'HELD',$7)`,
		payID, apptID, ownerID, providerID, petID, serviceID, "vet-svc-null-test:"+apptID)

	// Fire the FK's ON DELETE SET NULL: delete the vet_services row directly
	// (not AdminDeactivateService's soft-delete) — vet_appointment_payments.service_id
	// is now NULL on this historical appointment.
	seed(`DELETE FROM public.vet_services WHERE id=$1`, serviceID)

	appt, err := svc.Get(ctx, ownerID, apptID, false)
	if err != nil {
		t.Fatalf("Get must not fail when the referenced service was deleted: %v", err)
	}
	if appt.ServiceID != nil {
		t.Errorf("ServiceID = %q, want nil after the vet_services row was deleted", *appt.ServiceID)
	}
}
