package navigation

import (
	"context"
	"fmt"
	"strings"

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

// analyticsInterval maps a validated range token to a Postgres interval
// literal (bound as a parameter, never interpolated).
func analyticsInterval(rng string) string {
	switch rng {
	case "7d":
		return "7 days"
	case "90d":
		return "90 days"
	default:
		return "30 days"
	}
}

// escapeLike escapes LIKE metacharacters so a search term matches literally.
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// AggregateNavigation returns top screens, a per-day timeseries and the
// surface split over the filter window. Surface scopes topScreens and the
// timeseries (not the split); Search scopes topScreens only. All filter
// values are bound parameters.
func (r *Repository) AggregateNavigation(ctx context.Context, f AnalyticsFilter) (*NavAnalytics, error) {
	interval := analyticsInterval(f.Range)
	surface := ""
	if f.Surface == "mobile" || f.Surface == "web" {
		surface = f.Surface
	}
	pattern := "%" + escapeLike(f.Search) + "%"
	out := &NavAnalytics{TopScreens: []TopScreen{}, Timeseries: []DayBucket{}}

	const topQ = `SELECT route, COUNT(*) AS views, COUNT(DISTINCT user_id) AS users
		FROM navigation_events
		WHERE occurred_at >= now() - $1::interval
		  AND ($2 = '' OR surface = $2)
		  AND ($3 = '%%' OR route ILIKE $3)
		GROUP BY route
		ORDER BY views DESC, route ASC
		LIMIT 50`
	rows, err := r.db.Query(ctx, topQ, interval, surface, pattern)
	if err != nil {
		return nil, fmt.Errorf("navigation repo: top screens: %w", err)
	}
	for rows.Next() {
		var s TopScreen
		if err := rows.Scan(&s.Route, &s.Views, &s.Users); err != nil {
			rows.Close()
			return nil, fmt.Errorf("navigation repo: scan top: %w", err)
		}
		out.TopScreens = append(out.TopScreens, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("navigation repo: top screens: %w", err)
	}

	const tsQ = `SELECT date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS day, surface, COUNT(*)
		FROM navigation_events
		WHERE occurred_at >= now() - $1::interval
		  AND ($2 = '' OR surface = $2)
		GROUP BY 1, surface
		ORDER BY 1 ASC`
	rows, err = r.db.Query(ctx, tsQ, interval, surface)
	if err != nil {
		return nil, fmt.Errorf("navigation repo: timeseries: %w", err)
	}
	idx := map[string]int{}
	for rows.Next() {
		var day time.Time
		var surf string
		var n int64
		if err := rows.Scan(&day, &surf, &n); err != nil {
			rows.Close()
			return nil, fmt.Errorf("navigation repo: scan timeseries: %w", err)
		}
		key := day.Format("2006-01-02")
		i, ok := idx[key]
		if !ok {
			out.Timeseries = append(out.Timeseries, DayBucket{Day: key})
			i = len(out.Timeseries) - 1
			idx[key] = i
		}
		switch surf {
		case "mobile":
			out.Timeseries[i].Mobile += n
		case "web":
			out.Timeseries[i].Web += n
		}
		out.Timeseries[i].Total += n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("navigation repo: timeseries: %w", err)
	}

	const splitQ = `SELECT surface, COUNT(*) FROM navigation_events
		WHERE occurred_at >= now() - $1::interval GROUP BY surface`
	rows, err = r.db.Query(ctx, splitQ, interval)
	if err != nil {
		return nil, fmt.Errorf("navigation repo: surface split: %w", err)
	}
	for rows.Next() {
		var surf string
		var n int64
		if err := rows.Scan(&surf, &n); err != nil {
			rows.Close()
			return nil, fmt.Errorf("navigation repo: scan split: %w", err)
		}
		switch surf {
		case "mobile":
			out.SurfaceSplit.Mobile += n
		case "web":
			out.SurfaceSplit.Web += n
		}
		out.SurfaceSplit.Total += n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("navigation repo: surface split: %w", err)
	}
	return out, nil
}

// FunnelStepEvents returns every event whose route is one of steps within the
// filter window (optionally scoped to one surface), ordered by user then time
// so ComputeFunnel can scan it in one pass. All values are bound parameters.
// Search is unused. Results carry user ids and must never be serialized.
func (r *Repository) FunnelStepEvents(ctx context.Context, steps []string, f AnalyticsFilter) ([]StepEvent, error) {
	surface := ""
	if f.Surface == "mobile" || f.Surface == "web" {
		surface = f.Surface
	}
	const q = `SELECT user_id::text, route, occurred_at FROM navigation_events
		WHERE route = ANY($1)
		  AND occurred_at >= now() - $2::interval
		  AND ($3 = '' OR surface = $3)
		ORDER BY user_id, occurred_at, id`
	rows, err := r.db.Query(ctx, q, steps, analyticsInterval(f.Range), surface)
	if err != nil {
		return nil, fmt.Errorf("navigation repo: funnel events: %w", err)
	}
	defer rows.Close()
	out := []StepEvent{}
	for rows.Next() {
		var e StepEvent
		if err := rows.Scan(&e.UserID, &e.Route, &e.OccurredAt); err != nil {
			return nil, fmt.Errorf("navigation repo: scan funnel: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("navigation repo: funnel events: %w", err)
	}
	return out, nil
}
