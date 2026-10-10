package healthconsult

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

// w12 uniform-denial live-DB test: a consult the caller is not a party to must
// be indistinguishable from a missing one — every member-facing path folds to
// ErrConsultNotFound before any state check, so a foreign actor can probe
// neither existence nor lifecycle state.
// SKIPPED whenever TEST_DATABASE_URL is unset (same env-gate as the consult
// recording suite).

func consultDenialPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB consult denial test")
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

func TestForeignConsultFoldsToNotFound_LiveDB(t *testing.T) {
	ctx := context.Background()
	pool := consultDenialPool(t)
	svc := NewService(pool, "test-av-key", nil)

	patientID := uuid.New().String()
	providerOwnerID := uuid.New().String()
	strangerID := uuid.New().String()
	providerID := uuid.New().String()
	consultID := uuid.New().String()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	for _, u := range []string{patientID, providerOwnerID, strangerID} {
		seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test")
		testsupport.CleanupUser(t, pool, u)
	}
	seed(`INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status)
	      VALUES ($1,$2,'PHARMACY','pharmacist','Seed Clinic','APPROVED')`, providerID, providerOwnerID)
	seed(`INSERT INTO public.health_consults (id, provider_id, patient_id, state, recording_enabled)
	      VALUES ($1,$2,$3,'SCHEDULED',false)`, consultID, providerID, patientID)
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM public.health_consults WHERE id=$1`, consultID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_providers WHERE id=$1`, providerID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1,$2,$3)`, patientID, providerOwnerID, strangerID)
	})

	missingID := uuid.New().String()
	// Lobby token: foreign == missing.
	for _, cid := range []string{consultID, missingID} {
		if _, err := svc.IssueLobbyToken(ctx, strangerID, cid); !errors.Is(err, ErrConsultNotFound) {
			t.Fatalf("stranger lobby on %s: err = %v, want ErrConsultNotFound", cid, err)
		}
	}
	// Transition (Start): foreign == missing — the stranger can never learn the
	// consult is SCHEDULED.
	for _, cid := range []string{consultID, missingID} {
		if _, err := svc.Start(ctx, strangerID, cid); !errors.Is(err, ErrConsultNotFound) {
			t.Fatalf("stranger start on %s: err = %v, want ErrConsultNotFound", cid, err)
		}
	}
	// Notes read: foreign == missing.
	for _, cid := range []string{consultID, missingID} {
		if _, err := svc.Notes(ctx, strangerID, cid, false); !errors.Is(err, ErrConsultNotFound) {
			t.Fatalf("stranger notes on %s: err = %v, want ErrConsultNotFound", cid, err)
		}
	}
	// The real patient still sees the consult (fold is actor-relative).
	if _, err := svc.Notes(ctx, patientID, consultID, false); err != nil {
		t.Fatalf("patient notes on own consult: %v", err)
	}
}
