package governance

import (
	"context"

	"spotlight/backend/internal/health/triage"
)

// RuleSource is the slice of the repository DBRedFlagEngine needs: the live
// (PUBLISHED) red-flag rule set. Decoupled as an interface for testability.
type RuleSource interface {
	ListPublishedRules(ctx context.Context) ([]RedFlagRule, error)
}

// DBRedFlagEngine implements triage.RedFlagEngine over the CLINICIAN-GOVERNED,
// PUBLISHED red-flag rules. It is the DB-backed layer that sits ON TOP of the
// deterministic triage.DefaultRedFlagEngine (SC-2/SC-3):
//
//   - The default engine is the hard-coded safety net that always fires on
//     unambiguous danger signs even with no DB rules.
//   - DBRedFlagEngine evaluates the additional, clinician-authored published rules.
//   - The two are combined by Evaluate (most-urgent wins) and the combined hit only
//     EVER RAISES urgency at the core service via triage.ApplyRedFlag — a rule can
//     never lower the disposition.
//
// Only PUBLISHED rules are loaded, so an un-signed-off (draft/review/approved) rule
// is inert: it cannot affect a live triage (SC-6).
type DBRedFlagEngine struct {
	src      RuleSource
	fallback triage.RedFlagEngine // the deterministic default we layer over
}

// NewDBRedFlagEngineWithSource builds the engine over a rule source, layering on
// top of the supplied fallback (pass triage.DefaultRedFlagEngine{}). The
// exported package constructor NewDBRedFlagEngine (handler.go) wires the pool.
func NewDBRedFlagEngineWithSource(src RuleSource, fallback triage.RedFlagEngine) *DBRedFlagEngine {
	if fallback == nil {
		fallback = triage.DefaultRedFlagEngine{}
	}
	return &DBRedFlagEngine{src: src, fallback: fallback}
}

// Evaluate runs the deterministic default first, then every PUBLISHED DB rule, and
// returns the MOST-URGENT hit (lowest level). Because the result is only ever
// applied via triage.ApplyRedFlag (which keeps the more-urgent level), urgency can
// only RISE — never fall. A failure to load DB rules degrades gracefully to the
// default safety net (fail-closed toward safety: we never DROP a default hit).
func (e *DBRedFlagEngine) Evaluate(ctx context.Context, ev []triage.Evidence, ageYears int, pregnant bool) (*triage.RedFlagHit, error) {
	// 1) Deterministic default safety net (always-on, never bypassed).
	best, _ := e.fallback.Evaluate(ctx, ev, ageYears, pregnant)

	// 2) Layer the clinician-governed published rules on top.
	if e.src != nil {
		rules, err := e.src.ListPublishedRules(ctx)
		if err != nil {
			// Degrade to the default: returning it preserves the safety net.
			return best, nil
		}
		present := presentSet(ev)
		for i := range rules {
			r := &rules[i]
			if !ruleMatches(r, present, ageYears, pregnant) {
				continue
			}
			hit := &triage.RedFlagHit{
				RuleID:   r.ID,
				Level:    clampLevel(r.UrgencyLevel),
				Severity: severityOf(r),
				Matched:  map[string]any{"rule": r.Code, "version": r.Version, "source": "db_published"},
			}
			best = moreUrgent(best, hit)
		}
	}
	return best, nil
}

// presentSet builds the set of codes whose evidence value is "present".
func presentSet(ev []triage.Evidence) map[string]bool {
	out := map[string]bool{}
	for _, e := range ev {
		if e.Value == "present" {
			out[e.Code] = true
		}
	}
	return out
}

// ruleMatches evaluates a rule's condition against present evidence + demographics.
// Conservative: an empty condition (no AllPresent/AnyPresent) never fires, so a
// mis-authored rule can't blanket-override (fail-closed toward NOT firing spuriously,
// while the default safety net still covers true emergencies).
func ruleMatches(r *RedFlagRule, present map[string]bool, ageYears int, pregnant bool) bool {
	c := r.Condition
	if len(c.AllPresent) == 0 && len(c.AnyPresent) == 0 {
		return false
	}
	if c.RequirePregnant && !pregnant {
		return false
	}
	if c.MaxAgeYears != nil && ageYears > *c.MaxAgeYears {
		return false
	}
	if c.MinAgeYears != nil && ageYears < *c.MinAgeYears {
		return false
	}
	for _, code := range c.AllPresent {
		if !present[code] {
			return false
		}
	}
	if len(c.AnyPresent) > 0 {
		any := false
		for _, code := range c.AnyPresent {
			if present[code] {
				any = true
				break
			}
		}
		if !any {
			return false
		}
	}
	for _, code := range c.NonePresent {
		if present[code] {
			return false
		}
	}
	return true
}

// moreUrgent returns whichever hit forces the more-urgent (lower) level. nil-safe.
// This is the urgency-only combine: it can never select a LESS urgent hit.
func moreUrgent(a, b *triage.RedFlagHit) *triage.RedFlagHit {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	if b.Level < a.Level {
		return b
	}
	return a
}

func clampLevel(l int) int {
	if l < triage.LevelEmergencyAmbulance {
		return triage.LevelEmergencyAmbulance
	}
	if l > triage.LevelSelfCare {
		return triage.LevelSelfCare
	}
	return l
}

func severityOf(r *RedFlagRule) string {
	if r.Severity != "" {
		return r.Severity
	}
	if r.UrgencyLevel <= triage.LevelEmergencyAmbulance {
		return "emergency"
	}
	return "urgent"
}

// Ensure DBRedFlagEngine satisfies the parent contract.
var _ triage.RedFlagEngine = (*DBRedFlagEngine)(nil)
