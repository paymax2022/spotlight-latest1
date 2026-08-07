// Package connectcredits implements consumable Connect credits (super-likes,
// InMail, boost counts) with money-grade integrity — test-plan row PAY-008.
//
// Invariants:
//   - Balance is never negative (DB CHECK + guarded decrement).
//   - No double-spend: a consume is applied AT MOST ONCE per idempotency key, and
//     concurrent consumes serialise on the balance row so exactly the available
//     number succeed (the rest get ErrInsufficientCredits) — never oversold.
//   - Grants are idempotent per key too, so a retried purchase-grant adds once.
//
// Balances are a projection of the append-only connect_credit_txns log.
package connectcredits

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrInsufficientCredits is returned when a consume would drive the balance below
// zero — the spend is refused (fail-closed), never partially applied.
var ErrInsufficientCredits = errors.New("connect: insufficient credits")

// Service owns credit grant/consume/balance over the pool.
type Service struct{ db *pgxpool.Pool }

// NewService builds the credits service.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// Balance returns the current balance for (user, creditType); 0 if none.
func (s *Service) Balance(ctx context.Context, userID, creditType string) (int64, error) {
	var bal int64
	err := s.db.QueryRow(ctx,
		`SELECT balance FROM connect_credits WHERE user_id = $1::uuid AND credit_type = $2`,
		userID, creditType).Scan(&bal)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("connect: read credit balance: %w", err)
	}
	return bal, nil
}

// Balances returns all non-zero credit balances for a user (server-side truth).
func (s *Service) Balances(ctx context.Context, userID string) (map[string]int64, error) {
	rows, err := s.db.Query(ctx,
		`SELECT credit_type, balance FROM connect_credits WHERE user_id = $1::uuid AND balance > 0`, userID)
	if err != nil {
		return nil, fmt.Errorf("connect: list credit balances: %w", err)
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var t string
		var b int64
		if err := rows.Scan(&t, &b); err != nil {
			return nil, err
		}
		out[t] = b
	}
	return out, rows.Err()
}

// Grant adds `amount` credits, idempotently keyed by idempotencyKey (a retried
// purchase grant applies once). amount must be > 0.
func (s *Service) Grant(ctx context.Context, userID, creditType, idempotencyKey string, amount int64, reason string) error {
	if amount <= 0 {
		return fmt.Errorf("connect: grant amount must be positive")
	}
	if idempotencyKey == "" {
		return fmt.Errorf("connect: grant requires an idempotency key")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	ct, err := tx.Exec(ctx,
		`INSERT INTO connect_credit_txns (idempotency_key, user_id, credit_type, delta, reason)
		 VALUES ($1,$2::uuid,$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`,
		idempotencyKey, userID, creditType, amount, reason)
	if err != nil {
		return fmt.Errorf("connect: record grant txn: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return tx.Commit(ctx) // duplicate key — already granted, idempotent no-op
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO connect_credits (user_id, credit_type, balance) VALUES ($1::uuid,$2,$3)
		 ON CONFLICT (user_id, credit_type) DO UPDATE SET balance = connect_credits.balance + EXCLUDED.balance, updated_at = now()`,
		userID, creditType, amount); err != nil {
		return fmt.Errorf("connect: apply grant: %w", err)
	}
	return tx.Commit(ctx)
}

// Consume spends `amount` credits, keyed by idempotencyKey so a retried spend does
// not double-charge. Returns ErrInsufficientCredits (and applies nothing) when the
// balance is too low. Concurrency-safe: the guarded UPDATE holds the balance row,
// so simultaneous spends can neither oversell nor go negative.
func (s *Service) Consume(ctx context.Context, userID, creditType, idempotencyKey string, amount int64, reason string) error {
	if amount <= 0 {
		return fmt.Errorf("connect: consume amount must be positive")
	}
	if idempotencyKey == "" {
		return fmt.Errorf("connect: consume requires an idempotency key")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Idempotency: record the spend txn first. A duplicate key means this exact
	// spend already happened — return success without decrementing again.
	ct, err := tx.Exec(ctx,
		`INSERT INTO connect_credit_txns (idempotency_key, user_id, credit_type, delta, reason)
		 VALUES ($1,$2::uuid,$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`,
		idempotencyKey, userID, creditType, -amount, reason)
	if err != nil {
		return fmt.Errorf("connect: record consume txn: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return tx.Commit(ctx) // already consumed under this key — idempotent success
	}

	// Guarded decrement: only succeeds if enough balance. Under concurrency the row
	// lock serialises this, so exactly the available number of spends win.
	dec, err := tx.Exec(ctx,
		`UPDATE connect_credits SET balance = balance - $3, updated_at = now()
		 WHERE user_id = $1::uuid AND credit_type = $2 AND balance >= $3`,
		userID, creditType, amount)
	if err != nil {
		return fmt.Errorf("connect: decrement balance: %w", err)
	}
	if dec.RowsAffected() == 0 {
		// Insufficient (or no) balance — refuse and apply nothing (tx rolls back,
		// discarding the txn row too).
		return ErrInsufficientCredits
	}
	return tx.Commit(ctx)
}
