package schools_test

// LIVE-DB test for the schools enrolment repository. The unit suite injects a fake
// Store, so a table-name/schema drift bug (e.g. querying legacy film-academy
// academy_enrollments instead of the B2B2C academy_edu_enrollments created by
// 20260815001300_academy_schools_tutor.sql) would be invisible there — the legacy
// table exists but has a DIFFERENT schema (no institution_id/state/idempotency_key),
// so every enrolment SQL would fail at runtime. This test exercises the real pgx
// repository end-to-end: seat-capped enrol, idempotent replay, removal, and counts.
// Skips unless TEST_DATABASE_URL is set — never DATABASE_URL (production pooler);
// this test inserts. All created rows are removed via the institution CASCADE.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/academy/schools"
)

func liveDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping schools live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	return pool
}

func liveUsers(t *testing.T, ctx context.Context, pool *pgxpool.Pool, n int) []string {
	t.Helper()
	rows, err := pool.Query(ctx, `SELECT id::text FROM auth.users ORDER BY created_at DESC LIMIT $1`, n)
	if err != nil {
		t.Fatalf("auth.users query: %v", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan user id: %v", err)
		}
		ids = append(ids, id)
	}
	if len(ids) < n {
		t.Skipf("need %d auth.users rows, found %d — skipping schools live-DB test", n, len(ids))
	}
	return ids
}

func TestLiveDB_Schools_EnrollmentSeatAccounting(t *testing.T) {
	pool := liveDB(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	repo := schools.NewRepository(pool)

	users := liveUsers(t, ctx, pool, 3)
	learner1, learner2, learner3 := users[0], users[1], users[2]

	inst, err := repo.InsertInstitution(ctx, "LiveDBTest "+uuid.NewString()[:8], "school", "", nil, "")
	if err != nil {
		t.Fatalf("InsertInstitution: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.academy_institutions WHERE id = $1`, inst.ID)
	})

	lic, err := repo.InsertLicence(ctx, inst.ID, "test", 2, 100000, nil, nil)
	if err != nil {
		t.Fatalf("InsertLicence: %v", err)
	}
	if lic.Seats != 2 || lic.UsedSeats != 0 {
		t.Fatalf("licence: seats=%d used=%d, want 2/0", lic.Seats, lic.UsedSeats)
	}

	// Enrol learner 1: consumes seat 1 of 2.
	seated, replay, used, seats, err := repo.EnrollSeated(ctx, inst.ID, "", learner1, "idem-live-"+uuid.NewString()[:8])
	if err != nil {
		t.Fatalf("EnrollSeated(learner1): %v", err)
	}
	if !seated || replay || used != 1 || seats != 2 {
		t.Fatalf("learner1: seated=%v replay=%v used=%d seats=%d, want true/false/1/2", seated, replay, used, seats)
	}

	// Idempotent replay: same learner again consumes no second seat.
	seated, replay, used, seats, err = repo.EnrollSeated(ctx, inst.ID, "", learner1, "idem-live-"+uuid.NewString()[:8])
	if err != nil {
		t.Fatalf("EnrollSeated(learner1 replay): %v", err)
	}
	if seated || !replay || used != 1 {
		t.Fatalf("learner1 replay: seated=%v replay=%v used=%d, want false/true/1", seated, replay, used)
	}

	// Enrol learner 2: fills the licence.
	seated, replay, used, _, err = repo.EnrollSeated(ctx, inst.ID, "", learner2, "idem-live-"+uuid.NewString()[:8])
	if err != nil {
		t.Fatalf("EnrollSeated(learner2): %v", err)
	}
	if !seated || replay || used != 2 {
		t.Fatalf("learner2: seated=%v replay=%v used=%d, want true/false/2", seated, replay, used)
	}

	// Learner 3: licence full → fail-closed ErrSeatLimitExceeded.
	_, _, _, _, err = repo.EnrollSeated(ctx, inst.ID, "", learner3, "idem-live-"+uuid.NewString()[:8])
	if !errors.Is(err, schools.ErrSeatLimitExceeded) {
		t.Fatalf("learner3: err=%v, want ErrSeatLimitExceeded", err)
	}

	counts, err := repo.CountEnrollmentsByState(ctx, inst.ID)
	if err != nil {
		t.Fatalf("CountEnrollmentsByState: %v", err)
	}
	if counts[schools.EnrollActive] != 2 {
		t.Fatalf("active count=%d, want 2", counts[schools.EnrollActive])
	}

	// Remove learner 1: frees a seat. Second removal is a no-op.
	freed, err := repo.RemoveEnrollment(ctx, inst.ID, learner1)
	if err != nil {
		t.Fatalf("RemoveEnrollment: %v", err)
	}
	if !freed {
		t.Fatal("RemoveEnrollment: freed=false, want true")
	}
	freed, err = repo.RemoveEnrollment(ctx, inst.ID, learner1)
	if err != nil {
		t.Fatalf("RemoveEnrollment(again): %v", err)
	}
	if freed {
		t.Fatal("RemoveEnrollment(again): freed=true, want false (idempotent)")
	}

	counts, err = repo.CountEnrollmentsByState(ctx, inst.ID)
	if err != nil {
		t.Fatalf("CountEnrollmentsByState(2): %v", err)
	}
	if counts[schools.EnrollActive] != 1 || counts[schools.EnrollRemoved] != 1 {
		t.Fatalf("counts after removal=%v, want active=1 removed=1", counts)
	}
}
