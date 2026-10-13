package connectverification_test

// Live-DB regression: the verification StatusService against the schema the migration chain
// ACTUALLY builds. Two migrations both create connect_verification with different shapes
// (20260627000300 first, then 20260702000000 as CREATE TABLE IF NOT EXISTS, which is skipped),
// so the service's columns, statuses and ON CONFLICT target did not exist and every submit
// failed. SKIPPED unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	connectverification "spotlight/backend/internal/connect/verification"
	"spotlight/backend/internal/testsupport"
)

func liveSvc(t *testing.T) (*connectverification.StatusService, *pgxpool.Pool, context.Context) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping connect verification live-DB test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	h, err := connectverification.NewHasher("test-pepper")
	if err != nil {
		t.Fatal(err)
	}
	stub, err := connectverification.NewStubProvider(h)
	if err != nil {
		t.Fatal(err)
	}
	return connectverification.NewStatusService(pool, stub, connectverification.LevelL1), pool, ctx
}

func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	u := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUserCtx(t, ctx, pool, u)
	return u
}

func TestLive_SubmitSelfiePersistsAndGrantsTheBadge(t *testing.T) {
	svc, pool, ctx := liveSvc(t)
	u := seedUser(t, ctx, pool)

	rec, err := svc.SubmitSelfie(ctx, connectverification.LivenessRequest{
		UserID: u, RequestedLevel: connectverification.LevelL1, SelfieRef: "r2://selfie/" + u,
	})
	if err != nil {
		t.Fatalf("submit failed on the migrated schema: %v", err)
	}
	if rec.Status != connectverification.StatusL1Passed || !rec.Badge || !rec.HasEvidence {
		t.Fatalf("record = %+v", rec)
	}
	got, err := svc.Get(ctx, u)
	if err != nil || got.Status != connectverification.StatusL1Passed || got.VerifiedAt == nil {
		t.Fatalf("get = %+v, %v", got, err)
	}
	// A retry of the same outcome is idempotent.
	if _, err := svc.SubmitSelfie(ctx, connectverification.LivenessRequest{
		UserID: u, RequestedLevel: connectverification.LevelL1, SelfieRef: "r2://selfie/" + u,
	}); err != nil {
		t.Fatalf("retry: %v", err)
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM connect_verification WHERE user_id = $1::uuid`, u).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("rows for user = %d, %v: one verification row per user", rows, err)
	}
}

func TestLive_AFailedCheckIsRecordedNotLost(t *testing.T) {
	svc, pool, ctx := liveSvc(t)
	u := seedUser(t, ctx, pool)
	rec, err := svc.SubmitSelfie(ctx, connectverification.LivenessRequest{UserID: u, RequestedLevel: connectverification.LevelL1}) // empty evidence: provider rejects
	if err != nil {
		t.Fatalf("a provider rejection must persist as failed, not error: %v", err)
	}
	if rec.Status != connectverification.StatusFailed || rec.Badge {
		t.Fatalf("record = %+v", rec)
	}
}

func TestLive_StatusIsReadableForAUserWhoNeverSubmitted(t *testing.T) {
	svc, pool, ctx := liveSvc(t)
	u := seedUser(t, ctx, pool)
	rec, err := svc.Get(ctx, u)
	if err != nil || rec.Status != connectverification.StatusNone || rec.Badge {
		t.Fatalf("rec = %+v, %v", rec, err)
	}
}

// Review finding: two concurrent FIRST submits for one user must both succeed and leave exactly
// one row (NOT EXISTS alone races under READ COMMITTED; the loser used to fail with 23505).
func TestLive_ConcurrentFirstSubmitsCreateOneRowAndAllSucceed(t *testing.T) {
	svc, pool, ctx := liveSvc(t)
	u := seedUser(t, ctx, pool)
	const n = 8
	// Warm the pool so the goroutines really overlap instead of queueing on connection setup.
	var conns []*pgxpool.Conn
	for i := 0; i < n; i++ {
		c, err := pool.Acquire(ctx)
		if err != nil {
			t.Fatal(err)
		}
		conns = append(conns, c)
	}
	for _, c := range conns {
		c.Release()
	}
	errs := make(chan error, n)
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		go func() {
			<-start
			_, err := svc.SubmitSelfie(ctx, connectverification.LivenessRequest{
				UserID: u, RequestedLevel: connectverification.LevelL1, SelfieRef: "r2://selfie/" + u,
			})
			errs <- err
		}()
	}
	close(start)
	for i := 0; i < n; i++ {
		if err := <-errs; err != nil {
			t.Errorf("concurrent first submit failed: %v", err)
		}
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM connect_verification WHERE user_id = $1::uuid`, u).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("rows = %d, %v", rows, err)
	}
}
