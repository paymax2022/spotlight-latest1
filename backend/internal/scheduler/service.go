package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// runCtx implements HandlerCtx for one occurrence. It carries the durable run
// identity so handlers can build a stable idempotency key for money movement.
type runCtx struct {
	ctx     context.Context
	job     Job
	idemKey string // == run key; the canonical idempotency key for this occurrence
}

func (r runCtx) Context() context.Context { return r.ctx }
func (r runCtx) IdemKey() string          { return r.idemKey }
func (r runCtx) Job() JobView             { return jobView{r.job} }

// jobView implements JobView (read-only projection).
type jobView struct{ j Job }

func (v jobView) ID() string          { return v.j.ID }
func (v jobView) OwnerUserID() string { return v.j.OwnerUserID }
func (v jobView) EntityRef() string   { return v.j.EntityRef }
func (v jobView) PayloadValue(key string) (any, bool) {
	if v.j.Payload == nil {
		return nil, false
	}
	val, ok := v.j.Payload[key]
	return val, ok
}

// Service is a DB-driven recurring-job poller. There is NO external cron
// dependency: an existing worker / endpoint calls RunDue(ctx) on a cadence and
// this service claims, executes and reschedules every due job exactly once per
// occurrence (UNIQUE run key). Backoff and missed-run catch-up are handled here.
type Service struct {
	db       *pgxpool.Pool
	mu       sync.RWMutex
	handlers map[string]HandlerFunc
	// backoffBase is the first retry delay; doubles per consecutive failure,
	// capped at backoffMax. Missed occurrences are caught up one-per-poll.
	backoffBase time.Duration
	backoffMax  time.Duration
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{
		db:          db,
		handlers:    make(map[string]HandlerFunc),
		backoffBase: 30 * time.Second,
		backoffMax:  6 * time.Hour,
	}
}

// RegisterJobType binds a handler to a job-type key. Consumers (savings auto-save,
// Ajo cycle debit, subscriptions) register their side effect once at wiring time.
func (s *Service) RegisterJobType(jobType string, h HandlerFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handlers[jobType] = h
}

func (s *Service) handlerFor(jobType string) (HandlerFunc, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	h, ok := s.handlers[jobType]
	return h, ok
}

// Schedule creates a durable recurring (or one-shot) job.
func (s *Service) Schedule(ctx context.Context, j Job) (*Job, error) {
	if j.JobType == "" {
		return nil, fmt.Errorf("scheduler: job_type required")
	}
	if j.OwnerUserID == "" {
		return nil, fmt.Errorf("scheduler: owner_user_id required")
	}
	if j.ID == "" {
		j.ID = uuid.New().String()
	}
	if j.Status == "" {
		j.Status = JobActive
	}
	if j.MaxRetries == 0 {
		j.MaxRetries = 5
	}
	if j.NextRunAt.IsZero() {
		j.NextRunAt = time.Now()
	}
	payload, err := json.Marshal(j.Payload)
	if err != nil {
		return nil, fmt.Errorf("scheduler: marshal payload: %w", err)
	}
	const q = `
		INSERT INTO scheduler_jobs
		  (id, job_type, owner_user_id, entity_ref, payload, status,
		   interval_secs, next_run_at, max_runs, max_retries)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
	_, err = s.db.Exec(ctx, q, j.ID, j.JobType, j.OwnerUserID, j.EntityRef, payload,
		string(j.Status), j.IntervalSecs, j.NextRunAt, j.MaxRuns, j.MaxRetries)
	if err != nil {
		return nil, fmt.Errorf("scheduler: insert job: %w", err)
	}
	return &j, nil
}

// Pause / Resume / Cancel are guarded status transitions (NL-12 audited by caller).
func (s *Service) Pause(ctx context.Context, jobID string) error {
	return s.setStatus(ctx, jobID, JobActive, JobPaused)
}
func (s *Service) Resume(ctx context.Context, jobID string) error {
	return s.setStatus(ctx, jobID, JobPaused, JobActive)
}
func (s *Service) Cancel(ctx context.Context, jobID string) error {
	const q = `UPDATE scheduler_jobs SET status='cancelled', updated_at=now()
	           WHERE id=$1 AND status IN ('active','paused')`
	ct, err := s.db.Exec(ctx, q, jobID)
	if err != nil {
		return fmt.Errorf("scheduler: cancel: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("scheduler: job not cancellable (missing or terminal)")
	}
	return nil
}

func (s *Service) setStatus(ctx context.Context, jobID string, from, to JobStatus) error {
	const q = `UPDATE scheduler_jobs SET status=$3, updated_at=now() WHERE id=$1 AND status=$2`
	ct, err := s.db.Exec(ctx, q, jobID, string(from), string(to))
	if err != nil {
		return fmt.Errorf("scheduler: set status: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("scheduler: transition %s->%s not allowed", from, to)
	}
	return nil
}

// RunDue claims and executes every active job whose next_run_at <= now, one
// occurrence per call. It is safe to invoke concurrently from multiple workers:
// each job row is claimed FOR UPDATE SKIP LOCKED, and each occurrence is gated by
// the UNIQUE run key so the side effect runs at most once. Returns the number of
// jobs processed (succeeded or failed).
func (s *Service) RunDue(ctx context.Context) (int, error) {
	const claim = `
		SELECT id, job_type, owner_user_id, entity_ref, payload, status,
		       interval_secs, next_run_at, run_count, max_runs, failure_count, max_retries
		FROM scheduler_jobs
		WHERE status='active' AND next_run_at <= now()
		ORDER BY next_run_at ASC
		LIMIT 100
		FOR UPDATE SKIP LOCKED`

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("scheduler: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, claim)
	if err != nil {
		return 0, fmt.Errorf("scheduler: claim due: %w", err)
	}
	var due []Job
	for rows.Next() {
		var j Job
		var payload []byte
		var status string
		if err := rows.Scan(&j.ID, &j.JobType, &j.OwnerUserID, &j.EntityRef, &payload,
			&status, &j.IntervalSecs, &j.NextRunAt, &j.RunCount, &j.MaxRuns,
			&j.FailureCount, &j.MaxRetries); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scheduler: scan due: %w", err)
		}
		j.Status = JobStatus(status)
		if len(payload) > 0 {
			_ = json.Unmarshal(payload, &j.Payload)
		}
		due = append(due, j)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	processed := 0
	for _, j := range due {
		// Reschedule the row inside this tx (advance or terminate). The run record
		// + side effect execute after commit so a long handler does not hold the
		// row lock; the UNIQUE run key still guarantees once-only execution.
		if err := s.advance(ctx, tx, j); err != nil {
			return processed, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("scheduler: commit reschedule: %w", err)
	}

	for _, j := range due {
		s.execute(ctx, j)
		processed++
	}
	return processed, nil
}

// advance moves the job's next_run_at forward (or completes a bounded job).
// For a missed/overdue occurrence the next run is computed from the scheduled
// time, not from now — so a poller outage catches up one occurrence per poll
// rather than silently skipping the gap.
func (s *Service) advance(ctx context.Context, tx pgx.Tx, j Job) error {
	newCount := j.RunCount + 1
	if j.IntervalSecs <= 0 || (j.MaxRuns > 0 && newCount >= j.MaxRuns) {
		const done = `UPDATE scheduler_jobs SET status='completed', run_count=$2,
		              last_run_at=now(), updated_at=now() WHERE id=$1`
		_, err := tx.Exec(ctx, done, j.ID, newCount)
		return err
	}
	next := j.NextRunAt.Add(time.Duration(j.IntervalSecs) * time.Second)
	const upd = `UPDATE scheduler_jobs SET next_run_at=$2, run_count=$3,
	             last_run_at=now(), updated_at=now() WHERE id=$1`
	_, err := tx.Exec(ctx, upd, j.ID, next, newCount)
	return err
}

// execute runs one occurrence with idempotent run-record insertion + retry/backoff.
func (s *Service) execute(ctx context.Context, j Job) {
	runKey := fmt.Sprintf("%s:%d", j.ID, j.NextRunAt.Unix())

	// Idempotent claim of the occurrence: UNIQUE(run_key) makes a duplicate a no-op.
	const insertRun = `
		INSERT INTO scheduler_runs (id, job_id, run_key, status, scheduled_for, started_at)
		VALUES ($1,$2,$3,'pending',$4,now())
		ON CONFLICT (run_key) DO NOTHING`
	ct, err := s.db.Exec(ctx, insertRun, uuid.New().String(), j.ID, runKey, j.NextRunAt)
	if err != nil {
		return
	}
	if ct.RowsAffected() == 0 {
		return // occurrence already executed elsewhere
	}

	h, ok := s.handlerFor(j.JobType)
	if !ok {
		s.finishRun(ctx, runKey, RunFailed, "no handler registered for "+j.JobType)
		return
	}

	hctx := runCtx{ctx: ctx, job: j, idemKey: runKey}
	if herr := h(hctx); herr != nil {
		s.finishRun(ctx, runKey, RunFailed, herr.Error())
		s.scheduleRetry(ctx, j)
		return
	}
	s.finishRun(ctx, runKey, RunSucceeded, "")
	// success clears the consecutive-failure backoff counter
	_, _ = s.db.Exec(ctx, `UPDATE scheduler_jobs SET failure_count=0, updated_at=now() WHERE id=$1`, j.ID)
}

func (s *Service) finishRun(ctx context.Context, runKey string, status RunStatus, errMsg string) {
	const q = `UPDATE scheduler_runs SET status=$2, error=$3, finished_at=now() WHERE run_key=$1`
	_, _ = s.db.Exec(ctx, q, runKey, string(status), errMsg)
}

// scheduleRetry applies exponential backoff bounded by max_retries. When the
// retry budget is exhausted the job is paused (NL-1: never auto-advance money on
// repeated failure) for operator review.
func (s *Service) scheduleRetry(ctx context.Context, j Job) {
	failures := j.FailureCount + 1
	if failures > j.MaxRetries {
		_, _ = s.db.Exec(ctx, `UPDATE scheduler_jobs SET status='paused', failure_count=$2, updated_at=now() WHERE id=$1`, j.ID, failures)
		return
	}
	delay := s.backoffBase
	for i := 1; i < failures; i++ {
		delay *= 2
		if delay >= s.backoffMax {
			delay = s.backoffMax
			break
		}
	}
	retryAt := time.Now().Add(delay)
	_, _ = s.db.Exec(ctx,
		`UPDATE scheduler_jobs SET next_run_at=$2, failure_count=$3, updated_at=now() WHERE id=$1`,
		j.ID, retryAt, failures)
}
