package navigation

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

// Repository is the pgx (service_role) data layer for navigation_events.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds the repository over the shared pgx pool.
func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// Insert writes all events in a single pgx batch (one round trip, one
// transaction) and returns the number of rows written.
func (r *Repository) Insert(ctx context.Context, events []Event) (int, error) {
	if len(events) == 0 {
		return 0, nil
	}
	const q = `INSERT INTO navigation_events (user_id, surface, route, occurred_at)
		VALUES ($1::uuid, $2, $3, $4)`
	b := &pgx.Batch{}
	for _, e := range events {
		b.Queue(q, e.UserID, e.Surface, e.Route, e.OccurredAt)
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("navigation repo: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	br := tx.SendBatch(ctx, b)
	n := 0
	for range events {
		tag, err := br.Exec()
		if err != nil {
			_ = br.Close()
			return 0, fmt.Errorf("navigation repo: insert: %w", err)
		}
		n += int(tag.RowsAffected())
	}
	if err := br.Close(); err != nil {
		return 0, fmt.Errorf("navigation repo: insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("navigation repo: commit: %w", err)
	}
	return n, nil
}

// PurgeOlderThan deletes rows with occurred_at < cutoff in bounded batches of
// batch rows, looping until none remain. Returns the total deleted.
func (r *Repository) PurgeOlderThan(ctx context.Context, cutoff time.Time, batch int) (int64, error) {
	if batch <= 0 {
		batch = 10000
	}
	const q = `DELETE FROM navigation_events WHERE ctid IN (
		SELECT ctid FROM navigation_events WHERE occurred_at < $1 LIMIT $2)`
	var total int64
	for {
		tag, err := r.db.Exec(ctx, q, cutoff, batch)
		if err != nil {
			return total, fmt.Errorf("navigation repo: purge: %w", err)
		}
		n := tag.RowsAffected()
		total += n
		if n == 0 {
			return total, nil
		}
	}
}

// ListRecentByUser returns a user's most recent navigation events, newest
// first. limit <= 0 or > 200 is clamped to 100. UserID is left empty.
func (r *Repository) ListRecentByUser(ctx context.Context, userID string, limit int) ([]Event, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	const q = `SELECT surface, route, occurred_at FROM navigation_events
		WHERE user_id = $1::uuid ORDER BY occurred_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("navigation repo: list: %w", err)
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.Surface, &e.Route, &e.OccurredAt); err != nil {
			return nil, fmt.Errorf("navigation repo: scan: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("navigation repo: list: %w", err)
	}
	return out, nil
}
