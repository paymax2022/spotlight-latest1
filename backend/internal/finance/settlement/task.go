package settlement

// asynq wiring for the recurring settlement processor (Task 5.2).
//
// Two task types:
//
//	settlement:recurring:sweep — periodic; lists due templates and enqueues one
//	                             run task per occurrence.
//	settlement:recurring:run   — executes one (template, runAt) occurrence via
//	                             Processor.RunOccurrence.
//
// Run tasks carry TaskID = OccurrenceKey so a sweep that re-lists a still-queued
// occurrence cannot enqueue it twice; the Processor's lock, compare-and-set
// and ledger idempotency keys are the real guarantees beyond that.

import (
	"encoding/json"
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	platformRedis "spotlight/backend/internal/platform/redis"
)

const (
	TypeRecurringSweep = "settlement:recurring:sweep"
	TypeRecurringRun   = "settlement:recurring:run"

	recurringQueue      = "critical"
	recurringMaxRetry   = 8
	recurringSweepLimit = 200
)

// RecurringRunPayload identifies one occurrence.
type RecurringRunPayload struct {
	TemplateID string `json:"template_id"`
	RunAtUnix  int64  `json:"run_at_unix"`
}

// Enqueuer is the part of *asynq.Client the task layer uses.
type Enqueuer interface {
	EnqueueContext(ctx context.Context, task *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error)
}

// NewRecurringRunTask builds the run task for an occurrence.
func NewRecurringRunTask(templateID string, runAt time.Time) (*asynq.Task, []asynq.Option, error) {
	b, err := json.Marshal(RecurringRunPayload{TemplateID: templateID, RunAtUnix: runAt.UTC().Unix()})
	if err != nil {
		return nil, nil, err
	}
	return asynq.NewTask(TypeRecurringRun, b), []asynq.Option{
		asynq.Queue(recurringQueue),
		asynq.MaxRetry(recurringMaxRetry),
		asynq.TaskID(OccurrenceKey(templateID, runAt)),
		asynq.Timeout(2 * time.Minute),
	}, nil
}

// TaskHandlers holds the asynq handlers for the processor.
type TaskHandlers struct {
	Processor *Processor
	Store     RecurringStore
	Enqueuer  Enqueuer
}

// Register attaches both handlers to mux.
func (h *TaskHandlers) Register(mux *asynq.ServeMux) {
	mux.HandleFunc(TypeRecurringSweep, h.HandleSweep)
	mux.HandleFunc(TypeRecurringRun, h.HandleRun)
}

// HandleSweep enqueues a run task for every due occurrence.
func (h *TaskHandlers) HandleSweep(ctx context.Context, _ *asynq.Task) error {
	due, err := h.Store.ListDue(ctx, h.Processor.now().UTC(), recurringSweepLimit)
	if err != nil {
		return fmt.Errorf("settlement sweep: %w", err) // retried by asynq
	}
	for _, t := range due {
		task, opts, err := NewRecurringRunTask(t.ID, t.NextRunAt)
		if err != nil {
			log.Printf("[settlement] sweep: build task %s: %v", t.ID, err)
			continue
		}
		if _, err := h.Enqueuer.EnqueueContext(ctx, task, opts...); err != nil &&
			!errors.Is(err, asynq.ErrTaskIDConflict) && !errors.Is(err, asynq.ErrDuplicateTask) {
			return fmt.Errorf("settlement sweep: enqueue %s: %w", t.ID, err)
		}
	}
	return nil
}

// HandleRun executes one occurrence.
//   - done / already done  → nil (task acked)
//   - locked / transient   → error (asynq retries with backoff; a later retry
//     finds the occurrence completed and returns ErrNotDue → nil)
//   - invalid template     → SkipRetry (retrying cannot fix the data)
func (h *TaskHandlers) HandleRun(ctx context.Context, t *asynq.Task) error {
	var p RecurringRunPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil || p.TemplateID == "" || p.RunAtUnix == 0 {
		return fmt.Errorf("settlement run: bad payload: %w", asynq.SkipRetry)
	}
	err := h.Processor.RunOccurrence(ctx, p.TemplateID, time.Unix(p.RunAtUnix, 0).UTC())
	switch {
	case err == nil, errors.Is(err, ErrNotDue):
		return nil
	case errors.Is(err, ErrInvalidTemplate):
		return fmt.Errorf("%v: %w", err, asynq.SkipRetry)
	default:
		return err
	}
}

// RunSweepLoop enqueues a sweep task every interval until ctx ends. The task ID
// is bucketed by interval so replicas running the loop enqueue one sweep per tick.
func RunSweepLoop(ctx context.Context, enq Enqueuer, interval time.Duration) {
	if interval <= 0 {
		interval = time.Minute
	}
	tick := func(now time.Time) {
		bucket := now.UTC().Unix() / int64(interval/time.Second)
		_, err := enq.EnqueueContext(ctx, asynq.NewTask(TypeRecurringSweep, nil),
			asynq.Queue(recurringQueue), asynq.MaxRetry(3),
			asynq.TaskID(fmt.Sprintf("recsettle:sweep:%d", bucket)),
			asynq.Retention(interval))
		if err != nil && !errors.Is(err, asynq.ErrTaskIDConflict) && !errors.Is(err, asynq.ErrDuplicateTask) {
			log.Printf("[settlement] enqueue sweep: %v", err)
		}
	}
	tick(time.Now())
	tk := time.NewTicker(interval)
	defer tk.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-tk.C:
			tick(now)
		}
	}
}

// RedisLocker adapts the platform Redis lock helpers to Locker.
type RedisLocker struct{ Client *goredis.Client }

func (l RedisLocker) Acquire(ctx context.Context, key string, ttl time.Duration) (string, bool, error) {
	ok, token, err := platformRedis.AcquireLock(ctx, l.Client, key, ttl)
	if err != nil || !ok {
		return "", false, err
	}
	return token, true, nil
}

func (l RedisLocker) Release(ctx context.Context, key, token string) error {
	return platformRedis.ReleaseLock(ctx, l.Client, key, token)
}

// PGRecurringStore is the pgx-backed RecurringStore (table recurring_settlement_templates).
type PGRecurringStore struct{ DB *pgxpool.Pool }

const recurringCols = `id::text, name, source_account_id::text, amount_kobo, schedule, COALESCE(anchor_day,0), splits, next_run_at, active`

func scanTemplate(row pgx.Row) (*RecurringTemplate, error) {
	var t RecurringTemplate
	var sched string
	var raw []byte
	if err := row.Scan(&t.ID, &t.Name, &t.SourceAccountID, &t.AmountKobo, &sched, &t.AnchorDay, &raw, &t.NextRunAt, &t.Active); err != nil {
		return nil, err
	}
	t.Schedule = RecurringSchedule(sched)
	if err := json.Unmarshal(raw, &t.Splits); err != nil {
		return nil, fmt.Errorf("template %s splits: %w", t.ID, err)
	}
	return &t, nil
}

func (s PGRecurringStore) ListDue(ctx context.Context, now time.Time, limit int) ([]RecurringTemplate, error) {
	rows, err := s.DB.Query(ctx, `SELECT `+recurringCols+` FROM recurring_settlement_templates
		WHERE active AND next_run_at <= $1 ORDER BY next_run_at LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RecurringTemplate
	for rows.Next() {
		t, err := scanTemplate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func (s PGRecurringStore) Get(ctx context.Context, id string) (*RecurringTemplate, error) {
	t, err := scanTemplate(s.DB.QueryRow(ctx, `SELECT `+recurringCols+` FROM recurring_settlement_templates WHERE id=$1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return t, err
}

func (s PGRecurringStore) CompleteRun(ctx context.Context, id string, expectedRunAt, nextRunAt, ranAt time.Time) (bool, error) {
	tag, err := s.DB.Exec(ctx, `UPDATE recurring_settlement_templates
		SET next_run_at=$3, last_run_at=$4, updated_at=now()
		WHERE id=$1::uuid AND next_run_at=$2`, id, expectedRunAt, nextRunAt, ranAt)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}
