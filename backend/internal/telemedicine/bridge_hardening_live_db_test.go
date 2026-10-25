package telemedicine_test

// LIVE-DB coverage for the doctor-console bridge and pre-consult intake
// (ADR-PR879), written from the security review of PR #879:
//   H-1  readbacks show only rows the ASSIGNED doctor wrote (no planted Rx/notes)
//   H-2  chat resolves the assigned doctor's thread; a planted thread is refused
//   M-1  console sync moves the appointment only for the assigned doctor
//   M-2  a patient cannot cancel/reschedule a consult that has started
//   M-3  no call token for a closed appointment
//   M-4  editing a submitted intake re-runs triage (urgency only rises)
//   M-5  bridge flag off: booking writes no console rows
//   M-6  PostgREST roles hold no privileges on the bridged tables
// plus the sync status matrix (incl. settle-once on replay) and the intake
// authZ matrix. Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/telemedicine"
)

type bridgeFixture struct {
	ctx                                     context.Context
	pool                                    *pgxpool.Pool
	svc                                     *telemedicine.Service
	doctorID, doctorUserID, patientID, appt string
}

func newBridgeFixture(t *testing.T, bridgeOn bool) *bridgeFixture {
	t.Helper()
	pool := uatFixesPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := telemedicine.NewService(pool, settlement.NewService(pool, led)).
		WithTiers(tiers.NewService(pool)).WithConsoleBridge(bridgeOn)
	doctorID, doctorUserID, patientID := seedApprovedDoctor(t, ctx, pool, led, 500_000)
	appt, err := svc.BookAppointment(ctx, patientID, telemedicine.BookAppointmentRequest{
		DoctorID:       doctorID,
		ScheduledAt:    time.Now().Add(72 * time.Hour).Truncate(time.Second),
		IdempotencyKey: "bridge-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		for _, q := range []string{
			`DELETE FROM telemedicine_intakes WHERE appointment_id=$1::uuid`,
			`DELETE FROM doctor_chat_messages WHERE thread_id IN (SELECT id FROM doctor_chat_threads WHERE appointment_id=$1::uuid)`,
			`DELETE FROM doctor_chat_threads WHERE appointment_id=$1::uuid`,
			`DELETE FROM doctor_prescriptions WHERE appointment_id=$1::uuid`,
			`DELETE FROM doctor_clinical_notes WHERE appointment_id=$1::uuid`,
			`DELETE FROM doctor_appointments WHERE id=$1::uuid`,
		} {
			_, _ = pool.Exec(bg, q, appt.ID)
		}
	})
	return &bridgeFixture{ctx, pool, svc, doctorID, doctorUserID, patientID, appt.ID}
}

func (f *bridgeFixture) stranger(t *testing.T) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO auth.users (id,email) VALUES ($1::uuid,$2)`, id, id+"@stranger.test"); err != nil {
		t.Fatalf("seed stranger: %v", err)
	}
	t.Cleanup(func() { _, _ = f.pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1::uuid`, id) })
	return id
}

func (f *bridgeFixture) status(t *testing.T) string {
	t.Helper()
	var s string
	if err := f.pool.QueryRow(f.ctx, `SELECT status FROM appointments WHERE id=$1`, f.appt).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestLiveDB_Bridge_ReadbacksIgnorePlantedRows(t *testing.T) {
	f := newBridgeFixture(t, true)
	mallory := f.stranger(t)
	// A non-doctor plants an "issued" prescription and a shared note on the
	// bridged appointment (what PostgREST INSERT used to allow).
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO doctor_prescriptions (user_id, appointment_id, status, diagnosis, issued_at)
		VALUES ($1::uuid, $2::uuid, 'issued', 'FORGED', now())`, mallory, f.appt); err != nil {
		t.Fatalf("plant rx: %v", err)
	}
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO doctor_clinical_notes (user_id, appointment_id, status, assessment)
		VALUES ($1::uuid, $2::uuid, 'shared', 'FORGED')`, mallory, f.appt); err != nil {
		t.Fatalf("plant note: %v", err)
	}
	if rx, err := f.svc.GetPrescription(f.ctx, f.appt, f.patientID); err == nil && rx.Instructions == "FORGED" {
		t.Fatal("H-1: patient was shown a prescription written by someone other than the assigned doctor")
	}
	if vs, err := f.svc.GetVisitSummary(f.ctx, f.appt, f.patientID); err == nil && vs.Diagnosis == "FORGED" {
		t.Fatal("H-1: patient was shown a visit note written by someone other than the assigned doctor")
	}
	// The assigned doctor's own prescription is still read back.
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO doctor_prescriptions (user_id, appointment_id, status, diagnosis, issued_at)
		VALUES ($1::uuid, $2::uuid, 'issued', 'REAL', now() - interval '1 minute')`, f.doctorUserID, f.appt); err != nil {
		t.Fatalf("doctor rx: %v", err)
	}
	rx, err := f.svc.GetPrescription(f.ctx, f.appt, f.patientID)
	if err != nil || rx.Instructions != "REAL" {
		t.Fatalf("assigned doctor's prescription must read back, got rx=%+v err=%v", rx, err)
	}
}

func TestLiveDB_Bridge_ChatUsesTheAssignedDoctorsThread(t *testing.T) {
	f := newBridgeFixture(t, true)
	mallory := f.stranger(t)
	// A second thread for the same appointment is refused outright (unique).
	_, err := f.pool.Exec(f.ctx, `
		INSERT INTO doctor_chat_threads (id, user_id, appointment_id, status)
		VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'active')`, mallory, f.appt)
	if err == nil {
		t.Fatal("H-2: a second chat thread for one appointment must be rejected")
	}
	if _, err := f.svc.SendAppointmentMessage(f.ctx, f.appt, f.patientID, "hello doctor"); err != nil {
		t.Fatalf("send: %v", err)
	}
	var owner string
	if err := f.pool.QueryRow(f.ctx, `
		SELECT t.user_id::text FROM doctor_chat_messages m JOIN doctor_chat_threads t ON t.id = m.thread_id
		WHERE t.appointment_id=$1::uuid AND m.body='hello doctor'`, f.appt).Scan(&owner); err != nil {
		t.Fatalf("read message: %v", err)
	}
	if owner != f.doctorUserID {
		t.Fatalf("H-2: patient message landed in a thread owned by %s, want the assigned doctor", owner)
	}
}

func TestLiveDB_Bridge_SyncRequiresTheAssignedDoctor(t *testing.T) {
	f := newBridgeFixture(t, true)
	mallory := f.stranger(t)
	for _, st := range []string{"confirmed", "in_progress", "completed", "cancelled"} {
		if err := f.svc.SyncFromDoctorConsole(f.ctx, f.appt, st, mallory); err != nil && !errors.Is(err, telemedicine.ErrSyncActorNotDoctor) {
			t.Fatalf("%s by stranger: unexpected error %v", st, err)
		}
		if got := f.status(t); got != "booked" {
			t.Fatalf("M-1: sync %q by a stranger moved the appointment to %q", st, got)
		}
	}
}

func TestLiveDB_Bridge_SyncStatusMatrixSettlesOnce(t *testing.T) {
	f := newBridgeFixture(t, true)
	steps := []struct{ status, want string }{
		{"confirmed", "confirmed"},
		{"in_progress", "in_progress"},
		{"completed", "completed"},
		{"completed", "completed"}, // replay: no second settlement
		{"cancelled", "completed"}, // completed is terminal; no refund
	}
	for _, s := range steps {
		if err := f.svc.SyncFromDoctorConsole(f.ctx, f.appt, s.status, f.doctorUserID); err != nil {
			t.Fatalf("sync %s: %v", s.status, err)
		}
		if got := f.status(t); got != s.want {
			t.Fatalf("after sync %s: status %q, want %q", s.status, got, s.want)
		}
	}
	var settlementStatus string
	if err := f.pool.QueryRow(f.ctx, `
		SELECT s.status FROM appointments a JOIN settlements s ON s.id = a.settlement_id WHERE a.id=$1`, f.appt).
		Scan(&settlementStatus); err != nil {
		t.Fatalf("settlement: %v", err)
	}
	if settlementStatus == "refunded" {
		t.Fatal("a completed consult must not be refunded by a later cancel sync")
	}
}

func TestLiveDB_Bridge_PatientCannotCancelOrRescheduleAStartedConsult(t *testing.T) {
	f := newBridgeFixture(t, true)
	if err := f.svc.SyncFromDoctorConsole(f.ctx, f.appt, "in_progress", f.doctorUserID); err != nil {
		t.Fatalf("start: %v", err)
	}
	if err := f.svc.CancelAppointment(f.ctx, f.appt, f.patientID); err == nil {
		t.Fatal("M-2: patient cancelled (and was refunded for) a consult already in progress")
	}
	if err := f.svc.RescheduleAppointment(f.ctx, f.appt, f.patientID,
		telemedicine.RescheduleRequest{ScheduledAt: time.Now().Add(96 * time.Hour)}); err == nil {
		t.Fatal("M-2: patient rescheduled a consult already in progress")
	}
	if got := f.status(t); got != "in_progress" {
		t.Fatalf("status %q, want in_progress", got)
	}
}

func TestLiveDB_Bridge_NoCallTokenForAClosedAppointment(t *testing.T) {
	f := newBridgeFixture(t, true)
	if err := f.svc.CancelAppointment(f.ctx, f.appt, f.patientID); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if _, err := f.svc.GetAppointmentCallToken(f.ctx, f.appt, f.patientID); err == nil {
		t.Fatal("M-3: a call token was issued for a cancelled appointment")
	}
	if _, err := f.svc.GetAppointmentCallToken(f.ctx, f.appt, f.stranger(t)); !errors.Is(err, telemedicine.ErrAppointmentNotFound) {
		t.Fatalf("a non-participant must get not-found, got %v", err)
	}
}

func TestLiveDB_Intake_EditAfterSubmitReRunsTriage(t *testing.T) {
	f := newBridgeFixture(t, true)
	if _, err := f.svc.SubmitAppointmentIntake(f.ctx, f.appt, f.patientID, telemedicine.SaveIntakeRequest{
		Answers: telemedicine.IntakeAnswers{"severity": float64(3)}, ConsentVersion: "v1",
	}); err != nil {
		t.Fatalf("submit: %v", err)
	}
	it, err := f.svc.SaveAppointmentIntakeDraft(f.ctx, f.appt, f.patientID, telemedicine.SaveIntakeRequest{
		Answers: telemedicine.IntakeAnswers{"red_flag_symptoms": []any{"chest_pain"}},
	})
	if err != nil {
		t.Fatalf("edit after submit: %v", err)
	}
	if it.RedFlag == nil || it.RedFlag.Routing != "EMERGENCY" {
		t.Fatalf("M-4: chest pain added after submit was not triaged, red_flag=%+v", it.RedFlag)
	}
	// Urgency only rises: removing the symptom again keeps the emergency flag.
	it, err = f.svc.SaveAppointmentIntakeDraft(f.ctx, f.appt, f.patientID, telemedicine.SaveIntakeRequest{
		Answers: telemedicine.IntakeAnswers{"severity": float64(2)},
	})
	if err != nil {
		t.Fatalf("second edit: %v", err)
	}
	if it.RedFlag == nil || it.RedFlag.Routing != "EMERGENCY" {
		t.Fatalf("M-4: a later edit lowered the triage outcome, red_flag=%+v", it.RedFlag)
	}
}

func TestLiveDB_Intake_AuthzMatrix(t *testing.T) {
	f := newBridgeFixture(t, true)
	mallory := f.stranger(t)
	req := telemedicine.SaveIntakeRequest{Answers: telemedicine.IntakeAnswers{"severity": float64(4)}}
	if _, err := f.svc.SaveAppointmentIntakeDraft(f.ctx, f.appt, f.patientID, req); err != nil {
		t.Fatalf("patient write: %v", err)
	}
	if _, err := f.svc.GetAppointmentIntake(f.ctx, f.appt, f.doctorUserID); err != nil {
		t.Fatalf("assigned doctor read: %v", err)
	}
	if _, err := f.svc.SaveAppointmentIntakeDraft(f.ctx, f.appt, f.doctorUserID, req); !errors.Is(err, telemedicine.ErrNotIntakeOwner) {
		t.Fatalf("doctor write: got %v, want ErrNotIntakeOwner", err)
	}
	if _, err := f.svc.GetAppointmentIntake(f.ctx, f.appt, mallory); err == nil {
		t.Fatal("a stranger read another patient's intake")
	}
	if _, err := f.svc.SaveAppointmentIntakeDraft(f.ctx, f.appt, mallory, req); err == nil {
		t.Fatal("a stranger wrote another patient's intake")
	}
}

func TestLiveDB_Bridge_FlagOffWritesNoConsoleRows(t *testing.T) {
	f := newBridgeFixture(t, false)
	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM doctor_appointments WHERE id=$1::uuid`, f.appt).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatal("M-5: with FEATURE_TELEMEDICINE_CONSOLE_BRIDGE_ENABLED off, booking must not mirror into the doctor console")
	}
	// And the reverse sync is inert: the console cannot move or settle it.
	if err := f.svc.SyncFromDoctorConsole(f.ctx, f.appt, "completed", f.doctorUserID); err != nil {
		t.Fatalf("sync with bridge off: %v", err)
	}
	if got := f.status(t); got != "booked" {
		t.Fatalf("M-5: bridge off, console sync still moved the appointment to %q", got)
	}
}

func TestLiveDB_Bridge_TablesNotReachableViaPostgREST(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	for _, tbl := range []string{
		"telemedicine_intakes", "doctor_appointments", "doctor_chat_threads", "doctor_chat_messages",
		"doctor_prescriptions", "doctor_prescription_items", "doctor_clinical_notes",
	} {
		for _, role := range []string{"anon", "authenticated"} {
			var any bool
			if err := pool.QueryRow(ctx,
				`SELECT has_table_privilege($1, 'public.'||$2, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')`,
				role, tbl).Scan(&any); err != nil {
				t.Fatal(err)
			}
			if any {
				t.Errorf("M-6: %s holds privileges on %s", role, tbl)
			}
		}
	}
}
