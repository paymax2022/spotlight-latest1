package maps

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// provider_guard.go — cost guardrails + circuit breaking per provider
// (MAPSERVICE.md §10, MS-6). The guard answers two questions before any paid
// provider call: is the breaker closed, and are we under today's budget? After
// each call it folds the outcome into rolling health (error rate, p95 latency,
// budget used) and trips/recovers the breaker.
//
// State lives in map_provider_health (one row per provider). Daily budget uses a
// UTC date bucket so caps reset at midnight UTC. All writes are best-effort —
// Observe never blocks the request path (MS-6).

// Circuit breaker tuning (package-level so tests document the rules).
const (
	// breakerCooldown is how long a tripped breaker stays open before going
	// half_open to probe recovery.
	breakerCooldown = 60 * time.Second
	// breakerMinSamples is the rolling sample floor before error rate can trip
	// the breaker — avoids tripping on a single early failure.
	breakerMinSamples = 5
	// breakerErrorRate trips the breaker when the rolling error rate exceeds it.
	breakerErrorRate = 0.50
	// breakerLatencyMs trips the breaker when p95 latency exceeds it (provider
	// effectively unusable even if returning 200s).
	breakerLatencyMs = 8000
	// healthEWMA is the smoothing factor for the rolling error-rate / latency
	// estimate (newer observations weighted ~30%).
	healthEWMA = 0.30
)

// circuitState mirrors the map_provider_health.circuit_state CHECK values.
type circuitState string

const (
	circuitClosed   circuitState = "closed"
	circuitOpen     circuitState = "open"
	circuitHalfOpen circuitState = "half_open"
)

// Guard is the pgx-backed ProviderGuard.
type Guard struct {
	pool    *pgxpool.Pool
	budgets map[string]int64 // per-provider daily cap (V2Config.Budgets); 0/absent = uncapped
}

// NewGuard builds a ProviderGuard with per-provider daily budgets.
func NewGuard(pool *pgxpool.Pool, budgets map[string]int64) *Guard {
	if budgets == nil {
		budgets = map[string]int64{}
	}
	return &Guard{pool: pool, budgets: budgets}
}

// compile-time interface assertion.
var _ ProviderGuard = (*Guard)(nil)

// --- pure decision helpers (unit-testable, DB-free) ----------------------

// providerHealth is the in-memory view of one map_provider_health row.
type providerHealth struct {
	circuit    circuitState
	openedAt   time.Time
	errorRate  float64
	p95Latency int64
	sampleSize int64
	budgetUsed int64
	budgetDay  string
}

// budgetDayKey is the UTC date bucket for daily budgets.
func budgetDayKey(now time.Time) string { return now.UTC().Format("2006-01-02") }

// effectiveBudgetUsed returns budget used for `now`'s day — resets to 0 when the
// stored bucket is a previous day (rollover without a DB write).
func effectiveBudgetUsed(h providerHealth, now time.Time) int64 {
	if h.budgetDay != budgetDayKey(now) {
		return 0
	}
	return h.budgetUsed
}

// allowDecision is the pure gate: may we call this provider right now?
//   - cap > 0 and effective budget used >= cap → deny (budget exhausted).
//   - breaker open and cooldown NOT elapsed     → deny.
//   - breaker open and cooldown elapsed         → allow (probe; caller flips to half_open).
//   - otherwise (closed / half_open)            → allow.
func allowDecision(h providerHealth, cap int64, now time.Time) bool {
	if cap > 0 && effectiveBudgetUsed(h, now) >= cap {
		return false
	}
	if h.circuit == circuitOpen {
		return now.Sub(h.openedAt) >= breakerCooldown
	}
	return true
}

// nextCircuitState is the pure breaker transition. Given the prior state and a
// freshly folded observation, it returns the next state and (if it just opened)
// the open timestamp.
//
// Transitions:
//   - half_open + ok    → closed  (probe succeeded; recover).
//   - half_open + !ok   → open    (probe failed; re-arm cooldown).
//   - closed   + unhealthy (error rate or latency over threshold, enough samples) → open.
//   - any      + open elapsed cooldown (handled in Allow, not here).
//   - otherwise → unchanged.
func nextCircuitState(prev circuitState, ok bool, errorRate float64, p95Latency, sampleSize int64, now time.Time) (circuitState, time.Time) {
	switch prev {
	case circuitHalfOpen:
		if ok {
			return circuitClosed, time.Time{}
		}
		return circuitOpen, now
	case circuitOpen:
		// Opening/cooldown handled by Allow; a call landing while open that
		// succeeds is treated as a half-open probe success.
		if ok {
			return circuitClosed, time.Time{}
		}
		return circuitOpen, now
	default: // closed
		unhealthy := sampleSize >= breakerMinSamples &&
			(errorRate > breakerErrorRate || p95Latency > breakerLatencyMs)
		if unhealthy {
			return circuitOpen, now
		}
		return circuitClosed, time.Time{}
	}
}

// foldHealth folds one observation into the rolling EWMA health estimate.
func foldHealth(h providerHealth, ok bool, latencyMs int64) providerHealth {
	errSignal := 0.0
	if !ok {
		errSignal = 1.0
	}
	if h.sampleSize == 0 {
		h.errorRate = errSignal
		h.p95Latency = latencyMs
	} else {
		h.errorRate = h.errorRate*(1-healthEWMA) + errSignal*healthEWMA
		h.p95Latency = int64(float64(h.p95Latency)*(1-healthEWMA) + float64(latencyMs)*healthEWMA)
	}
	h.sampleSize++
	return h
}

// --- ProviderGuard implementation ----------------------------------------

// Allow reports whether the provider may be called now. Read errors FAIL OPEN
// (allow) so a health-table hiccup never strands resolution — the breaker and
// budget are guardrails, not a single point of failure (MS-6).
func (g *Guard) Allow(ctx context.Context, provider string, _ Primitive) bool {
	if g == nil || g.pool == nil || provider == "" {
		return true
	}
	now := time.Now()
	h, ok := g.read(ctx, provider)
	if !ok {
		return true // no row yet / transient read error → fail open
	}
	allowed := allowDecision(h, g.budgets[provider], now)
	// When an open breaker's cooldown has elapsed, flip to half_open so the next
	// call is a single probe (best-effort; ignore write error).
	if allowed && h.circuit == circuitOpen {
		const q = `UPDATE map_provider_health SET circuit_state = 'half_open', updated_at = now() WHERE name = $1`
		if _, err := g.pool.Exec(ctx, q, provider); err != nil {
			log.Printf("[maps] guard half-open %q: %v", provider, err)
		}
	}
	return allowed
}

// Observe folds a provider-call outcome into health: rolling error rate + p95
// latency, a daily-bucketed budget increment, and a breaker transition.
// Best-effort: errors are logged and swallowed (MS-6).
func (g *Guard) Observe(ctx context.Context, provider string, ok bool, latencyMs int64) {
	if g == nil || g.pool == nil || provider == "" {
		return
	}
	now := time.Now()
	day := budgetDayKey(now)

	prev, found := g.read(ctx, provider)
	if !found {
		prev = providerHealth{circuit: circuitClosed, budgetDay: day}
	}
	// Roll the daily budget bucket over if the stored day is stale.
	if prev.budgetDay != day {
		prev.budgetUsed = 0
		prev.budgetDay = day
	}
	prev.budgetUsed++ // every observed call consumes one budget unit

	folded := foldHealth(prev, ok, latencyMs)
	state, openedAt := nextCircuitState(prev.circuit, ok, folded.errorRate, folded.p95Latency, folded.sampleSize, now)

	up := ok || state == circuitClosed
	const q = `
		INSERT INTO map_provider_health
			(name, up, p95_latency_ms, error_rate, budget_used, budget_day, circuit_state, opened_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
		ON CONFLICT (name) DO UPDATE SET
			up             = EXCLUDED.up,
			p95_latency_ms = EXCLUDED.p95_latency_ms,
			error_rate     = EXCLUDED.error_rate,
			budget_used    = EXCLUDED.budget_used,
			budget_day     = EXCLUDED.budget_day,
			circuit_state  = EXCLUDED.circuit_state,
			opened_at      = EXCLUDED.opened_at,
			updated_at     = now()`
	var openedArg any
	if !openedAt.IsZero() {
		openedArg = openedAt
	}
	if _, err := g.pool.Exec(ctx, q, provider, up, folded.p95Latency, folded.errorRate,
		folded.budgetUsed, folded.budgetDay, string(state), openedArg); err != nil {
		log.Printf("[maps] guard observe %q: %v", provider, err)
	}
}

// read loads one provider's health row; ok=false on miss or transient error.
func (g *Guard) read(ctx context.Context, provider string) (providerHealth, bool) {
	const q = `
		SELECT circuit_state, opened_at, error_rate, p95_latency_ms, budget_used, COALESCE(budget_day,'')
		FROM map_provider_health WHERE name = $1`
	var (
		state    string
		openedAt *time.Time
		h        providerHealth
	)
	err := g.pool.QueryRow(ctx, q, provider).
		Scan(&state, &openedAt, &h.errorRate, &h.p95Latency, &h.budgetUsed, &h.budgetDay)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Printf("[maps] guard read %q: %v", provider, err)
		}
		return providerHealth{}, false
	}
	h.circuit = circuitState(state)
	if openedAt != nil {
		h.openedAt = *openedAt
	}
	return h, true
}

// --- admin dashboard -----------------------------------------------------

// ProviderHealthRow is one provider's health for the admin dashboard.
type ProviderHealthRow struct {
	Name         string    `json:"name"`
	Up           bool      `json:"up"`
	P95LatencyMs int       `json:"p95_latency_ms"`
	ErrorRate    float64   `json:"error_rate"`
	BudgetUsed   int64     `json:"budget_used"`
	BudgetCap    int64     `json:"budget_cap"`
	BudgetDay    string    `json:"budget_day"`
	CircuitState string    `json:"circuit_state"`
	OpenedAt     time.Time `json:"opened_at,omitempty"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Snapshot returns every provider's current health for the dashboard, annotated
// with the configured daily budget cap.
func (g *Guard) Snapshot(ctx context.Context) ([]ProviderHealthRow, error) {
	if g == nil || g.pool == nil {
		return nil, nil
	}
	const q = `
		SELECT name, up, p95_latency_ms, error_rate, budget_used,
		       COALESCE(budget_day,''), circuit_state, opened_at, updated_at
		FROM map_provider_health
		ORDER BY name`
	rows, err := g.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProviderHealthRow{}
	for rows.Next() {
		var (
			r        ProviderHealthRow
			openedAt *time.Time
		)
		if err := rows.Scan(&r.Name, &r.Up, &r.P95LatencyMs, &r.ErrorRate, &r.BudgetUsed,
			&r.BudgetDay, &r.CircuitState, &openedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		if openedAt != nil {
			r.OpenedAt = *openedAt
		}
		r.BudgetCap = g.budgets[r.Name]
		out = append(out, r)
	}
	return out, rows.Err()
}
