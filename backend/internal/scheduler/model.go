package scheduler

import (
	"context"
	"time"
)

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
	ID            string         `json:"id"`
	JobType       string         `json:"job_type"`        // registered handler key, e.g. "savings.autosave"
	OwnerUserID   string         `json:"owner_user_id"`   // FK auth.users(id)
	EntityRef     string         `json:"entity_ref"`      // domain object this job drives (vault id, sub id…)
	Payload       map[string]any `json:"payload"`         // handler-specific, versioned config snapshot
	Status        JobStatus      `json:"status"`
	IntervalSecs  int64          `json:"interval_secs"`   // cadence; 0 = one-shot
	NextRunAt     time.Time      `json:"next_run_at"`
	LastRunAt     *time.Time     `json:"last_run_at,omitempty"`
	RunCount      int64          `json:"run_count"`
	MaxRuns       int64          `json:"max_runs"`        // 0 = unbounded
	FailureCount  int            `json:"failure_count"`   // consecutive failures (for backoff)
	MaxRetries    int            `json:"max_retries"`     // per-occurrence retry budget
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
}

// Run is an immutable record of one attempt to execute a job occurrence.
// RunKey is UNIQUE per (job, occurrence) so a poller crash or double-invoke can
// never double-apply the side effect — the handler's own idempotency key is
// derived from RunKey.
type Run struct {
	ID        string    `json:"id"`
	JobID     string    `json:"job_id"`
	RunKey    string    `json:"run_key"`    // UNIQUE: jobID + ":" + scheduled-occurrence epoch
	Status    RunStatus `json:"status"`
	Error     string    `json:"error,omitempty"`
	ScheduledFor time.Time `json:"scheduled_for"`
	StartedAt time.Time `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
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
