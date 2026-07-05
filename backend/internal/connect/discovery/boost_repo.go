package connectdiscovery

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// boostRepo persists connect_boosts over a pgx pool. The boost insert is
// append-only and idempotent on the UNIQUE idempotency_key: a replayed charge maps
// to the pre-existing row rather than creating a duplicate. It NEVER touches a
// balance column — money lives in the ledger.
type boostRepo struct {
	db *pgxpool.Pool
}

// NewBoostRepo builds a connect_boosts repository.
func NewBoostRepo(db *pgxpool.Pool) *boostRepo { return &boostRepo{db: db} }

const boostColumns = `id, user_id, status, price_kobo, duration_minutes,
	started_at, expires_at, ledger_ref, created_at`

// ActiveBoost returns the caller's current active, unexpired boost, or (nil,nil).
func (r *boostRepo) ActiveBoost(ctx context.Context, userID string, now time.Time) (*Boost, error) {
	const q = `SELECT ` + boostColumns + `
		FROM connect_boosts
		WHERE user_id = $1 AND status = 'active' AND expires_at > $2
		ORDER BY started_at DESC
		LIMIT 1`
	b, err := scanBoost(r.db.QueryRow(ctx, q, userID, now))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("connect: active boost: %w", err)
	}
	return b, nil
}

// Insert records the boost row after a successful ledger debit. ON CONFLICT on the
// UNIQUE idempotency_key returns the existing row, so a replayed purchase is a safe
// no-op that yields the SAME boost (one charge → one boost).
func (r *boostRepo) Insert(ctx context.Context, in *Boost) (*Boost, error) {
	const ins = `INSERT INTO connect_boosts
		(user_id, status, price_kobo, duration_minutes, started_at, expires_at, idempotency_key, ledger_ref)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (idempotency_key) DO UPDATE SET user_id = connect_boosts.user_id
		RETURNING ` + boostColumns
	// The DO UPDATE is a no-op that lets RETURNING yield the row whether it was just
	// inserted or already existed (idempotent replay).
	b, err := scanBoost(r.db.QueryRow(ctx, ins,
		in.UserID, in.Status, in.PriceKobo, in.DurationMinutes,
		in.StartedAt, in.ExpiresAt, in.IdempotencyKey, in.LedgerRef))
	if err != nil {
		return nil, fmt.Errorf("connect: insert boost: %w", err)
	}
	return b, nil
}

// scanBoost reads a connect_boosts row in boostColumns order.
func scanBoost(row pgx.Row) (*Boost, error) {
	b := &Boost{}
	if err := row.Scan(
		&b.ID, &b.UserID, &b.Status, &b.PriceKobo, &b.DurationMinutes,
		&b.StartedAt, &b.ExpiresAt, &b.LedgerRef, &b.CreatedAt,
	); err != nil {
		return nil, err
	}
	return b, nil
}
