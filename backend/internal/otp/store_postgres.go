package otp

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresStore is the authoritative OTP store.
//
// Postgres and not Redis: router.go builds Redis best-effort and documents that
// it is "a latency optimization, never a correctness dependency", leaving
// sharedRedis nil whenever REDIS_URL is unset or unreachable. Single-use,
// attempt ceilings and send budgets are correctness. A store that can disappear
// would take those guarantees with it — and the failure mode of a missing OTP
// store is not a slow login, it is an unbounded one.
type PostgresStore struct{ db *pgxpool.Pool }

func NewPostgresStore(db *pgxpool.Pool) *PostgresStore { return &PostgresStore{db: db} }

// Put replaces any live code for the same key. Re-issuing must invalidate the
// previous code rather than leaving two valid at once, which would double an
// attacker's guessing surface for free.
func (s *PostgresStore) Put(ctx context.Context, key string, r Record, _ time.Duration) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO otp_codes (key, code_hash, purpose, attempts, created_at, expires_at)
		VALUES ($1,$2,$3,0,$4,$5)
		ON CONFLICT (key) DO UPDATE
		   SET code_hash  = EXCLUDED.code_hash,
		       purpose    = EXCLUDED.purpose,
		       attempts   = 0,
		       created_at = EXCLUDED.created_at,
		       expires_at = EXCLUDED.expires_at`,
		key, r.Hash, r.Purpose, r.CreatedAt, r.ExpiresAt)
	return err
}

func (s *PostgresStore) Get(ctx context.Context, key string) (Record, error) {
	var r Record
	err := s.db.QueryRow(ctx, `
		SELECT code_hash, purpose, attempts, created_at, expires_at
		  FROM otp_codes WHERE key = $1`, key).
		Scan(&r.Hash, &r.Purpose, &r.Attempts, &r.CreatedAt, &r.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, err
	}
	return r, nil
}

// Consume is the single-use guarantee, expressed as one statement so that two
// concurrent submissions of the same correct code cannot both succeed: exactly
// one DELETE finds the row.
//
// The expiry and attempt predicates are repeated here rather than trusted from
// the service's earlier read, because between that read and this call another
// request may have exhausted the attempts.
func (s *PostgresStore) Consume(ctx context.Context, key, codeHash string, maxAttempts int) (bool, error) {
	tag, err := s.db.Exec(ctx, `
		DELETE FROM otp_codes
		 WHERE key = $1
		   AND code_hash = $2
		   AND expires_at > now()
		   AND attempts < $3`, key, codeHash, maxAttempts)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// IncrementAttempts is atomic by construction — the read and the write are the
// same statement. The guide's Redis version is a read-modify-write and notes the
// race; in Postgres the fix is free.
//
// A row that has expired is not bumped: ErrExpired is the honest answer, and
// silently counting an attempt against a dead code would let an attacker burn
// the next code's budget before it is issued.
func (s *PostgresStore) IncrementAttempts(ctx context.Context, key string) (int, error) {
	var n int
	err := s.db.QueryRow(ctx, `
		UPDATE otp_codes
		   SET attempts = attempts + 1
		 WHERE key = $1 AND expires_at > now()
		RETURNING attempts`, key).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		// Either gone or expired; from the caller's side these are the same.
		return 0, ErrExpired
	}
	if err != nil {
		return 0, err
	}
	return n, nil
}

func (s *PostgresStore) Delete(ctx context.Context, key string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM otp_codes WHERE key = $1`, key)
	return err
}

// DeleteExpired sweeps a bounded number of dead rows. Bounded so the sweep can
// run on a request path without turning one user's login into a table scan.
func (s *PostgresStore) DeleteExpired(ctx context.Context, limit int) (int64, error) {
	if limit <= 0 {
		limit = 200
	}
	tag, err := s.db.Exec(ctx, `
		DELETE FROM otp_codes
		 WHERE key IN (SELECT key FROM otp_codes WHERE expires_at < now() LIMIT $1)`, limit)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
