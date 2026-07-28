package symptomsearch

// Safety-metrics read surface (PRD §9 safety KPIs) backing
// GET /api/health/pharmacy/admin/symptom/metrics (RBAC
// health.pharmacy.symptom.reviews; contracts/openapi.yaml
// SymptomSafetyMetrics). Aggregate-safe by construction: counts and
// percentiles only — never per-user rows, never terms, never PII (NDPR).

import (
	"context"
	"fmt"
)

// SafetyMetrics mirrors components/schemas/SymptomSafetyMetrics. All map keys
// are always present (zero-filled) so the admin console renders a stable
// shape; the nullable KPIs serialise as JSON null when the window is empty.
type SafetyMetrics struct {
	// ByState counts review cases created in the last 7 days per state.
	ByState map[string]int `json:"by_state"`
	// ByTier counts review cases created in the last 7 days per triage tier.
	ByTier map[string]int `json:"by_tier"`
	// OpenOverdue counts currently open cases (SUBMITTED / PHARMACIST_REVIEW /
	// NEEDS_INFO) whose sla_deadline has passed — any age, not 7d-scoped.
	OpenOverdue int `json:"open_overdue"`
	// MedianDecisionSeconds is the median creation→decision latency over cases
	// decided APPROVED/REJECTED in the last 7 days (decision timestamps from
	// the evented history). nil ⇒ no decisions in the window.
	MedianDecisionSeconds *float64 `json:"median_decision_seconds"`
	// Searches24h counts symptom_search_events rows from the last 24 hours.
	Searches24h int `json:"searches_24h"`
	// GatedShare7d is the share (0..1) of searches in the last 7 days that
	// resolved T2 or higher. nil ⇒ no searches in the window.
	GatedShare7d *float64 `json:"gated_share_7d"`
}

// normalize zero-fills every state/tier key — the contract promises all keys
// are always present regardless of data volume.
func (m *SafetyMetrics) normalize() {
	if m.ByState == nil {
		m.ByState = map[string]int{}
	}
	for _, st := range []ReviewState{ReviewSubmitted, ReviewAutoCleared, ReviewPharmacistReview, ReviewNeedsInfo, ReviewApproved, ReviewRejected} {
		if _, ok := m.ByState[string(st)]; !ok {
			m.ByState[string(st)] = 0
		}
	}
	if m.ByTier == nil {
		m.ByTier = map[string]int{}
	}
	for _, t := range []Tier{TierT1, TierT2, TierT3, TierT4} {
		if _, ok := m.ByTier[string(t)]; !ok {
			m.ByTier[string(t)] = 0
		}
	}
}

// metricsReader is the optional repo port for the KPI read (PgxRepo implements
// it; in-memory test fakes may seed canned values).
type metricsReader interface {
	SafetyMetrics(ctx context.Context) (*SafetyMetrics, error)
}

// SafetyMetrics is the service read behind the admin metrics endpoint.
func (s *Service) SafetyMetrics(ctx context.Context) (*SafetyMetrics, error) {
	mr, ok := s.repo.(metricsReader)
	if !ok {
		return nil, fmt.Errorf("%w: safety metrics unavailable", ErrNotFound)
	}
	m, err := mr.SafetyMetrics(ctx)
	if err != nil {
		return nil, err
	}
	if m == nil {
		m = &SafetyMetrics{}
	}
	m.normalize()
	return m, nil
}

// ─── PgxRepo implementation ──────────────────────────────────────────────────

func (r *PgxRepo) SafetyMetrics(ctx context.Context) (*SafetyMetrics, error) {
	m := &SafetyMetrics{ByState: map[string]int{}, ByTier: map[string]int{}}

	// Review cases created in the last 7 days, rolled up by (state, tier) in
	// one pass; both maps are derived from the grouped rows.
	const qCases = `
		SELECT state, tier, count(*)
		FROM pharmacy_review_cases
		WHERE created_at >= now() - interval '7 days'
		GROUP BY state, tier`
	rows, err := r.db.Query(ctx, qCases)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var state, tier string
		var n int
		if err := rows.Scan(&state, &tier, &n); err != nil {
			return nil, err
		}
		m.ByState[state] += n
		m.ByTier[tier] += n
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Open cases past SLA — any age (the queue-health number, not a 7d rollup).
	const qOverdue = `
		SELECT count(*)
		FROM pharmacy_review_cases
		WHERE state IN ('SUBMITTED','PHARMACIST_REVIEW','NEEDS_INFO')
		  AND sla_deadline < now()`
	if err := r.db.QueryRow(ctx, qOverdue).Scan(&m.OpenOverdue); err != nil {
		return nil, err
	}

	// Median creation→decision latency over decisions of the last 7 days. The
	// decision timestamp comes from the evented history (the case row's
	// updated_at can be touched by later writes); percentile_cont returns NULL
	// on an empty set, which scans into the nil pointer directly.
	const qMedian = `
		SELECT percentile_cont(0.5) WITHIN GROUP (
		         ORDER BY EXTRACT(EPOCH FROM (e.created_at - c.created_at)))
		FROM pharmacy_review_case_events e
		JOIN pharmacy_review_cases c ON c.id = e.case_id
		WHERE e.to_state IN ('APPROVED','REJECTED')
		  AND e.created_at >= now() - interval '7 days'`
	if err := r.db.QueryRow(ctx, qMedian).Scan(&m.MedianDecisionSeconds); err != nil {
		return nil, err
	}

	// Search volume (24h) + T2+ gated share (7d) in one scan window each.
	const qSearches = `
		SELECT
		  count(*) FILTER (WHERE created_at >= now() - interval '24 hours'),
		  count(*) FILTER (WHERE resolved_tier IN ('T2','T3','T4')),
		  count(*)
		FROM symptom_search_events
		WHERE created_at >= now() - interval '7 days'`
	var gated, total int
	if err := r.db.QueryRow(ctx, qSearches).Scan(&m.Searches24h, &gated, &total); err != nil {
		return nil, err
	}
	if total > 0 {
		share := float64(gated) / float64(total)
		m.GatedShare7d = &share
	}
	return m, nil
}
