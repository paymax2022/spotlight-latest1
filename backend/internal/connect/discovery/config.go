package connectdiscovery

import (
	"context"
	"encoding/json"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// configReader pulls backend-owned tunables from connect_config so that limits,
// weights and distance buckets are NEVER hard-coded in this package. Missing keys
// fall back to conservative defaults rather than failing discovery.
type configReader struct{ db *pgxpool.Pool }

func newConfigReader(db *pgxpool.Pool) *configReader { return &configReader{db: db} }

// NewConfigReader is the exported constructor used by the route wiring to build the
// backend-owned config reader the boost service reads price/duration from. It shares
// the same connect_config source as discovery ranking (no new config surface).
func NewConfigReader(db *pgxpool.Pool) *configReader { return newConfigReader(db) }

func (r *configReader) raw(ctx context.Context, key string) (json.RawMessage, bool) {
	if r.db == nil {
		// No pool (e.g. a unit-test config reader) → fall back to the caller's
		// conservative default rather than dereferencing a nil pool.
		return nil, false
	}
	var b []byte
	err := r.db.QueryRow(ctx, `SELECT value FROM connect_config WHERE key = $1`, key).Scan(&b)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, false
		}
		return nil, false
	}
	return json.RawMessage(b), true
}

// intVal reads an integer config value, returning def when absent/unparseable.
func (r *configReader) intVal(ctx context.Context, key string, def int) int {
	v, ok := r.raw(ctx, key)
	if !ok {
		return def
	}
	var n int
	if err := json.Unmarshal(v, &n); err != nil {
		return def
	}
	return n
}

// distanceBuckets reads search.distance_buckets_km (ascending km), default set.
func (r *configReader) distanceBuckets(ctx context.Context) []int {
	def := []int{5, 10, 25, 50, 100}
	v, ok := r.raw(ctx, "search.distance_buckets_km")
	if !ok {
		return def
	}
	var b []int
	if err := json.Unmarshal(v, &b); err != nil || len(b) == 0 {
		return def
	}
	sort.Ints(b)
	return b
}

// reasonWeights reads discovery.match_reason_weights (internal, never to mobile).
func (r *configReader) reasonWeights(ctx context.Context) map[string]float64 {
	def := map[string]float64{"shared_intent": 0.4, "distance": 0.3, "verification": 0.3}
	v, ok := r.raw(ctx, "discovery.match_reason_weights")
	if !ok {
		return def
	}
	var w map[string]float64
	if err := json.Unmarshal(v, &w); err != nil || len(w) == 0 {
		return def
	}
	return w
}
