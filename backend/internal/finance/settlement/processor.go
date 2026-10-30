package settlement

// Recurring settlement processor (Phase 2, Task 5.2).
//
// A RecurringTemplate describes a scheduled payout: move AmountKobo out of a
// source ledger account into N destination accounts per a basis-point split,
// every day / week / month. The Processor runs one due occurrence at a time:
//
//	lock(template, runAt) → re-read template → post balanced legs → advance next_run_at → unlock
//
// Safety properties (CLAUDE.md money iron rules):
//   - Integer kobo and integer basis points only — no floats anywhere here.
//   - Every leg is a balanced DEBIT(source)/CREDIT(destination) journal via
//     the ledger, keyed "<templateID>:<runAt unix>:<leg>" so a replay of the
//     same occurrence can never double-post, even if the Redlock is lost.
//   - The lock is an optimisation against concurrent work; the ledger key is
//     the correctness guarantee. next_run_at is advanced with a
//     compare-and-set on the occurrence being completed, so two workers can
//     never both advance the schedule.
//   - A mid-way failure leaves the already-posted legs in place and does NOT
//     advance the schedule; the retry re-posts every leg and the ledger
//     deduplicates the ones that landed.
//
// System-initiated: the source account is a platform/standing account chosen
// by an operator, so legs post via the ungated PostJournal (no user-wallet
// tier cap applies). Templates must never name a user wallet as source.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strconv"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// RecurringSchedule is how often a template fires.
type RecurringSchedule string

const (
	ScheduleDaily   RecurringSchedule = "daily"
	ScheduleWeekly  RecurringSchedule = "weekly"
	ScheduleMonthly RecurringSchedule = "monthly"
)

// TotalBps is 100% expressed in basis points.
const TotalBps int64 = 10000

// Errors surfaced by the processor.
var (
	// ErrLocked: another worker holds the lock for this occurrence.
	ErrLocked = errors.New("settlement: occurrence is locked by another worker")
	// ErrNotDue: the template is inactive or its next_run_at no longer matches
	// the requested occurrence (already completed by a previous run).
	ErrNotDue = errors.New("settlement: occurrence is not due or already completed")
	// ErrInvalidTemplate: the template cannot produce balanced postings.
	ErrInvalidTemplate = errors.New("settlement: invalid recurring template")
)

// RecurringSplit is one destination's share, in basis points (1 bp = 0.01%).
type RecurringSplit struct {
	AccountID string `json:"account_id"`
	Bps       int64  `json:"bps"`
}

// RecurringTemplate is a recurring settlement definition.
type RecurringTemplate struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	SourceAccountID string            `json:"source_account_id"`
	AmountKobo      int64             `json:"amount_kobo"`
	Schedule        RecurringSchedule `json:"schedule"`
	// AnchorDay is the intended day of month (1-31) for monthly schedules; it
	// is kept separately so a clamped February run does not drag every later
	// month onto the 28th.
	AnchorDay int              `json:"anchor_day,omitempty"`
	Splits    []RecurringSplit `json:"splits"`
	NextRunAt time.Time        `json:"next_run_at"`
	Active    bool             `json:"active"`
}

// RecurringLeg is one computed destination posting.
type RecurringLeg struct {
	AccountID  string
	AmountKobo int64
}

// Validate checks the template can produce balanced, positive postings.
func (t RecurringTemplate) Validate() error {
	if t.ID == "" || t.SourceAccountID == "" {
		return fmt.Errorf("%w: id and source account are required", ErrInvalidTemplate)
	}
	if t.AmountKobo <= 0 {
		return fmt.Errorf("%w: amount must be positive kobo, got %d", ErrInvalidTemplate, t.AmountKobo)
	}
	switch t.Schedule {
	case ScheduleDaily, ScheduleWeekly:
	case ScheduleMonthly:
		if t.AnchorDay < 1 || t.AnchorDay > 31 {
			return fmt.Errorf("%w: monthly anchor_day must be 1-31, got %d", ErrInvalidTemplate, t.AnchorDay)
		}
	default:
		return fmt.Errorf("%w: unknown schedule %q", ErrInvalidTemplate, t.Schedule)
	}
	if len(t.Splits) == 0 {
		return fmt.Errorf("%w: at least one split is required", ErrInvalidTemplate)
	}
	var sum int64
	seen := make(map[string]bool, len(t.Splits))
	for _, s := range t.Splits {
		if s.AccountID == "" || s.AccountID == t.SourceAccountID {
			return fmt.Errorf("%w: split account must be set and differ from the source", ErrInvalidTemplate)
		}
		if seen[s.AccountID] {
			return fmt.Errorf("%w: duplicate split account %s", ErrInvalidTemplate, s.AccountID)
		}
		seen[s.AccountID] = true
		if s.Bps <= 0 {
			return fmt.Errorf("%w: split bps must be positive, got %d", ErrInvalidTemplate, s.Bps)
		}
		sum += s.Bps
	}
	if sum != TotalBps {
		return fmt.Errorf("%w: splits must sum to %d bps, got %d", ErrInvalidTemplate, TotalBps, sum)
	}
	return nil
}

// ComputeRecurringLegs divides AmountKobo across the splits in whole kobo.
// Each non-final leg is floor(amount*bps/10000); the LAST split absorbs the
// rounding remainder so the legs always sum to exactly AmountKobo. Legs that
// round to zero are dropped (the ledger rejects non-positive amounts).
func ComputeRecurringLegs(t RecurringTemplate) ([]RecurringLeg, error) {
	if err := t.Validate(); err != nil {
		return nil, err
	}
	legs := make([]RecurringLeg, 0, len(t.Splits))
	var allocated int64
	q, r := t.AmountKobo/TotalBps, t.AmountKobo%TotalBps
	for i, s := range t.Splits {
		var amt int64
		if i == len(t.Splits)-1 {
			amt = t.AmountKobo - allocated
		} else {
			// floor(amount*bps/10000) without overflowing int64 on large amounts.
			amt = q*s.Bps + r*s.Bps/TotalBps
		}
		allocated += amt
		if amt > 0 {
			legs = append(legs, RecurringLeg{AccountID: s.AccountID, AmountKobo: amt})
		}
	}
	return legs, nil
}

// NextRun returns the occurrence after prev. Monthly runs land on anchorDay,
// clamped to the month's length (Jan 31 → Feb 28/29 → Mar 31). Always UTC and
// always computed from the scheduled time, never from wall-clock "now", so a
// late worker does not shift the cadence.
func NextRun(prev time.Time, schedule RecurringSchedule, anchorDay int) (time.Time, error) {
	prev = prev.UTC()
	switch schedule {
	case ScheduleDaily:
		return prev.AddDate(0, 0, 1), nil
	case ScheduleWeekly:
		return prev.AddDate(0, 0, 7), nil
	case ScheduleMonthly:
		if anchorDay < 1 || anchorDay > 31 {
			return time.Time{}, fmt.Errorf("%w: monthly anchor_day must be 1-31, got %d", ErrInvalidTemplate, anchorDay)
		}
		y, m, _ := prev.Date()
		// First day of the following month, then clamp to its length.
		first := time.Date(y, m+1, 1, prev.Hour(), prev.Minute(), prev.Second(), prev.Nanosecond(), time.UTC)
		last := first.AddDate(0, 1, -1).Day()
		day := anchorDay
		if day > last {
			day = last
		}
		return time.Date(first.Year(), first.Month(), day, prev.Hour(), prev.Minute(), prev.Second(), prev.Nanosecond(), time.UTC), nil
	default:
		return time.Time{}, fmt.Errorf("%w: unknown schedule %q", ErrInvalidTemplate, schedule)
	}
}

// RecurringStore persists templates.
type RecurringStore interface {
	// ListDue returns active templates with next_run_at <= now, oldest first.
	ListDue(ctx context.Context, now time.Time, limit int) ([]RecurringTemplate, error)
	// Get returns one template (nil, nil when it does not exist).
	Get(ctx context.Context, id string) (*RecurringTemplate, error)
	// CompleteRun advances next_run_at to nextRunAt and stamps last_run_at, but
	// only while next_run_at still equals expectedRunAt (compare-and-set).
	// advanced=false means another worker already completed this occurrence.
	CompleteRun(ctx context.Context, id string, expectedRunAt, nextRunAt, ranAt time.Time) (advanced bool, err error)
}

// JournalPoster is the slice of ledger.Service the processor needs.
type JournalPoster interface {
	PostJournal(ctx context.Context, j ledger.JournalEntry) error
	Posted(ctx context.Context, baseIdempotencyKey string) (bool, error)
}

// Locker is a distributed lock (Redlock-style single-node SET NX PX + token-checked release).
type Locker interface {
	Acquire(ctx context.Context, key string, ttl time.Duration) (token string, ok bool, err error)
	Release(ctx context.Context, key, token string) error
}

// RecurringAuditor is the immutable audit sink (same shape as transfers.Auditor). May be nil.
type RecurringAuditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Processor runs due recurring settlements.
type Processor struct {
	store   RecurringStore
	poster  JournalPoster
	locker  Locker
	auditor RecurringAuditor
	lockTTL time.Duration
	now     func() time.Time
}

// ProcessorOption customises a Processor.
type ProcessorOption func(*Processor)

// WithAuditor attaches the audit sink.
func WithAuditor(a RecurringAuditor) ProcessorOption { return func(p *Processor) { p.auditor = a } }

// WithLockTTL overrides the default 2-minute lock TTL.
func WithLockTTL(d time.Duration) ProcessorOption { return func(p *Processor) { p.lockTTL = d } }

// WithClock injects a clock (tests).
func WithClock(now func() time.Time) ProcessorOption { return func(p *Processor) { p.now = now } }

// NewProcessor wires a processor. store, poster and locker are required.
func NewProcessor(store RecurringStore, poster JournalPoster, locker Locker, opts ...ProcessorOption) *Processor {
	p := &Processor{store: store, poster: poster, locker: locker, lockTTL: 2 * time.Minute, now: time.Now}
	for _, o := range opts {
		o(p)
	}
	return p
}

// OccurrenceKey is the stable identity of one run of one template. It is the
// Redlock key suffix and the ledger idempotency-key prefix.
func OccurrenceKey(templateID string, runAt time.Time) string {
	return "recsettle:" + templateID + ":" + strconv.FormatInt(runAt.UTC().Unix(), 10)
}

// RunOccurrence executes the occurrence of templateID scheduled at runAt.
//   - ErrLocked: another worker is mid-run (caller should retry later).
//   - ErrNotDue: nothing to do (inactive, or this occurrence already completed).
//
// Safe to call any number of times for the same (templateID, runAt).
func (p *Processor) RunOccurrence(ctx context.Context, templateID string, runAt time.Time) error {
	runAt = runAt.UTC()
	occ := OccurrenceKey(templateID, runAt)

	token, ok, err := p.locker.Acquire(ctx, occ, p.lockTTL)
	if err != nil {
		return fmt.Errorf("settlement: acquire lock %s: %w", occ, err)
	}
	if !ok {
		return ErrLocked
	}
	defer func() {
		// Release on a fresh ctx so a cancelled task still frees the lock.
		rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if rerr := p.locker.Release(rctx, occ, token); rerr != nil {
			log.Printf("[settlement] release lock %s: %v (will expire via TTL)", occ, rerr)
		}
	}()

	// Re-read under the lock: the template may have completed this occurrence
	// (or been deactivated) between enqueue and execution.
	t, err := p.store.Get(ctx, templateID)
	if err != nil {
		return fmt.Errorf("settlement: load template %s: %w", templateID, err)
	}
	if t == nil || !t.Active || !t.NextRunAt.UTC().Equal(runAt) {
		return ErrNotDue
	}
	legs, err := ComputeRecurringLegs(*t)
	if err != nil {
		return err
	}
	// Compute the next run BEFORE moving money so a bad schedule fails closed.
	next, err := NextRun(runAt, t.Schedule, t.AnchorDay)
	if err != nil {
		return err
	}

	for i, leg := range legs {
		key := occ + ":leg" + strconv.Itoa(i)
		jerr := p.poster.PostJournal(ctx, ledger.JournalEntry{
			Reference:       "recurring-settlement:" + t.ID,
			IdempotencyKey:  key,
			AmountKobo:      leg.AmountKobo,
			DebitAccountID:  t.SourceAccountID,
			CreditAccountID: leg.AccountID,
			Description:     "recurring settlement " + t.Name,
		})
		if jerr == nil {
			continue
		}
		// ErrDuplicate is ambiguous (replay vs. key held by a different
		// journal); only the ledger of record can say which.
		if errors.Is(jerr, ledger.ErrDuplicate) {
			if posted, perr := p.poster.Posted(ctx, key); perr == nil && posted {
				continue
			}
		}
		p.audit(t, "recurring_settlement.failed", runAt, "critical", map[string]any{"leg": i, "error": jerr.Error()})
		return fmt.Errorf("settlement: post leg %d of %s: %w", i, occ, jerr)
	}

	advanced, err := p.store.CompleteRun(ctx, t.ID, runAt, next, p.now().UTC())
	if err != nil {
		return fmt.Errorf("settlement: complete run %s: %w", occ, err)
	}
	if advanced {
		p.audit(t, "recurring_settlement.completed", runAt, "info", map[string]any{
			"amount_kobo": t.AmountKobo, "legs": len(legs), "next_run_at": next.Format(time.RFC3339),
		})
	}
	return nil
}

// ProcessDue runs every template due at now, returning how many completed.
// Per-template failures are logged and do not stop the sweep.
func (p *Processor) ProcessDue(ctx context.Context, limit int) (int, error) {
	due, err := p.store.ListDue(ctx, p.now().UTC(), limit)
	if err != nil {
		return 0, fmt.Errorf("settlement: list due: %w", err)
	}
	done := 0
	for _, t := range due {
		switch err := p.RunOccurrence(ctx, t.ID, t.NextRunAt); {
		case err == nil:
			done++
		case errors.Is(err, ErrLocked), errors.Is(err, ErrNotDue):
			// another worker owns it / already finished
		default:
			log.Printf("[settlement] template %s: %v", t.ID, err)
		}
	}
	return done, nil
}

func (p *Processor) audit(t *RecurringTemplate, action string, runAt time.Time, severity string, meta map[string]any) {
	if p.auditor == nil {
		return
	}
	meta["run_at"] = runAt.Format(time.RFC3339)
	p.auditor.LogAction("system", "", action, "settlement", "recurring_template", t.ID, nil, meta, "", "", severity)
}
