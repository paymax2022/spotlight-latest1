package core

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

// w12 uniform-denial live-DB test: session/profile loads are owner-fused, so a
// foreign object is indistinguishable from a missing one — and StartSession
// can never link a profile the caller does not own.
// SKIPPED whenever TEST_DATABASE_URL is unset (same env-gate as the consult /
// rx live-DB suites). Bring-up:
//	supabase start   # or any Postgres with the migrations applied
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	go test ./internal/health/triage/core/ -run TestOwnerFusedLoad_LiveDB

func triageLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB triage test; see bring-up note in denial_uniform_live_db_test.go")
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

func TestOwnerFusedLoad_LiveDB(t *testing.T) {
	ctx := context.Background()
	pool := triageLivePool(t)
	svc := NewSessionService(pool, nil, nil, nil, nil, nil)

	ownerID := uuid.New().String()
	strangerID := uuid.New().String()
	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, ownerID, ownerID+"@seed.test")
	testsupport.CleanupUser(t, pool, ownerID)
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, strangerID, strangerID+"@seed.test")
	testsupport.CleanupUser(t, pool, strangerID)
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM public.health_triage_sessions WHERE user_id=$1`, ownerID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_triage_consents WHERE user_id=$1`, ownerID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_triage_profiles WHERE user_id=$1`, ownerID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1,$2)`, ownerID, strangerID)
	})

	// Owner creates a profile + session.
	prof, err := svc.CreateProfile(ctx, ownerID, "self", "", "", nil, false)
	if err != nil {
		t.Fatalf("CreateProfile: %v", err)
	}
	sess, err := svc.StartSession(ctx, ownerID, StartParams{ProfileID: &prof.ID})
	if err != nil {
		t.Fatalf("StartSession: %v", err)
	}

	// A stranger reading the owner's session gets the SAME ErrSessionNotFound a
	// missing id returns — no existence oracle.
	if _, err := svc.GetSession(ctx, strangerID, sess.ID); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("foreign session: err = %v, want ErrSessionNotFound", err)
	}
	if _, err := svc.GetSession(ctx, strangerID, uuid.New().String()); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("missing session: err = %v, want ErrSessionNotFound", err)
	}

	// A stranger cannot link the owner's profile into their own session — the
	// owner-fused profile load folds it to ErrProfileNotFound.
	foreignProfile := prof.ID
	if _, err := svc.StartSession(ctx, strangerID, StartParams{ProfileID: &foreignProfile}); !errors.Is(err, ErrProfileNotFound) {
		t.Fatalf("foreign profile: err = %v, want ErrProfileNotFound", err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.health_triage_sessions WHERE user_id=$1`, strangerID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("foreign profile must not mint a session, got %d rows", n)
	}
}
