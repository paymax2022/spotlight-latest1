package healthconsult

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TM-003 live-DB integration test for consent-gated consult recording.
//
// SKIPPED whenever TEST_DATABASE_URL / DATABASE_URL is unset (same env-gate as the
// FX / lab-amendment / rx-refills live-DB suites). Bring-up:
//
//	supabase start   # or any Postgres with the migrations applied
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	go test ./internal/health/consult/ -run TestRecordingConsent_LiveDB
//
// It seeds a SCHEDULED consult and drives the two-party consent gate: patient-only
// consent cannot enable recording; once the provider also consents recording turns
// on; when the patient withdraws, recording turns off again.

func recordingLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB consult recording test; see bring-up note in recording_live_db_test.go")
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

func TestRecordingConsent_LiveDB(t *testing.T) {
	ctx := context.Background()
	pool := recordingLivePool(t)
	svc := NewService(pool, "test-av-key", nil)

	patientID := uuid.New().String()
	providerOwnerID := uuid.New().String()
	providerID := uuid.New().String()
	consultID := uuid.New().String()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, patientID, patientID+"@seed.test")
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, providerOwnerID, providerOwnerID+"@seed.test")
	seed(`INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status)
	      VALUES ($1,$2,'PHARMACY','pharmacist','Seed Clinic','APPROVED')`, providerID, providerOwnerID)
	seed(`INSERT INTO public.health_consults (id, provider_id, patient_id, state, recording_enabled)
	      VALUES ($1,$2,$3,'SCHEDULED',false)`, consultID, providerID, patientID)

	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM public.health_consult_recording_consents WHERE consult_id=$1`, consultID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_consults WHERE id=$1`, consultID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_providers WHERE id=$1`, providerID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1,$2)`, patientID, providerOwnerID)
	})

	recordingOn := func() bool {
		var on bool
		if err := pool.QueryRow(ctx, `SELECT recording_enabled FROM health_consults WHERE id=$1`, consultID).Scan(&on); err != nil {
			t.Fatal(err)
		}
		return on
	}

	// Patient consents, provider has not → enabling must be blocked, recording off.
	if err := svc.RecordRecordingConsent(ctx, patientID, consultID); err != nil {
		t.Fatalf("patient consent: %v", err)
	}
	if _, err := svc.EnableRecording(ctx, providerOwnerID, consultID); !errors.Is(err, ErrRecordingConsentMissing) {
		t.Fatalf("enabling with only patient consent must be blocked, got %v", err)
	}
	if recordingOn() {
		t.Fatal("recording must remain OFF without two-party consent")
	}

	// A non-participant cannot consent.
	if err := svc.RecordRecordingConsent(ctx, uuid.New().String(), consultID); err == nil {
		t.Fatal("a non-participant must not be able to consent")
	}

	// Provider also consents → recording can be enabled.
	if err := svc.RecordRecordingConsent(ctx, providerOwnerID, consultID); err != nil {
		t.Fatalf("provider consent: %v", err)
	}
	if _, err := svc.EnableRecording(ctx, providerOwnerID, consultID); err != nil {
		t.Fatalf("enabling with two-party consent must succeed: %v", err)
	}
	if !recordingOn() {
		t.Fatal("recording must be ON after two-party consent + enable")
	}

	// Patient withdraws consent → recording must stop immediately.
	if err := svc.WithdrawRecordingConsent(ctx, patientID, consultID); err != nil {
		t.Fatalf("withdraw: %v", err)
	}
	if recordingOn() {
		t.Fatal("recording must be OFF once a party withdraws consent")
	}
}
