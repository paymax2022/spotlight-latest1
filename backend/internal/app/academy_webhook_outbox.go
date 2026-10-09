package app

// academy_webhook_outbox.go — bounded outbox/redrive for academy rail settle
// legs (AUD-BE-013 residual).
//
// The hole this closes: a signed settle webhook consumes its dedupe key in
// academy_rail_webhook_events BEFORE reconcile runs, and the handler still acks
// 200 when PostJournal fails transiently — so the provider never retries, the
// dedupe table swallows any replay, and the escrow→settlement leg was lost.
//
// The fix: a failed leg is parked in academy_webhook_outbox (migration
// 20270324000000). The redrive driver is the NEXT inbound webhook for the
// rail — including the provider's own retry of the same event, which lands on
// the dedupe-hit path. There is deliberately no scheduler binary: the repo's
// workers are per-domain cmd binaries, the webhook surface only exists under
// RAILS_MODE (sandbox/fake rails), and every sandbox provider retries on
// transport failure — the dedupe hit IS the retry signal.
//
// Exactly-once is preserved by the ledger: the parked row reuses the original
// deterministic idempotency key (academy-rail:<rail>:<ref>), so a redrive that
// races a leg that actually landed is an ErrDuplicate no-op and the row flips
// 'posted'. Retries are bounded: exponential backoff to a 30-minute cap, then
// 'exhausted' at academyOutboxMaxAttempts for manual repair.

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

const (
	// academyOutboxDrainLimit bounds each sweep — a backed-up queue can never
	// stall a webhook request.
	academyOutboxDrainLimit = 25
	// academyOutboxMaxAttempts bounds retries: 10 attempts over ~1h of backoff,
	// then the row parks 'exhausted' (durable, queryable) for manual repair.
	academyOutboxMaxAttempts = 10
)

// academyOutboxBackoff is the delay before the next attempt: 30s doubling to a
// 30m cap (attempts is the count AFTER the failed attempt: 1 ⇒ 30s, 2 ⇒ 1m …).
func academyOutboxBackoff(attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	d := 30 * time.Second << (attempts - 1)
	if attempts > 10 || d > 30*time.Minute {
		d = 30 * time.Minute
	}
	return d
}

// academyOutboxRow is one parked settle leg.
type academyOutboxRow struct {
	ID             string
	Rail           string
	ProviderRef    string
	Reference      string
	AmountMinor    int64 // 0 ⇒ no snapshot; redrive re-derives from the obligation row
	IdempotencyKey string
	Attempts       int
	NextRetryAt    time.Time
	LastError      string
}

// academyOutboxStore is the persistence seam: a pgx-backed implementation in
// production, an in-memory one in unit tests (the end-to-end path is exercised
// by the live-DB suite in academy_webhooks_live_db_test.go).
type academyOutboxStore interface {
	// Enqueue parks a pending leg. ON CONFLICT (rail, provider_ref) DO NOTHING:
	// one row per consumed event, first write wins.
	Enqueue(ctx context.Context, row academyOutboxRow) error
	// Due returns pending rows whose retry time has arrived. providerRef ""
	// sweeps every due row on the rail (per-ingest sweep); a concrete ref
	// scopes to one obligation (dedupe-hit redrive).
	Due(ctx context.Context, rail, providerRef string, limit int) ([]academyOutboxRow, error)
	// Complete marks the row posted — the balanced ledger leg exists.
	Complete(ctx context.Context, id string) error
	// Fail records a failed attempt: bumps attempts, backs off, and flips to
	// 'exhausted' once the bound is hit.
	Fail(ctx context.Context, id string, attempts int, nextRetryAt time.Time, lastErr string, exhausted bool) error
}

// pgAcademyOutboxStore is the production store over the money-path pgx pool.
type pgAcademyOutboxStore struct{ pool *pgxpool.Pool }

func (s pgAcademyOutboxStore) Enqueue(ctx context.Context, row academyOutboxRow) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO academy_webhook_outbox
    (rail, provider_ref, reference, amount_minor, idempotency_key, last_error)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (rail, provider_ref) DO NOTHING`,
		row.Rail, row.ProviderRef, row.Reference, row.AmountMinor, row.IdempotencyKey, row.LastError)
	return err
}

func (s pgAcademyOutboxStore) Due(ctx context.Context, rail, providerRef string, limit int) ([]academyOutboxRow, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, rail, provider_ref, reference, amount_minor, idempotency_key, attempts, next_retry_at
FROM academy_webhook_outbox
WHERE status = 'pending'
  AND next_retry_at <= now()
  AND rail = $1
  AND ($2 = '' OR provider_ref = $2)
ORDER BY next_retry_at
LIMIT $3
FOR UPDATE SKIP LOCKED`, rail, providerRef, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []academyOutboxRow
	for rows.Next() {
		var r academyOutboxRow
		if err := rows.Scan(&r.ID, &r.Rail, &r.ProviderRef, &r.Reference,
			&r.AmountMinor, &r.IdempotencyKey, &r.Attempts, &r.NextRetryAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s pgAcademyOutboxStore) Complete(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `
UPDATE academy_webhook_outbox
SET status = 'posted', updated_at = now()
WHERE id = $1 AND status = 'pending'`, id)
	return err
}

func (s pgAcademyOutboxStore) Fail(ctx context.Context, id string, attempts int, nextRetryAt time.Time, lastErr string, exhausted bool) error {
	status := "pending"
	if exhausted {
		status = "exhausted"
	}
	_, err := s.pool.Exec(ctx, `
UPDATE academy_webhook_outbox
SET attempts = $2, next_retry_at = $3, last_error = $4, status = $5, updated_at = now()
WHERE id = $1 AND status = 'pending'`, id, attempts, nextRetryAt, lastErr, status)
	return err
}

// enqueueOutbox parks a failed settle leg. amount is the obligation row's
// committed amount when known, else 0 (redrive re-derives it). A nil store or
// an enqueue failure only logs — the dedupe row is already consumed, so the log
// line is the last-resort signal for manual repair.
func (h *academyWebhookHandler) enqueueOutbox(ctx context.Context, rail string, evt academyWebhookEvent, amount int64, cause error) {
	if h.outbox == nil {
		return
	}
	err := h.outbox.Enqueue(ctx, academyOutboxRow{
		Rail:           rail,
		ProviderRef:    evt.Ref,
		Reference:      evt.Reference,
		AmountMinor:    amount,
		IdempotencyKey: academyRailIdemKey(rail, evt.Ref),
		LastError:      cause.Error(),
	})
	if err != nil {
		log.Printf("[academy-webhooks] outbox enqueue failed rail=%s ref=%s: %v — settle leg unposted, manual repair required", rail, evt.Ref, err)
	}
}

// redrivePending drains due parked legs: every due row on the rail when
// providerRef is "", else just that obligation's row. Called on the dedupe-hit
// path (the provider's retry of a consumed event is the retry signal) and on
// every fresh ingest (a bounded sweep, since the sandbox provider does not
// retry a 2xx — later events are the queue driver).
func (h *academyWebhookHandler) redrivePending(ctx context.Context, rail, providerRef string) {
	if h.outbox == nil {
		return
	}
	rows, err := h.outbox.Due(ctx, rail, providerRef, academyOutboxDrainLimit)
	if err != nil {
		log.Printf("[academy-webhooks] outbox sweep failed rail=%s ref=%q: %v", rail, providerRef, err)
		return
	}
	for _, row := range rows {
		h.redriveRow(ctx, row)
	}
}

// redriveRow attempts one parked leg. Amount comes from the outbox snapshot or,
// when none was captured, is re-derived from the obligation row's committed
// state — never from the webhook payload.
func (h *academyWebhookHandler) redriveRow(ctx context.Context, row academyOutboxRow) {
	if h.ledger == nil {
		// releaseEscrowToSettlement is a silent no-op on a nil ledger — that
		// must NOT complete the row or the leg is lost again. Back off instead.
		h.failOutboxRow(ctx, row, "ledger service unavailable")
		return
	}
	amount := row.AmountMinor
	if amount <= 0 {
		q := settleAmountQueries[row.Rail]
		if q == "" || h.pool == nil {
			h.failOutboxRow(ctx, row, "no amount snapshot and no obligation query")
			return
		}
		if err := h.pool.QueryRow(ctx, q, row.ProviderRef).Scan(&amount); err != nil {
			h.failOutboxRow(ctx, row, "obligation lookup: "+err.Error())
			return
		}
	}
	err := h.releaseEscrowToSettlement(ctx, row.Rail, row.ProviderRef, row.Reference, amount)
	switch {
	case err == nil, errors.Is(err, ledger.ErrDuplicate):
		// ErrDuplicate ⇒ the balanced leg already exists (the original post
		// actually landed, or a concurrent redrive won): exactly-once holds and
		// the outbox row's work is done either way.
		if cerr := h.outbox.Complete(ctx, row.ID); cerr != nil {
			log.Printf("[academy-webhooks] outbox complete failed id=%s: %v", row.ID, cerr)
		}
	default:
		h.failOutboxRow(ctx, row, err.Error())
	}
}

func (h *academyWebhookHandler) failOutboxRow(ctx context.Context, row academyOutboxRow, lastErr string) {
	attempts := row.Attempts + 1
	exhausted := attempts >= academyOutboxMaxAttempts
	if err := h.outbox.Fail(ctx, row.ID, attempts, time.Now().Add(academyOutboxBackoff(attempts)), lastErr, exhausted); err != nil {
		log.Printf("[academy-webhooks] outbox fail-mark failed id=%s: %v", row.ID, err)
	}
	if exhausted {
		log.Printf("[academy-webhooks] outbox leg exhausted rail=%s ref=%s after %d attempts (%s) — manual repair required", row.Rail, row.ProviderRef, attempts, lastErr)
	}
}
