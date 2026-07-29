package healthconsult

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TM-005 live-DB integration test: a persisted clinical note is IMMUTABLE — the
// append-only trigger (migration 20261030000200) makes any UPDATE or DELETE fail, so
// a signed note can never be altered or removed (a correction is a new note).
//
// SKIPPED whenever TEST_DATABASE_URL / DATABASE_URL is unset. Bring-up:
//
//	supabase start
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	go test ./internal/health/consult/ -run TestClinicalNoteImmutable_LiveDB

func noteLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB clinical-note immutability test; see bring-up note in note_immutable_live_db_test.go")
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

func TestClinicalNoteImmutable_LiveDB(t *testing.T) {
	ctx := context.Background()
	pool := noteLivePool(t)

	patientID := uuid.New().String()
	authorID := uuid.New().String()
	providerID := uuid.New().String()
	consultID := uuid.New().String()
	noteID := uuid.New().String()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, patientID, patientID+"@seed.test")
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, authorID, authorID+"@seed.test")
	seed(`INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status)
	      VALUES ($1,$2,'PHARMACY','pharmacist','Seed Clinic','APPROVED')`, providerID, authorID)
	seed(`INSERT INTO public.health_consults (id, provider_id, patient_id, state, recording_enabled)
	      VALUES ($1,$2,$3,'IN_PROGRESS',false)`, consultID, providerID, patientID)
	seed(`INSERT INTO public.health_clinical_notes (id, consult_id, author_id, subjective, objective, assessment, plan)
	      VALUES ($1,$2,$3,'S','O','A','original plan')`, noteID, consultID, authorID)

	t.Cleanup(func() {
		bg := context.Background()
		// The note is immutable — cascade-delete it via its consult (FK ON DELETE
		// CASCADE fires the row delete from the parent, not a direct DELETE on the note).
		_, _ = pool.Exec(bg, `DELETE FROM public.health_consults WHERE id=$1`, consultID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_providers WHERE id=$1`, providerID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1,$2)`, patientID, authorID)
	})

	// A direct UPDATE of a persisted note must be rejected by the append-only trigger.
	if _, err := pool.Exec(ctx, `UPDATE public.health_clinical_notes SET plan='tampered' WHERE id=$1`, noteID); err == nil {
		t.Fatal("UPDATE of a clinical note must be rejected (append-only immutability)")
	}
	// A direct DELETE must likewise be rejected.
	if _, err := pool.Exec(ctx, `DELETE FROM public.health_clinical_notes WHERE id=$1`, noteID); err == nil {
		t.Fatal("DELETE of a clinical note must be rejected (append-only immutability)")
	}

	// The note is intact and unchanged.
	var plan string
	if err := pool.QueryRow(ctx, `SELECT plan FROM public.health_clinical_notes WHERE id=$1`, noteID).Scan(&plan); err != nil {
		t.Fatalf("note must still exist unchanged: %v", err)
	}
	if plan != "original plan" {
		t.Fatalf("note plan must be unchanged, got %q", plan)
	}
}
