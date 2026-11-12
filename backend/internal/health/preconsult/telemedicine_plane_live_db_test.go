package preconsult

// LIVE-DB integration test for the TELEMEDICINE appointment plane of the
// pre-consult intake (ADR-010).
//
// ADR-010 gates a human telemedicine consult on a SUBMITTED intake, and the
// mobile wizard + patient room both ask for it with the id the booking returned.
// That id names a row in `appointments` (internal/telemedicine), not in
// `health_appointments` (internal/health/scheduling), so the intake lookup used
// to answer pgx.ErrNoRows → 404 for every human booking: the wizard dead-ended
// and the consult room's intake gate could never open.
//
// These tests pin the widened contract:
//   - an intake resolves on a telemedicine appointment id, and its link row says
//     which plane it belongs to rather than faking a health_appointments/provider
//     pair that the FKs would reject;
//   - the object-level denials survive the second plane (a foreign patient and an
//     unassigned doctor both still fold to the uniform not-found — the doctor
//     join just comes from `doctors.user_id` now, not from health_consults);
//   - the admin reads, which project appointment_id into non-nullable strings,
//     still decode a row whose health-plane columns are NULL;
//   - submitting on this plane stamps the row SUBMITTED without inventing a
//     health_consults link, which is exactly what the patient consult room's
//     intake gate waits for.
//
// Skipped unless TEST_DATABASE_URL is set, and unless the migration-seeded
// pre-consult schema + consent rows exist. Brings its own fixtures down.
// Bring-up:
//	supabase start
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	go test ./internal/health/preconsult/ -run TestTelemedicinePlane

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

type telemedAppointment struct {
	apptID       string
	patientID    string
	doctorID     string
	doctorUserID string
}

// seedTelemedAppointment creates the rows a paid telemedicine booking leaves
// behind — an auth.users patient, a doctors row owned by another auth.users, and
// one `appointments` row — and registers teardown.
func seedTelemedAppointment(t *testing.T, pool *pgxpool.Pool) telemedAppointment {
	t.Helper()
	ctx := context.Background()
	a := telemedAppointment{
		apptID:       uuid.New().String(),
		patientID:    uuid.New().String(),
		doctorID:     uuid.New().String(),
		doctorUserID: uuid.New().String(),
	}
	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, a.patientID, a.patientID+"@seed.test")
	testsupport.CleanupUser(t, pool, a.patientID)
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, a.doctorUserID, a.doctorUserID+"@seed.test")
	testsupport.CleanupUser(t, pool, a.doctorUserID)
	seed(`INSERT INTO public.doctors (id, user_id, name, consult_fee_kobo) VALUES ($1,$2,$3,1000000)`,
		a.doctorID, a.doctorUserID, "Dr Seed Telemed")
	start := time.Now().UTC().Add(time.Hour)
	seed(`INSERT INTO public.appointments (id, patient_id, doctor_id, scheduled_at, status, fee_kobo, idempotency_key)
	      VALUES ($1,$2,$3,$4,'booked',1000000,$5)`,
		a.apptID, a.patientID, a.doctorID, start, "seed-telemed-"+a.apptID)

	t.Cleanup(func() {
		bg := context.WithoutCancel(ctx)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_preconsult_intake WHERE telemedicine_appointment_id=$1`, a.apptID)
		_, _ = pool.Exec(bg, `DELETE FROM public.appointments WHERE id=$1`, a.apptID)
		_, _ = pool.Exec(bg, `DELETE FROM public.doctors WHERE id=$1`, a.doctorID)
	})
	return a
}

// dbTelemedLink reads the plane columns straight off the link row, so no
// assertion can be satisfied by whatever the service happened to hand back in
// memory.
func dbTelemedLink(t *testing.T, pool *pgxpool.Pool, apptID string) (source string, healthAppt, telemedAppt, provider, doctor *string) {
	t.Helper()
	err := pool.QueryRow(context.Background(),
		`SELECT appointment_source, appointment_id::text, telemedicine_appointment_id::text,
		        provider_id::text, doctor_id::text
		   FROM health_preconsult_intake WHERE telemedicine_appointment_id=$1`, apptID,
	).Scan(&source, &healthAppt, &telemedAppt, &provider, &doctor)
	if err != nil {
		t.Fatalf("read back link row: %v", err)
	}
	return source, healthAppt, telemedAppt, provider, doctor
}

func TestTelemedicinePlaneEnsureIntake_LiveDB(t *testing.T) {
	svc, pool, _ := consentLiveService(t)
	ctx := context.Background()
	a := seedTelemedAppointment(t, pool)

	// 1. The booking id the client already holds resolves — this is the 404.
	it, err := svc.EnsureIntake(ctx, a.patientID, a.apptID)
	if err != nil {
		t.Fatalf("intake on a telemedicine appointment: %v", err)
	}
	if it.AppointmentID != a.apptID {
		t.Fatalf("wire appointment_id should echo the telemedicine id the client used, got %q", it.AppointmentID)
	}
	if it.AppointmentSource != "telemedicine" {
		t.Fatalf("intake should report the telemedicine plane, got %q", it.AppointmentSource)
	}

	// 2. The link row stores the health-plane pair as NULL rather than pretending:
	//    both columns are FK-bound (health_appointments / health_providers, and
	//    health_providers.domain has no doctor value), so any non-NULL write here
	//    would abort the insert.
	source, healthAppt, telemedAppt, provider, doctor := dbTelemedLink(t, pool, a.apptID)
	if source != "telemedicine" {
		t.Fatalf(`appointment_source = %q, want "telemedicine"`, source)
	}
	if healthAppt != nil || provider != nil {
		t.Fatalf("health-plane columns must stay NULL, got appointment_id=%v provider_id=%v", deref(healthAppt), deref(provider))
	}
	if telemedAppt == nil || *telemedAppt != a.apptID {
		t.Fatalf("telemedicine_appointment_id not stored: %v", deref(telemedAppt))
	}
	if doctor == nil || *doctor != a.doctorID {
		t.Fatalf("doctor_id should pin the assigned doctors row, got %v", deref(doctor))
	}

	// 3. Get-or-create: the wizard re-enters on every autosave and on resume, so a
	//    second call must return the same row, not a duplicate (the partial unique
	//    index on telemedicine_appointment_id is what makes a duplicate impossible).
	it2, err := svc.EnsureIntake(ctx, a.patientID, a.apptID)
	if err != nil {
		t.Fatalf("second EnsureIntake: %v", err)
	}
	if it2.ID != it.ID {
		t.Fatalf("intake is not get-or-create: %s then %s", it.ID, it2.ID)
	}

	// 4. The object-level denial survives the new plane: another member asking for
	//    the same appointment gets the uniform not-found, not somebody else's intake.
	if _, err := svc.EnsureIntake(ctx, uuid.New().String(), a.apptID); !errors.Is(err, ErrAppointmentNotFound) {
		t.Fatalf("foreign patient should get ErrAppointmentNotFound, got %v", err)
	}
}

func TestTelemedicinePlaneDoctorSummary_LiveDB(t *testing.T) {
	svc, pool, _ := consentLiveService(t)
	ctx := context.Background()
	a := seedTelemedAppointment(t, pool)

	if _, err := svc.EnsureIntake(ctx, a.patientID, a.apptID); err != nil {
		t.Fatalf("ensure intake: %v", err)
	}

	// The assigned doctor is `appointments.doctor_id` → `doctors.user_id`. There is
	// no health_consults row for a telemedicine booking, so authorizing this read
	// through the consult provider-owner join (the health-plane path) would deny
	// the one doctor who is entitled to the PHI.
	if _, err := svc.GetForDoctor(ctx, a.doctorUserID, a.apptID); err != nil {
		t.Fatalf("assigned doctor denied: %v", err)
	}

	// A doctor who is not on the appointment still folds into the uniform
	// not-found — "forbidden" would confirm the intake exists.
	if _, err := svc.GetForDoctor(ctx, uuid.New().String(), a.apptID); !errors.Is(err, ErrIntakeNotFound) {
		t.Fatalf("unassigned doctor should get ErrIntakeNotFound, got %v", err)
	}
}

func TestTelemedicinePlaneAdminReads_LiveDB(t *testing.T) {
	svc, pool, _ := consentLiveService(t)
	ctx := context.Background()
	a := seedTelemedAppointment(t, pool)

	if _, err := svc.EnsureIntake(ctx, a.patientID, a.apptID); err != nil {
		t.Fatalf("ensure intake: %v", err)
	}
	// A captured red-flag puts the row in the clinical queue as well.
	if _, err := pool.Exec(ctx,
		`UPDATE health_preconsult_intake SET red_flag_severity='urgent', submitted_at=now()
		   WHERE telemedicine_appointment_id=$1`, a.apptID); err != nil {
		t.Fatalf("flag red-flag: %v", err)
	}

	// Both admin queries project appointment_id into a non-nullable string. A
	// telemedicine row leaves that column NULL, so without the plane-aware
	// projection each one either drops the row (the join) or fails the scan.
	rows, err := svc.Monitoring(ctx, false, 120)
	if err != nil {
		t.Fatalf("Monitoring: %v", err)
	}
	var found bool
	for _, r := range rows {
		if r.AppointmentID == a.apptID {
			found = true
			if r.ProviderID != a.doctorID {
				t.Fatalf("monitor row should surface the assigned doctor, got provider_id=%q", r.ProviderID)
			}
			if r.SlotStart.IsZero() {
				t.Fatal("monitor row lost its appointment time — the telemedicine plane has no slot_start")
			}
		}
	}
	if !found {
		t.Fatal("telemedicine intake missing from Monitoring")
	}

	q, err := svc.RedFlagQueue(ctx)
	if err != nil {
		t.Fatalf("RedFlagQueue: %v", err)
	}
	var inQueue bool
	for _, r := range q {
		if r.AppointmentID == a.apptID {
			inQueue = true
		}
	}
	if !inQueue {
		t.Fatal("telemedicine intake missing from RedFlagQueue")
	}
}

// TestTelemedicinePlaneSubmit_LiveDB covers the symptom the consult room showed:
// the gate waits for intake.status === 'SUBMITTED', which a telemedicine
// appointment could never reach while the intake resolved only through
// health_appointments.
func TestTelemedicinePlaneSubmit_LiveDB(t *testing.T) {
	svc, pool, activeVersion := consentLiveService(t)
	ctx := context.Background()
	a := seedTelemedAppointment(t, pool)

	// The three fields the active PRE_CONSULT schema marks required. Numbers
	// arrive as float64 through JSON, which is what the validator checks.
	answers := map[string]any{
		"reason_for_visit": "headache for a few days",
		"symptom_onset":    "few_days",
		"symptom_severity": float64(4),
	}
	res, err := svc.Submit(ctx, a.patientID, a.apptID, answers, activeVersion)
	if err != nil {
		t.Fatalf("submit on a telemedicine appointment: %v", err)
	}
	if res.Status != "SUBMITTED" {
		t.Fatalf("status = %q, want SUBMITTED", res.Status)
	}

	// The link row stays on its own plane: submitted, with no health-plane
	// appointment and no consult link (telemedicine runs its sessions through
	// consult_sessions, so there is nothing here to advance).
	var consultID *string
	var submittedAt *time.Time
	var status, source string
	if err := pool.QueryRow(ctx,
		`SELECT status, appointment_source, consult_id::text, submitted_at
		   FROM health_preconsult_intake WHERE telemedicine_appointment_id=$1`, a.apptID,
	).Scan(&status, &source, &consultID, &submittedAt); err != nil {
		t.Fatalf("read back link row: %v", err)
	}
	if status != "SUBMITTED" || source != "telemedicine" {
		t.Fatalf("link row = (%q, %q), want (SUBMITTED, telemedicine)", status, source)
	}
	if consultID != nil {
		t.Fatalf("a telemedicine intake must not link a health_consults row, got %v", *consultID)
	}
	if submittedAt == nil {
		t.Fatal("submitted_at not stamped — the room gate would still see the intake as open")
	}

	// The assigned doctor now reads the submitted answers, and Monitoring stops
	// reporting the appointment as an intake left incomplete near its slot.
	sum, err := svc.GetForDoctor(ctx, a.doctorUserID, a.apptID)
	if err != nil {
		t.Fatalf("assigned doctor denied after submit: %v", err)
	}
	if sum.Status != "SUBMITTED" {
		t.Fatalf("doctor summary status = %q, want SUBMITTED", sum.Status)
	}
	rows, err := svc.Monitoring(ctx, false, 120)
	if err != nil {
		t.Fatalf("Monitoring: %v", err)
	}
	for _, r := range rows {
		if r.AppointmentID == a.apptID && r.IncompleteNear {
			t.Fatal("submitted telemedicine intake still counted as incomplete near appointment")
		}
	}
}

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}
