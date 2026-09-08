package otp

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresLimiter is a fixed-window counter.
//
// In Postgres for the same reason the store is: a rate limit that evaporates
// with the cache is not a rate limit. The existing middleware.AuthRateLimiter is
// in-process, which is correct for cheap IP throttling but cannot hold a
// per-address send budget across replicas — two instances would each grant the
// full hourly allowance.
type PostgresLimiter struct{ db *pgxpool.Pool }

func NewPostgresLimiter(db *pgxpool.Pool) *PostgresLimiter { return &PostgresLimiter{db: db} }

// Allow increments the counter for key and reports whether the caller is still
// within limit for the window.
//
// One statement, so concurrent requests serialise on the row rather than each
// reading the same count. The window rolls forward inside the same statement
// when the previous one has expired.
func (l *PostgresLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	var count int
	err := l.db.QueryRow(ctx, `
		INSERT INTO otp_rate_limits (key, count, window_start, expires_at)
		VALUES ($1, 1, now(), now() + $2::interval)
		ON CONFLICT (key) DO UPDATE
		   SET count        = CASE WHEN otp_rate_limits.expires_at <= now() THEN 1 ELSE otp_rate_limits.count + 1 END,
		       window_start = CASE WHEN otp_rate_limits.expires_at <= now() THEN now() ELSE otp_rate_limits.window_start END,
		       expires_at   = CASE WHEN otp_rate_limits.expires_at <= now() THEN now() + $2::interval ELSE otp_rate_limits.expires_at END
		RETURNING count`,
		key, window.String()).Scan(&count)
	if err != nil {
		// Fail CLOSED. A limiter that answers "allowed" when its store is
		// unreachable is worse than no limiter, because the system reports that
		// it is protected while the budget is unbounded.
		return false, err
	}
	return count <= limit, nil
}

// SweepExpired removes dead counter rows. Bounded, like the code sweep.
func (l *PostgresLimiter) SweepExpired(ctx context.Context, limit int) (int64, error) {
	if limit <= 0 {
		limit = 200
	}
	tag, err := l.db.Exec(ctx, `
		DELETE FROM otp_rate_limits
		 WHERE key IN (SELECT key FROM otp_rate_limits WHERE expires_at < now() LIMIT $1)`, limit)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
