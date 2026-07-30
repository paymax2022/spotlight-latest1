package offlinesync

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// scopeSync namespaces the idempotency keys this endpoint records so a sync key can
// never collide with a commerce pay_now/refund key (see academy_idempotency_keys.scope
// in supabase/migrations/20260815001000_academy_commerce_audit.sql).
const scopeSync = "sync"

// Repository is the pgx data-access layer for the offline-sync buffer. It writes ONLY
// the two additive brownfield tables academy_sync_events + academy_idempotency_keys —
// no money tables, no ledger. Every write is parameterized and replay-safe.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// Ingest records a single client event idempotently, in ONE transaction:
//
//  1. Short-circuit: a prior academy_idempotency_keys row for (key, 'sync', user) ⇒
//     the event was already reconciled → "duplicate" (no re-insert). Retries are safe.
//  2. Otherwise append to academy_sync_events. The (user_id, client_event_id) UNIQUE
//     makes a replayed event a no-op (ON CONFLICT DO NOTHING) → also "duplicate".
//  3. Record the idempotency key (scope='sync', result_ref = the event id) so any
//     future retry short-circuits at step 1.
//
// No money is touched — this is a thin ingest/reconciliation buffer only.
func (r *Repository) Ingest(ctx context.Context, userID, idemKey, kind, resolution string, ev InboundEvent) (status string, err error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op

	// 1. Idempotency short-circuit.
	var seen bool
	if err = tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM public.academy_idempotency_keys
		   WHERE idempotency_key = $1 AND scope = $2 AND user_id = $3)`,
		idemKey, scopeSync, userID).Scan(&seen); err != nil {
		return "", err
	}
	if seen {
		return "duplicate", tx.Commit(ctx)
	}

	// 2. Append the event; per-user UNIQUE guards against replays.
	var eventID string
	err = tx.QueryRow(ctx,
		`INSERT INTO public.academy_sync_events
		   (user_id, client_event_id, kind, payload, client_ts, resolution)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (user_id, client_event_id) DO NOTHING
		 RETURNING id`,
		userID, ev.ClientEventID, kind, rawOrEmptyObject(ev.Payload), ev.ClientTS, resolution,
	).Scan(&eventID)
	dup := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !dup {
		return "", err
	}

	// 3. Record the idempotency key (result_ref empty on a same-batch conflict).
	if _, err = tx.Exec(ctx,
		`INSERT INTO public.academy_idempotency_keys
		   (idempotency_key, scope, user_id, result_ref)
		 VALUES ($1,$2,$3,$4)
		 ON CONFLICT (idempotency_key, scope) DO NOTHING`,
		idemKey, scopeSync, userID, nullStr(eventID)); err != nil {
		return "", err
	}

	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	if dup {
		return "duplicate", nil
	}
	return "acked", nil
}

// ── helpers ──────────────────────────────────────────────────────────────────────

func rawOrEmptyObject(b []byte) json.RawMessage {
	if len(b) == 0 {
		return json.RawMessage("{}")
	}
	return json.RawMessage(b)
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
