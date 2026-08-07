package maps

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// recorder.go — persists ResolutionEvents for audit + the cost/coverage
// dashboard (MAPSERVICE.md §9, MS-7). Writes are BEST-EFFORT: a recorder failure
// must never block or fail a resolution (MS-6). Read/rollup methods back the
// admin dashboard (RBAC permission map.admin.review).

// Recorder is the pgx-backed ResolutionRecorder.
type Recorder struct {
	pool *pgxpool.Pool
}

// NewRecorder builds a ResolutionRecorder over map_resolution_event.
func NewRecorder(pool *pgxpool.Pool) *Recorder { return &Recorder{pool: pool} }

// compile-time interface assertion.
var _ ResolutionRecorder = (*Recorder)(nil)

// resolutionInsertCols documents the column order used by Record (kept in one
// place so the test can assert the row mapping without a live DB).
var resolutionInsertCols = []string{
	"request_type", "surface", "h3", "tier", "chosen_source",
	"provider", "confidence", "escalated", "cost_unit", "outcome_pin", "user_id", "ts",
}

// recordArgs maps a ResolutionEvent to the positional INSERT args (pure helper,
// unit-testable without a DB). The DB defaults ts to now() when zero; empty
// optional string columns are written as NULL via nullable().
func recordArgs(e ResolutionEvent) []any {
	ts := e.TS
	if ts.IsZero() {
		ts = time.Now().UTC()
	}
	return []any{
		e.RequestType,
		nullable(e.Surface),
		nullable(e.H3Cell),
		nullable(string(e.Tier)),
		e.ChosenSource,
		nullable(e.Provider),
		float64(e.Confidence),
		e.Escalated,
		e.CostUnit,
		e.OutcomePin,
		nullable(e.UserID),
		ts,
	}
}

// nullable returns nil for empty strings so optional text/uuid columns store NULL.
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// Record inserts one ResolutionEvent. Best-effort: errors are logged and nil is
// returned so a recorder failure never blocks a request (MS-6).
func (r *Recorder) Record(ctx context.Context, e ResolutionEvent) error {
	if r == nil || r.pool == nil {
		return nil
	}
	const q = `
		INSERT INTO map_resolution_event
			(request_type, surface, h3, tier, chosen_source, provider,
			 confidence, escalated, cost_unit, outcome_pin, user_id, ts)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`
	if _, err := r.pool.Exec(ctx, q, recordArgs(e)...); err != nil {
		log.Printf("[maps] resolution record (%s/%s): %v", e.RequestType, e.ChosenSource, err)
		return nil // never block the request on an audit write
	}
	return nil
}

// --- admin rollups for the dashboard -------------------------------------

// DeflectionStats aggregates resolution outcomes since a cutoff for the cost
// dashboard. "Deflected" = resolved with no paid provider call (cost_unit = 0:
// gazetteer / cache / prediction / osm-from-cache); "paid" = at least one paid
// call (cost_unit > 0). The deflection rate = deflected / (paid+deflected).
func (r *Recorder) DeflectionStats(ctx context.Context, since time.Time) (DeflectionStats, error) {
	var out DeflectionStats
	out.ByCoverageTier = map[CoverageTier]TierDeflection{}
	out.BySource = map[string]int64{}
	if r == nil || r.pool == nil {
		return out, nil
	}

	// Overall paid vs deflected.
	const totals = `
		SELECT
			COALESCE(SUM(CASE WHEN cost_unit > 0 THEN 1 ELSE 0 END), 0) AS paid,
			COALESCE(SUM(CASE WHEN cost_unit = 0 THEN 1 ELSE 0 END), 0) AS deflected
		FROM map_resolution_event
		WHERE ts >= $1`
	if err := r.pool.QueryRow(ctx, totals, since).Scan(&out.Paid, &out.Deflected); err != nil {
		return out, err
	}

	// Per coverage tier.
	const byTier = `
		SELECT COALESCE(tier, 'FAIR') AS tier,
			COALESCE(SUM(CASE WHEN cost_unit > 0 THEN 1 ELSE 0 END), 0) AS paid,
			COALESCE(SUM(CASE WHEN cost_unit = 0 THEN 1 ELSE 0 END), 0) AS deflected
		FROM map_resolution_event
		WHERE ts >= $1
		GROUP BY COALESCE(tier, 'FAIR')`
	rows, err := r.pool.Query(ctx, byTier, since)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var (
			tier            string
			paid, deflected int64
		)
		if err := rows.Scan(&tier, &paid, &deflected); err != nil {
			rows.Close()
			return out, err
		}
		out.ByCoverageTier[CoverageTier(tier)] = TierDeflection{Paid: paid, Deflected: deflected}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}

	// Per chosen source.
	const bySource = `
		SELECT chosen_source, COUNT(*) AS n
		FROM map_resolution_event
		WHERE ts >= $1
		GROUP BY chosen_source`
	srows, err := r.pool.Query(ctx, bySource, since)
	if err != nil {
		return out, err
	}
	defer srows.Close()
	for srows.Next() {
		var (
			source string
			n      int64
		)
		if err := srows.Scan(&source, &n); err != nil {
			return out, err
		}
		out.BySource[source] = n
	}
	return out, srows.Err()
}

// RecentEvents returns the most recent resolution events for the dashboard feed.
func (r *Recorder) RecentEvents(ctx context.Context, limit int) ([]ResolutionEvent, error) {
	if r == nil || r.pool == nil {
		return nil, nil
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const q = `
		SELECT id, request_type, COALESCE(surface,''), COALESCE(h3,''), COALESCE(tier,''),
		       chosen_source, COALESCE(provider,''), confidence, escalated, cost_unit,
		       outcome_pin, COALESCE(user_id::text,''), ts
		FROM map_resolution_event
		ORDER BY ts DESC
		LIMIT $1`
	rows, err := r.pool.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ResolutionEvent{}
	for rows.Next() {
		var (
			e    ResolutionEvent
			tier string
		)
		if err := rows.Scan(
			&e.ID, &e.RequestType, &e.Surface, &e.H3Cell, &tier,
			&e.ChosenSource, &e.Provider, &e.Confidence, &e.Escalated, &e.CostUnit,
			&e.OutcomePin, &e.UserID, &e.TS,
		); err != nil {
			return nil, err
		}
		e.Tier = CoverageTier(tier)
		out = append(out, e)
	}
	return out, rows.Err()
}

// --- rollup result types -------------------------------------------------

// TierDeflection is paid vs deflected counts for one coverage tier.
type TierDeflection struct {
	Paid      int64 `json:"paid"`
	Deflected int64 `json:"deflected"`
}

// DeflectionStats is the dashboard cost rollup over a time window.
type DeflectionStats struct {
	Paid           int64                           `json:"paid"`
	Deflected      int64                           `json:"deflected"`
	ByCoverageTier map[CoverageTier]TierDeflection `json:"by_coverage_tier"`
	BySource       map[string]int64                `json:"by_source"`
}

// DeflectionRate is the share of resolutions served without a paid provider call.
func (s DeflectionStats) DeflectionRate() float64 {
	total := s.Paid + s.Deflected
	if total == 0 {
		return 0
	}
	return float64(s.Deflected) / float64(total)
}
