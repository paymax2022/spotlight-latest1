package healthconsult

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

// TM-006 live-DB integration test: a consult's clinical notes are readable only by
// the participants (patient / provider owner) or an admin; anyone else is forbidden.
//
// SKIPPED whenever TEST_DATABASE_URL is unset. Bring-up:
//
//	supabase start
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	go test ./internal/health/consult/ -run TestNoteRead_LiveDB

func noteReadLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB consult note-read test; see bring-up note in noteaccess_live_db_test.go")
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

func TestNoteRead_LiveDB(t *testing.T) {
	ctx := context.Background()
	pool := noteReadLivePool(t)
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
	testsupport.CleanupUser(t, pool, patientID)
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, providerOwnerID, providerOwnerID+"@seed.test")
	testsupport.CleanupUser(t, pool, providerOwnerID)
	seed(`INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status)
	      VALUES ($1,$2,'PHARMACY','pharmacist','Seed Clinic','APPROVED')`, providerID, providerOwnerID)
	seed(`INSERT INTO public.health_consults (id, provider_id, patient_id, state, recording_enabled)
	      VALUES ($1,$2,$3,'COMPLETED',false)`, consultID, providerID, patientID)
	seed(`INSERT INTO public.health_clinical_notes (id, consult_id, author_id, subjective, objective, assessment, plan)
	      VALUES (gen_random_uuid(),$1,$2,'S','O','A','P')`, consultID, providerOwnerID)

	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM public.health_consults WHERE id=$1`, consultID) // cascades notes
		_, _ = pool.Exec(bg, `DELETE FROM public.health_providers WHERE id=$1`, providerID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1,$2)`, patientID, providerOwnerID)
	})

	// Patient may read.
	if notes, err := svc.Notes(ctx, patientID, consultID, false); err != nil || len(notes) != 1 {
		t.Fatalf("patient must read 1 note, got %d notes err=%v", len(notes), err)
	}
	// Provider owner may read.
	if notes, err := svc.Notes(ctx, providerOwnerID, consultID, false); err != nil || len(notes) != 1 {
		t.Fatalf("provider owner must read 1 note, got %d notes err=%v", len(notes), err)
	}
	// A stranger is forbidden.
	if _, err := svc.Notes(ctx, uuid.New().String(), consultID, false); err == nil {
		t.Fatal("a non-participant must be forbidden from reading consult notes")
	}
	// Empty requester is forbidden (fail-closed).
	if _, err := svc.Notes(ctx, "", consultID, false); err == nil {
		t.Fatal("an empty requester must be forbidden (fail-closed)")
	}
	// Admin may read (break-glass).
	if notes, err := svc.Notes(ctx, uuid.New().String(), consultID, true); err != nil || len(notes) != 1 {
		t.Fatalf("admin must read 1 note, got %d notes err=%v", len(notes), err)
	}
}
