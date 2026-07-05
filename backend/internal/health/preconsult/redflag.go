package preconsult

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/health/triage"
	triagecore "spotlight/backend/internal/health/triage/core"
)

// redflag.go — submit-time triage for the pre-consult intake (ADR-010 §5).
//
// Two layers, both can ONLY RAISE urgency (triage.ApplyRedFlag / LayeredRedFlag):
//  1. triage.DefaultRedFlagEngine — the deterministic safety net on Evidence
//     extracted from the free-text answers (always runs).
//  2. dbRuleEngine — the admin-configurable health_redflag_rule rows
//     (any_field + contains case-insensitive substring; equals; evidence codes).
//
// A hit never silently queues a routine consult: the caller surfaces guidance/
// routing (urgent_guidance / crisis_guidance from health_intake_config) and the
// intake is flagged. The SELF-HARM rule (code self_harm) routes CRISIS with the
// supportive crisis copy — no safety-assessment questions, no confidentiality
// claims.

// RedFlagHit is one matched rule (decision-support; ids/codes only — no answer
// bodies are ever persisted to access/audit logs).
type RedFlagHit struct {
	RuleCode string `json:"rule_code"`
	Level    int    `json:"level"`    // triage 1..5 (1 = emergency)
	Severity string `json:"severity"` // emergency | urgent
	Routing  string `json:"routing"`  // EMERGENCY | URGENT_CARE | CRISIS
}

// RedFlagOutcome is the aggregate evaluation result for one submit.
type RedFlagOutcome struct {
	Triggered bool         `json:"triggered"`
	Level     int          `json:"level"`             // most urgent (lowest) level across hits
	Severity  string       `json:"severity"`          // emergency | urgent (worst)
	Routing   string       `json:"routing,omitempty"` // EMERGENCY | URGENT_CARE | CRISIS (worst)
	Hits      []RedFlagHit `json:"hits"`
}

// dbRule mirrors a health_redflag_rule row's evaluable fields.
type dbRule struct {
	code     string
	level    int
	severity string
	routing  string
	match    matchSpec
}

// matchSpec is the parsed match_json contract.
type matchSpec struct {
	AnyField []string `json:"any_field"`
	Contains []string `json:"contains"`
	Equals   *struct {
		Field string `json:"field"`
		Value string `json:"value"`
	} `json:"equals"`
	Evidence []string `json:"evidence"`
}

// redFlagEvaluator loads + evaluates rules. It is constructed per-service.
type redFlagEvaluator struct {
	db *pgxpool.Pool
}

func newRedFlagEvaluator(db *pgxpool.Pool) *redFlagEvaluator {
	return &redFlagEvaluator{db: db}
}

// answerText collects the free-text answer fields a rule may scan into a single
// lowercased string per field name, used by both the substring matcher and the
// Evidence extractor. Only the fields a rule names are read.
func answerText(answers map[string]any, field string) string {
	v, ok := answers[field]
	if !ok || v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// Evaluate runs the deterministic safety net + the DB rules and returns the
// aggregate outcome (urgency only ever raised). pregnant is derived from the
// pregnancy_status answer; ageYears is best-effort (0 when unknown — the base
// engine's age-gated rules then simply do not fire).
func (e *redFlagEvaluator) Evaluate(ctx context.Context, answers map[string]any, ageYears int, pregnant bool) (RedFlagOutcome, error) {
	out := RedFlagOutcome{Hits: []RedFlagHit{}}

	// 1) Build Evidence from the free-text symptom fields (reuse triage extractor —
	//    extraction only, never conclusions, SC-10).
	var blob strings.Builder
	for _, f := range []string{"reason_for_visit", "symptom_better_worse"} {
		if t := answerText(answers, f); t != "" {
			blob.WriteString(" ")
			blob.WriteString(t)
		}
	}
	ev, _ := triage.MockExtractor{}.Extract(ctx, blob.String(), "en")

	// 2) DB rules wrapped as a triage.RedFlagEngine so the layered engine + the
	//    "never lower urgency" rule (ApplyRedFlag) apply uniformly.
	rules, err := e.loadActiveRules(ctx)
	if err != nil {
		return out, err
	}
	dbEng := &dbRuleEngine{rules: rules, answers: answers, evidence: ev}

	layered := triagecore.NewLayeredRedFlag(triage.DefaultRedFlagEngine{}, dbEng)
	hit, err := layered.Evaluate(ctx, ev, ageYears, pregnant)
	if err != nil {
		return out, err
	}

	// Collect every DB hit (for the red-flag queue + intake.red_flag_hits) and the
	// worst routing/severity. The base safety net's hit (if any) is folded in via
	// ApplyRedFlag below so urgency only raises.
	out.Hits = dbEng.matched
	worstLevel := 0
	for _, h := range out.Hits {
		if worstLevel == 0 || h.Level < worstLevel {
			worstLevel = h.Level
			out.Severity = h.Severity
			out.Routing = h.Routing
		}
	}

	// Fold in the base safety-net hit (raises urgency only).
	if hit != nil {
		lvl, raised := triage.ApplyRedFlag(worstLevel, hit)
		if raised {
			out.Triggered = true
		}
		if worstLevel == 0 || lvl < worstLevel {
			worstLevel = lvl
			// The base safety net is always an emergency-class danger sign.
			if out.Severity == "" {
				out.Severity = "emergency"
			}
			if out.Routing == "" {
				out.Routing = "EMERGENCY"
			}
		}
	}
	if len(out.Hits) > 0 {
		out.Triggered = true
	}
	out.Level = worstLevel
	return out, nil
}

// dbRuleEngine adapts the configurable health_redflag_rule rows to the triage
// RedFlagEngine contract. It records every match (out.matched) and returns the
// most urgent (lowest-level) hit so the layered engine can compare it against the
// base safety net.
type dbRuleEngine struct {
	rules    []dbRule
	answers  map[string]any
	evidence []triage.Evidence
	matched  []RedFlagHit
}

func (d *dbRuleEngine) Evaluate(_ context.Context, _ []triage.Evidence, _ int, _ bool) (*triage.RedFlagHit, error) {
	present := map[string]bool{}
	for _, e := range d.evidence {
		if e.Value == "present" {
			present[e.Code] = true
		}
	}
	var best *triage.RedFlagHit
	for _, r := range d.rules {
		if !ruleMatches(r.match, d.answers, present) {
			continue
		}
		d.matched = append(d.matched, RedFlagHit{
			RuleCode: r.code, Level: r.level, Severity: r.severity, Routing: r.routing,
		})
		if best == nil || r.level < best.Level {
			best = &triage.RedFlagHit{
				RuleID:   r.code,
				Level:    r.level,
				Severity: r.severity,
				Matched:  map[string]any{"rule_code": r.code, "routing": r.routing},
			}
		}
	}
	return best, nil
}

// ruleMatches implements the match_json contract: a rule fires when ANY of its
// contains substrings appears (case-insensitive) in ANY named any_field, OR the
// equals field exactly matches, OR any named evidence code is present.
func ruleMatches(m matchSpec, answers map[string]any, present map[string]bool) bool {
	// contains over any_field (case-insensitive substring).
	if len(m.Contains) > 0 && len(m.AnyField) > 0 {
		for _, f := range m.AnyField {
			hay := strings.ToLower(answerText(answers, f))
			if hay == "" {
				continue
			}
			for _, needle := range m.Contains {
				if needle != "" && strings.Contains(hay, strings.ToLower(needle)) {
					return true
				}
			}
		}
	}
	// equals (exact, case-insensitive).
	if m.Equals != nil && m.Equals.Field != "" {
		if strings.EqualFold(strings.TrimSpace(answerText(answers, m.Equals.Field)), strings.TrimSpace(m.Equals.Value)) {
			return true
		}
	}
	// evidence codes.
	for _, code := range m.Evidence {
		if present[code] {
			return true
		}
	}
	return false
}
