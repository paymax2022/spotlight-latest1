package feestrustscore

import (
	"context"
	"strings"
)

// Service computes and (optionally) overrides a School Trust Score. The computation is PURE and
// DETERMINISTIC: same inputs → same score, no clocks, no randomness, no I/O in Compute. Inputs
// are read via injected ports; overrides are persisted + audited via injected ports.
//
// This service moves NO money.
type Service struct {
	metrics   MetricsReader
	overrides OverrideStore // may be nil → overrides unavailable, computed score is authoritative
}

// MetricsReader supplies the pre-aggregated trust inputs for a school. The integration task
// backs this with real invoice / payment / reconciliation queries.
type MetricsReader interface {
	TrustInputs(ctx context.Context, schoolID string) (TrustInputs, error)
}

// OverrideStore persists + reads admin overrides (who + reason + score). Records to
// public.audit_logs is expected in the pgx implementation (module 'academy.fees').
type OverrideStore interface {
	// SaveOverride records an override (append-only history is fine; latest wins on read).
	SaveOverride(ctx context.Context, schoolID, actorID string, score float64, reason string) error
	// GetOverride returns the active override for a school, or found=false.
	GetOverride(ctx context.Context, schoolID string) (score float64, by, reason string, found bool, err error)
}

// NewService wires the trust-score service with injected metrics + override ports.
func NewService(metrics MetricsReader, overrides OverrideStore) *Service {
	return &Service{metrics: metrics, overrides: overrides}
}

// ── Weights (deterministic blend; MUST sum to 1.0) ──────────────────────────────

const (
	weightCollection = 0.50 // collection health is the dominant signal
	weightOnTime     = 0.30 // on-time payment rate
	weightDispute    = 0.20 // dispute rate (inverted: fewer disputes → higher score)
)

// ── Compute (PURE) ──────────────────────────────────────────────────────────────

// ComputeFromInputs is the PURE scoring function. It is exported + input-only (no ctx, no I/O)
// so it can be unit-tested directly and reused. Score = Σ(component.Value × component.Weight),
// all on a 0..100 scale.
//
// Components:
//   - collection_health = collected / billed            (no billing ⇒ neutral 100: nothing owed)
//   - on_time_rate      = paidOnTime / due               (no due ⇒ neutral 100)
//   - dispute_rate      = disputed / payments; scored as (1 − rate) (no payments ⇒ neutral 100)
func ComputeFromInputs(schoolID string, in TrustInputs) TrustScore {
	collection := ratioScore(in.TotalCollectedMinor, in.TotalBilledMinor)
	onTime := ratioScore(in.InvoicesPaidOnTime, in.InvoicesDue)
	// Dispute is a BAD signal → invert. With NO payments there are no disputes, so the
	// dispute component is neutral 100 (ratioScore's zero-denominator=100 would wrongly
	// invert to 0 here) — invert the rate only when payments exist.
	disputeScore := 100.0
	if in.PaymentsCount > 0 {
		disputeScore = 100.0 - ratioScore(in.DisputedCount, in.PaymentsCount)
	}

	comps := []Component{
		{
			Name:   "collection_health",
			Value:  collection,
			Weight: weightCollection,
			Detail: pctDetail("collected of billed", in.TotalCollectedMinor, in.TotalBilledMinor),
		},
		{
			Name:   "on_time_payment_rate",
			Value:  onTime,
			Weight: weightOnTime,
			Detail: pctDetail("invoices paid on time", in.InvoicesPaidOnTime, in.InvoicesDue),
		},
		{
			Name:   "dispute_rate",
			Value:  disputeScore,
			Weight: weightDispute,
			Detail: pctDetail("payments disputed (inverted)", in.DisputedCount, in.PaymentsCount),
		},
	}

	var score float64
	for i := range comps {
		comps[i].Contribution = round2(comps[i].Value * comps[i].Weight)
		score += comps[i].Value * comps[i].Weight
	}
	score = round2(score)

	return TrustScore{
		SchoolID:      schoolID,
		Score:         score,
		ComputedScore: score,
		Band:          band(score),
		Components:    comps,
	}
}

// Compute reads inputs for a school and returns its deterministic trust score, applying an
// active admin override when present (the computed score is preserved for transparency).
func (s *Service) Compute(ctx context.Context, schoolID string) (*TrustScore, error) {
	if strings.TrimSpace(schoolID) == "" {
		return nil, ErrMissingSchool
	}
	in, err := s.metrics.TrustInputs(ctx, schoolID)
	if err != nil {
		return nil, err
	}
	ts := ComputeFromInputs(schoolID, in)

	if s.overrides != nil {
		if score, by, reason, found, oerr := s.overrides.GetOverride(ctx, schoolID); oerr == nil && found {
			ts.Overridden = true
			ts.OverrideScore = score
			ts.OverrideBy = by
			ts.OverrideReason = reason
			ts.Score = score // override wins for the reported score; ComputedScore retained.
			ts.Band = band(score)
		}
	}
	return &ts, nil
}

// ── Override (records actor + reason; audited) ──────────────────────────────────

// Override records an admin override of a school's trust score. actor + reason are mandatory
// (an override must always be attributable). Score must be within 0..100.
func (s *Service) Override(ctx context.Context, actorID string, req OverrideRequest) (*TrustScore, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(req.SchoolID) == "" {
		return nil, ErrMissingSchool
	}
	if strings.TrimSpace(req.Reason) == "" {
		return nil, ErrMissingReason
	}
	if req.Score < 0 || req.Score > 100 {
		return nil, ErrInvalidScore
	}
	if s.overrides == nil {
		return nil, ErrNotFound // no override store wired
	}
	if err := s.overrides.SaveOverride(ctx, req.SchoolID, actorID, req.Score, req.Reason); err != nil {
		return nil, err
	}
	return s.Compute(ctx, req.SchoolID)
}

// ── pure helpers ──────────────────────────────────────────────────────────────────

// ratioScore returns 100 * num/den on a 0..100 scale, clamped to [0,100]. A zero denominator is
// NEUTRAL (100): nothing was owed/due, so the school is not penalised.
func ratioScore(num, den int64) float64 {
	if den <= 0 {
		return 100.0
	}
	r := (float64(num) / float64(den)) * 100.0
	if r < 0 {
		return 0
	}
	if r > 100 {
		return 100
	}
	return round2(r)
}

func band(score float64) string {
	switch {
	case score >= 85:
		return "excellent"
	case score >= 70:
		return "good"
	case score >= 50:
		return "fair"
	default:
		return "low"
	}
}

func pctDetail(label string, num, den int64) string {
	return label + ": " + i64(num) + "/" + i64(den)
}

// round2 rounds to 2 decimals deterministically (no math import needed for a stable result).
func round2(f float64) float64 {
	return float64(int64(f*100+sign(f)*0.5)) / 100
}

func sign(f float64) float64 {
	if f < 0 {
		return -1
	}
	return 1
}

func i64(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [21]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
