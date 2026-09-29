package healthvet

// ---------------------------------------------------------------------------
// LIVE-DB regression guard for VET-3: a latent NULL service_id crash risk
// found (but not fixed) in a prior session, spun off as task_a86ef5d8. The
// bug is still live going into this pass — confirmed by re-reading the code.
//
// vet_appointment_payments.service_id is ON DELETE SET NULL against
// vet_services, but Appointment.ServiceID was a plain (non-pointer) string.
// If a vet_services row is ever hard-deleted after an appointment referenced
// it, the FK sets service_id NULL and pgx fails "cannot scan NULL into
// *string" on the very next read of that appointment — both the single
// load()/Get() path AND ListAppointmentsForPatient (where one bad row fails
// the whole list, per the same bug class documented in the pharmacy catalog
// query's own comment).
//
// Fixed by making Appointment.ServiceID *string (matching EscrowID/
// ConsultID/DeliveryRef already on the same struct) — the pgx scan call
// sites needed no change, since Scan(&a.ServiceID) already works for a
// nullable column once the field itself is a pointer.
//
// Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// seedVetAppointmentWithNullService is identical to seedVetAppointment except
// it seeds a vet_services row, uses it, and then HARD-DELETES it — exactly
// the scenario the ON DELETE SET NULL FK exists to survive.
func seedVetAppointmentWithNullService(t *testing.T, ctx context.Context, pool *pgxpool.Pool, patientID, providerID, petID string) string {
	t.Helper()
	serviceID := seedVetService(t, ctx, pool, providerID)
	apptID := seedVetAppointment(t, ctx, pool, patientID, providerID, petID, serviceID)

	// Hard-delete the service AFTER the appointment references it — the FK's
	// ON DELETE SET NULL fires, leaving vet_appointment_payments.service_id
	// NULL for this row while every other column stays intact.
	if _, err := pool.Exec(ctx, `DELETE FROM vet_services WHERE id=$1`, serviceID); err != nil {
		t.Fatalf("hard-delete vet_services row: %v", err)
	}
	var nullCheck *string
	if err := pool.QueryRow(ctx, `SELECT service_id FROM vet_appointment_payments WHERE appointment_id=$1`, apptID).Scan(&nullCheck); err != nil {
		t.Fatalf("verify service_id went NULL: %v", err)
	}
	if nullCheck != nil {
		t.Fatalf("service_id = %v after deleting the referenced vet_services row, want NULL (ON DELETE SET NULL not firing?)", *nullCheck)
	}
	return apptID
}

func TestLiveDB_Get_SurvivesNullServiceID(t *testing.T) {
	pool := listAppointmentsLivePool(t)
	ctx := context.Background()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	patient := uuid.New().String()
	vetOwner := uuid.New().String()
	seedVetTestUser(t, ctx, pool, patient)
	seedVetTestUser(t, ctx, pool, vetOwner)
	providerID := seedVetProvider(t, ctx, pool, vetOwner)
	petID := seedVetPet(t, ctx, pool, patient)

	apptID := seedVetAppointmentWithNullService(t, ctx, pool, patient, providerID, petID)

	appt, err := svc.Get(ctx, patient, apptID, false)
	if err != nil {
		t.Fatalf("Get on an appointment with a hard-deleted service: %v (this is the exact 'cannot scan NULL into *string' crash VET-3 flags)", err)
	}
	if appt.ServiceID != nil {
		t.Errorf("ServiceID = %v, want nil after the referenced vet_services row was hard-deleted", *appt.ServiceID)
	}
}

func TestLiveDB_ListAppointmentsForPatient_OneNullServiceIDDoesNotFailWholeList(t *testing.T) {
	pool := listAppointmentsLivePool(t)
	ctx := context.Background()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	patient := uuid.New().String()
	vetOwner := uuid.New().String()
	seedVetTestUser(t, ctx, pool, patient)
	seedVetTestUser(t, ctx, pool, vetOwner)
	providerID := seedVetProvider(t, ctx, pool, vetOwner)
	petID := seedVetPet(t, ctx, pool, patient)

	// One appointment with an intact service, one whose service was later
	// hard-deleted — the list must return BOTH, not fail entirely on the
	// second (the "one bad row 500s the whole catalog" bug class).
	serviceID := seedVetService(t, ctx, pool, providerID)
	normal := seedVetAppointment(t, ctx, pool, patient, providerID, petID, serviceID)
	nulled := seedVetAppointmentWithNullService(t, ctx, pool, patient, providerID, petID)

	got, err := svc.ListAppointmentsForPatient(ctx, patient)
	if err != nil {
		t.Fatalf("ListAppointmentsForPatient with one NULL-service row present: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d appointments, want 2 (one NULL-service row must not hide the other)", len(got))
	}
	byID := map[string]*Appointment{}
	for i := range got {
		byID[got[i].ID] = &got[i]
	}
	if byID[normal] == nil || byID[normal].ServiceID == nil || *byID[normal].ServiceID != serviceID {
		t.Errorf("normal appointment's ServiceID missing or wrong: %+v", byID[normal])
	}
	if byID[nulled] == nil || byID[nulled].ServiceID != nil {
		t.Errorf("hard-deleted-service appointment's ServiceID should be nil, got %+v", byID[nulled])
	}
}
