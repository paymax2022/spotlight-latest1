package doctor_test

// LIVE-DB: the console's note/prescription writes are scoped to the caller's
// own doctor_appointments row (ADR-PR879, review finding H-1 on PR #879). Before,
// any authenticated user could attach a clinical note or an issued prescription
// to any appointment id, and the telemedicine readback showed it to the patient.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/doctor"
)

func TestLiveDB_ConsoleWritesRequireOwnAppointment(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	owner, mallory, apptID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, u := range []string{owner, mallory} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1::uuid,$2)`, u, u+"@console.test"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO doctor_appointments (id, user_id, status) VALUES ($1::uuid,$2::uuid,'confirmed')`, apptID, owner); err != nil {
		t.Fatalf("seed appointment: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM doctor_prescriptions WHERE appointment_id=$1::uuid`, apptID)
		_, _ = pool.Exec(bg, `DELETE FROM doctor_clinical_notes WHERE appointment_id=$1::uuid`, apptID)
		_, _ = pool.Exec(bg, `DELETE FROM doctor_appointments WHERE id=$1::uuid`, apptID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1::uuid,$2::uuid)`, owner, mallory)
	})

	svc := doctor.NewService(pool, nil, nil, nil)
	if _, err := svc.SaveNote(ctx, mallory, apptID, "n-"+uuid.NewString(), doctor.SaveNoteRequest{}); !errors.Is(err, doctor.ErrNotFound) {
		t.Fatalf("note on someone else's appointment: got %v, want ErrNotFound", err)
	}
	if _, err := svc.CreatePrescription(ctx, mallory, "p-"+uuid.NewString(), doctor.CreatePrescriptionRequest{AppointmentID: &apptID, Status: "issued"}); !errors.Is(err, doctor.ErrNotFound) {
		t.Fatalf("prescription on someone else's appointment: got %v, want ErrNotFound", err)
	}
	if _, err := svc.SaveNote(ctx, owner, apptID, "n-"+uuid.NewString(), doctor.SaveNoteRequest{}); err != nil {
		t.Fatalf("owner note: %v", err)
	}
	if _, err := svc.CreatePrescription(ctx, owner, "p-"+uuid.NewString(), doctor.CreatePrescriptionRequest{AppointmentID: &apptID, Status: "draft"}); err != nil {
		t.Fatalf("owner prescription: %v", err)
	}
}
