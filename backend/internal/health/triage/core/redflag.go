package core

import (
	"context"

	"spotlight/backend/internal/health/triage"
)

// redflag.go — LayeredRedFlag is the deterministic emergency-detection layer
// (SC-2/SC-3). It ALWAYS runs triage.DefaultRedFlagEngine first as the
// non-negotiable safety net (unambiguous danger signs force EMERGENCY even with
// zero DB-published rules), and it is OPEN to a clinician-governed DB rule engine
// injected later via `extra`. The two layers can only RAISE urgency; the most
// urgent (lowest-level) hit wins. Emergency detection is rules-based, never
// probability-only.
type LayeredRedFlag struct {
	base  triage.RedFlagEngine // safety net; defaults to DefaultRedFlagEngine
	extra triage.RedFlagEngine // optional clinician-authored DB rule engine
}

// NewLayeredRedFlag builds the layered engine. A nil base falls back to the
// deterministic triage.DefaultRedFlagEngine (the safety net must always exist).
// extra may be nil until the DB rule engine is wired.
func NewLayeredRedFlag(base, extra triage.RedFlagEngine) *LayeredRedFlag {
	if base == nil {
		base = triage.DefaultRedFlagEngine{}
	}
	return &LayeredRedFlag{base: base, extra: extra}
}

// Evaluate runs BOTH layers and returns the most-urgent (lowest Level) hit, or
// nil if neither fires. A nil from one layer never suppresses a hit from the
// other — the layers are additive toward safety (SC-2).
func (l *LayeredRedFlag) Evaluate(ctx context.Context, ev []triage.Evidence, ageYears int, pregnant bool) (*triage.RedFlagHit, error) {
	var best *triage.RedFlagHit

	if l.base != nil {
		hit, err := l.base.Evaluate(ctx, ev, ageYears, pregnant)
		if err != nil {
			// The base safety net must never be silently skipped on error.
			return nil, err
		}
		best = mostUrgent(best, hit)
	}

	if l.extra != nil {
		// A failure in the (optional, later-injected) DB rule engine must NOT
		// disable the deterministic safety net — keep the base hit on extra error.
		if hit, err := l.extra.Evaluate(ctx, ev, ageYears, pregnant); err == nil {
			best = mostUrgent(best, hit)
		}
	}

	return best, nil
}

// mostUrgent returns whichever hit forces the more urgent (lower) level. nil hits
// are ignored. Lower Level == more urgent (1 = ambulance).
func mostUrgent(a, b *triage.RedFlagHit) *triage.RedFlagHit {
	switch {
	case a == nil:
		return b
	case b == nil:
		return a
	case b.Level < a.Level:
		return b
	default:
		return a
	}
}
