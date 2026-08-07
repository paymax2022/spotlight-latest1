package feestrustscore

import "errors"

// Package feestrustscore computes a School Trust Score (build-spec E9 / T9.1). The score is a
// PURE, DETERMINISTIC, EXPLAINABLE function of a school's collection health, on-time payment
// rate and dispute rate. Inputs are read through injected interfaces over the fees domain
// (invoices / payments / reconciliation) so the computation is testable with in-memory fakes.
//
// This package moves NO money and posts NO ledger entries. It is a read + compute + (optional
// admin override) surface only.

// ── Inputs ───────────────────────────────────────────────────────────────────────

// TrustInputs are the raw, pre-aggregated metrics for one school over a scoring window. They
// are supplied by the injected MetricsReader (which the integration task backs with real
// invoice / payment / reconciliation queries). All monetary values are int64 minor units.
type TrustInputs struct {
	// Collection health.
	TotalBilledMinor    int64 // SUM(issued invoice totals) in the window
	TotalCollectedMinor int64 // SUM(succeeded payments) in the window

	// On-time payment rate.
	InvoicesDue        int64 // invoices that reached their due date in the window
	InvoicesPaidOnTime int64 // of those, paid in full on or before the due date

	// Dispute rate.
	PaymentsCount int64 // total payments recorded in the window
	DisputedCount int64 // of those, disputed / charged-back / reversed
}

// ── Output ───────────────────────────────────────────────────────────────────────

// Component is one weighted, explainable contributor to the overall score. Value and
// Contribution are on a 0..100 scale; Contribution = Value * Weight.
type Component struct {
	Name         string  `json:"name"`
	Value        float64 `json:"value"`        // the component's own 0..100 score
	Weight       float64 `json:"weight"`       // its weight in the blend (weights sum to 1)
	Contribution float64 `json:"contribution"` // Value * Weight (adds up to Score)
	Detail       string  `json:"detail"`       // human-readable explanation of the value
}

// TrustScore is the explainable result: an overall 0..100 score plus the component breakdown
// that produced it. When an admin override is in effect, Overridden is true and the override
// metadata is populated (the computed score is preserved in ComputedScore for transparency).
type TrustScore struct {
	SchoolID      string      `json:"schoolId"`
	Score         float64     `json:"score"`         // final 0..100 (override wins when present)
	ComputedScore float64     `json:"computedScore"` // the deterministic computed score
	Band          string      `json:"band"`          // low / fair / good / excellent
	Components    []Component `json:"components"`

	// Admin override (records who overrode + reason; the computed score is retained above).
	Overridden     bool    `json:"overridden"`
	OverrideScore  float64 `json:"overrideScore,omitempty"`
	OverrideBy     string  `json:"overrideBy,omitempty"`
	OverrideReason string  `json:"overrideReason,omitempty"`
}

// OverrideRequest records an admin override of a school's computed trust score. actor + reason
// are mandatory and are recorded (audited) so an override is always attributable.
type OverrideRequest struct {
	SchoolID string  `json:"schoolId" binding:"required"`
	Score    float64 `json:"score" binding:"required"`
	Reason   string  `json:"reason" binding:"required"`
}

// ── Sentinel errors ─────────────────────────────────────────────────────────────

var (
	ErrMissingSchool   = errors.New("missing_school")
	ErrUnauthenticated = errors.New("unauthenticated")
	ErrMissingReason   = errors.New("missing_override_reason")
	ErrInvalidScore    = errors.New("invalid_score") // outside 0..100
	ErrNotFound        = errors.New("not_found")
)
