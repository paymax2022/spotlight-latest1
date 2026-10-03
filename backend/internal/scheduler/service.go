package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"log"
	"sync"
	"time"
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

// processHandlers is the PROCESS-WIDE job-type registry. Every module mount
// constructs its own *Service and registers handlers on it (savings autosave,
// creators subscriptions, health licence sweeps, maps OSM batches...), while the
// durable-job poller wired in internal/app runs on a separate Service instance
// in the same process. RegisterJobType therefore writes to this shared registry
// too, so the poller can resolve handlers it never saw directly. Job-type keys
// are globally unique strings, so sharing is safe; last registration wins, same
// rule as the per-instance map.
var processHandlers = struct {
	sync.RWMutex

	m map[string]HandlerFunc
}{m: make(map[string]HandlerFunc)}

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
	// noHandlerWarnAt throttles the "no handler registered" warning per job
	// type: an unhandled due job is re-claimed every poll (see RunDue), so
	// per-occurrence logging would spam at the poll cadence.
	noHandlerWarnAt map[string]time.Time
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{
		db:              db,
		handlers:        make(map[string]HandlerFunc),
		backoffBase:     30 * time.Second,
		backoffMax:      6 * time.Hour,
		noHandlerWarnAt: make(map[string]time.Time),
	}
}

// RegisterJobType binds a handler to a job-type key. Consumers (savings auto-save,
// Ajo cycle debit, subscriptions) register their side effect once at wiring time.
// Registration is process-wide (see processHandlers): a poller running on ANY
// Service instance in this process resolves it.
func (s *Service) RegisterJobType(jobType string, h HandlerFunc) {
	s.mu.Lock()
	s.handlers[jobType] = h
	s.mu.Unlock()
	processHandlers.Lock()
	processHandlers.m[jobType] = h
	processHandlers.Unlock()
}

// HasHandler reports whether a handler is registered for jobType on this
// instance OR process-wide. App wiring uses it to fill gaps with stub handlers
// only when the owning module is not mounted (so a real registration, whenever
// it lands, always wins — RegisterJobType overwrites).
func (s *Service) HasHandler(jobType string) bool {
	_, ok := s.handlerFor(jobType)
	return ok
}

func (s *Service) handlerFor(jobType string) (HandlerFunc, bool) {
	s.mu.RLock()
	h, ok := s.handlers[jobType]
	s.mu.RUnlock()
	if ok {
		return h, true
	}
	processHandlers.RLock()
	h, ok = processHandlers.m[jobType]
	processHandlers.RUnlock()
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

// noHandlerWarnInterval is how often a "no handler registered" warning is
// logged per job type. Unhandled jobs stay due and are re-claimed every poll;
// without the throttle the warning would fire once per interval per job.
const noHandlerWarnInterval = 5 * time.Minute

// RunDue claims and executes every active job whose next_run_at <= now, one
// occurrence per call. It is safe to invoke concurrently from multiple workers:
// each job row is claimed FOR UPDATE SKIP LOCKED, and each occurrence is gated by
// the UNIQUE run key so the side effect runs at most once. Returns the number of
// jobs processed (succeeded or failed).
//
// Jobs whose job_type has NO registered handler are skipped WITHOUT advancing
// next_run_at: they stay due and are retried every poll rather than burning the
// occurrence as a failed run. That matters because modules are feature-flagged
// — a deploy with e.g. creators disabled must not eat the subscription charges
// scheduled while it was on; when the module (and its handler) returns, the job
// fires. The gap is observable via a throttled warning per job type.
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

	// Split due jobs into handled (executable) and unhandled (left due). The
	// unhandled split happens BEFORE advance: never consume an occurrence for a
	// job type this process cannot run.
	var runnable []Job
	for _, j := range due {
		if _, ok := s.handlerFor(j.JobType); !ok {
			s.warnNoHandler(j.JobType)
			continue
		}
		runnable = append(runnable, j)
	}

	processed := 0
	for _, j := range runnable {
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

	for _, j := range runnable {
		s.execute(ctx, j)
		processed++
	}
	return processed, nil
}

// warnNoHandler logs a throttled warning for a due job type nobody registered.
func (s *Service) warnNoHandler(jobType string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t, ok := s.noHandlerWarnAt[jobType]; ok && time.Since(t) < noHandlerWarnInterval {
		return
	}
	s.noHandlerWarnAt[jobType] = time.Now()
	log.Printf("[scheduler] job_type=%q is due but has no registered handler in this process — occurrence left pending (is the owning module flag-enabled?)", jobType)
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
	// runHandler recovers panics: a handler panic must mark THIS run failed and
	// schedule a retry, never crash the process (execute runs inside the poller
	// goroutine — an unrecovered panic would take the whole API server down).
	if herr := runHandler(h, hctx); herr != nil {
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

// runHandler invokes the handler, converting a panic into an error so the
// run can be marked failed and retried through the normal backoff path.
func runHandler(h HandlerFunc, hctx runCtx) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("scheduler: handler panic: %v", r)
		}
	}()
	return h(hctx)
}

// Poll drives RunDue on a fixed interval until ctx is cancelled. This is the
// missing half of the durable-job design (E2E-BE-005): modules Schedule() jobs
// and register handlers, and exactly one poller per process drains the due set.
// The claim is FOR UPDATE SKIP LOCKED and the occurrence is UNIQUE-keyed, so
// running Poll on every API replica is safe (at-most-once per occurrence).
//
// Shutdown: when ctx is cancelled the loop exits at the next select. An
// in-flight RunDue sees the cancelled ctx — its claim tx rolls back, leaving
// claimed jobs due for the next boot, and in-flight handlers are expected to
// honour ctx. The first tick runs immediately so jobs that came due while the
// process was down don't wait a full interval.
func (s *Service) Poll(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	s.pollOnce(ctx)
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Printf("[scheduler] poller stopped: %v", ctx.Err())
			return
		case <-t.C:
			s.pollOnce(ctx)
		}
	}
}

func (s *Service) pollOnce(ctx context.Context) {
	n, err := s.RunDue(ctx)
	switch {
	case err != nil:
		log.Printf("[scheduler] poll error: %v", err)
	case n > 0:
		log.Printf("[scheduler] poll processed %d due job(s)", n)
	}
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

// JobStatus tracks a scheduled job's lifecycle.
type JobStatus string

const (
	JobActive    JobStatus = "active"
	JobPaused    JobStatus = "paused"
	JobCompleted JobStatus = "completed"
	JobCancelled JobStatus = "cancelled"
)

// RunStatus tracks the outcome of a single run attempt.
type RunStatus string

const (
	RunPending   RunStatus = "pending"
	RunSucceeded RunStatus = "succeeded"
	RunFailed    RunStatus = "failed"
)

// Job is a durable recurring job (auto-save debit, subscription charge, Ajo
// cycle auto-debit, etc.). The scheduler owns scheduling/retry/idempotency; the
// registered JobType handler owns the side effect (which itself REUSES the
// finance ledger — NL-8/NL-9). The scheduler never moves money directly.
type Job struct {
	ID           string         `json:"id"`
	JobType      string         `json:"job_type"`      // registered handler key, e.g. "savings.autosave"
	OwnerUserID  string         `json:"owner_user_id"` // FK auth.users(id)
	EntityRef    string         `json:"entity_ref"`    // domain object this job drives (vault id, sub id…)
	Payload      map[string]any `json:"payload"`       // handler-specific, versioned config snapshot
	Status       JobStatus      `json:"status"`
	IntervalSecs int64          `json:"interval_secs"`
	NextRunAt    time.Time      `json:"next_run_at"`
	LastRunAt    *time.Time     `json:"last_run_at,omitempty"`
	RunCount     int64          `json:"run_count"`
	MaxRuns      int64          `json:"max_runs"`
	FailureCount int            `json:"failure_count"` // consecutive failures (for backoff)
	MaxRetries   int            `json:"max_retries"`   // per-occurrence retry budget
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

// Run is an immutable record of one attempt to execute a job occurrence.
// RunKey is UNIQUE per (job, occurrence) so a poller crash or double-invoke can
// never double-apply the side effect — the handler's own idempotency key is
// derived from RunKey.
type Run struct {
	ID           string     `json:"id"`
	JobID        string     `json:"job_id"`
	RunKey       string     `json:"run_key"` // UNIQUE: jobID + ":" + scheduled-occurrence epoch
	Status       RunStatus  `json:"status"`
	Error        string     `json:"error,omitempty"`
	ScheduledFor time.Time  `json:"scheduled_for"`
	StartedAt    time.Time  `json:"started_at"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
}

// HandlerCtx is the public surface a registered handler sees for one occurrence.
// IdemKey is derived from the durable run key and MUST be threaded into any money
// movement so retries are safe (NL-9). Consumers depend only on this interface,
// never on scheduler internals.
type HandlerCtx interface {
	Context() context.Context
	IdemKey() string
	Job() JobView
}

// JobView is the read-only projection of the job a handler may consult.
type JobView interface {
	ID() string
	OwnerUserID() string
	EntityRef() string
	PayloadValue(key string) (any, bool)
}

// HandlerFunc executes a single job occurrence. Returning an error marks the run
// failed and schedules a backoff retry.
type HandlerFunc func(ctx HandlerCtx) error
