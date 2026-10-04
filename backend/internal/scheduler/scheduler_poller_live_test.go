package scheduler

// Live-DB tests for the durable-job poller (E2E-BE-005). SKIPPED whenever
// TEST_DATABASE_URL is unset — the same gate every other live suite in this
// repo uses; it never falls back to DATABASE_URL.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	go test ./internal/scheduler/ -run LiveDB -count=1
//
// scheduler_jobs.owner_user_id is FK'd to auth.users(id), so these tests borrow
// any existing auth.users row rather than minting a fixture account.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func liveSchedPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB scheduler poller test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func liveSchedOwner(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(), `SELECT id::text FROM auth.users LIMIT 1`).Scan(&id)
	if err != nil {
		t.Skipf("no auth.users row available for scheduler_jobs.owner_user_id FK: %v", err)
	}
	return id
}

// TestPoll_ExecutesDueJob_LiveDB is the end-to-end proof for E2E-BE-005: a job
// enqueued via Schedule is claimed and executed by a poller running on a
// DIFFERENT Service instance (registrations resolve process-wide), and its run
// is recorded succeeded.
func TestPoll_ExecutesDueJob_LiveDB(t *testing.T) {
	ctx := context.Background()
	pool := liveSchedPool(t)
	owner := liveSchedOwner(t, pool)

	poller := NewService(pool)    // the drain — mirrors the app-wired poller
	registrar := NewService(pool) // module-side instance that owns the handler

	jobType := "test.poll." + uuid.New().String()
	fired := make(chan string, 1)
	registrar.RegisterJobType(jobType, func(hctx HandlerCtx) error {
		fired <- hctx.IdemKey()
		return nil
	})

	job, err := registrar.Schedule(ctx, Job{
		JobType:     jobType,
		OwnerUserID: owner,
		EntityRef:   "test-entity",
		NextRunAt:   time.Now().Add(-time.Second), // already due
		MaxRuns:     1,
	})
	if err != nil {
		t.Fatalf("Schedule: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM scheduler_jobs WHERE id=$1`, job.ID)
	})

	pollCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go poller.Poll(pollCtx, 50*time.Millisecond)

	select {
	case key := <-fired:
		if key == "" {
			t.Error("handler fired with empty IdemKey")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("poller did not execute the due job within 10s")
	}
	cancel()

	// The handler firing and finishRun updating scheduler_runs are sequential on
	// the poller goroutine, but the fired-channel receive unblocks the test the
	// instant the handler sends — before finishRun's UPDATE lands. Poll the run
	// row until the status settles instead of asserting immediately.
	var status string
	deadline := time.Now().Add(5 * time.Second)
	for {
		err = pool.QueryRow(ctx, `SELECT status FROM scheduler_runs WHERE job_id=$1`, job.ID).Scan(&status)
		if err != nil {
			t.Fatalf("read scheduler_runs: %v", err)
		}
		if status != string(RunPending) || time.Now().After(deadline) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if status != string(RunSucceeded) {
		t.Errorf("run status = %q, want %q", status, RunSucceeded)
	}
}

// TestRunDue_SkipsUnhandledJobType_LiveDB guards the flag-off safety property:
// a due job whose type no live module can execute must NOT have its occurrence
// consumed — it stays due (next_run_at unchanged, status active) so a later
// deploy where the handler registers can still run it.
func TestRunDue_SkipsUnhandledJobType_LiveDB(t *testing.T) {
	ctx := context.Background()
	pool := liveSchedPool(t)
	owner := liveSchedOwner(t, pool)

	svc := NewService(pool)
	jobType := "test.nohandler." + uuid.New().String()
	dueAt := time.Now().Add(-time.Minute).Truncate(time.Second)
	job, err := svc.Schedule(ctx, Job{
		JobType:     jobType,
		OwnerUserID: owner,
		NextRunAt:   dueAt,
		MaxRuns:     1,
	})
	if err != nil {
		t.Fatalf("Schedule: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM scheduler_jobs WHERE id=$1`, job.ID)
	})

	n, err := svc.RunDue(ctx)
	if err != nil {
		t.Fatalf("RunDue: %v", err)
	}
	if n != 0 {
		t.Errorf("RunDue processed %d job(s), want 0 — unhandled job type must not be consumed", n)
	}

	var status string
	var nextRun time.Time
	var runCount int64
	err = pool.QueryRow(ctx,
		`SELECT status, next_run_at, run_count FROM scheduler_jobs WHERE id=$1`, job.ID).
		Scan(&status, &nextRun, &runCount)
	if err != nil {
		t.Fatalf("read scheduler_jobs: %v", err)
	}
	if status != string(JobActive) {
		t.Errorf("job status = %q, want %q (occurrence must stay pending)", status, JobActive)
	}
	if !nextRun.Equal(dueAt) {
		t.Errorf("next_run_at moved to %v, want unchanged %v", nextRun, dueAt)
	}
	if runCount != 0 {
		t.Errorf("run_count = %d, want 0", runCount)
	}
}
