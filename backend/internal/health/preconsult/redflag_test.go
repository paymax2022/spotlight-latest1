package preconsult

import (
	"context"
	"encoding/json"
	"testing"

	"spotlight/backend/internal/health/triage"
)

// seedRules mirrors the migration's default red-flag rules for pure-logic testing
// (no DB). chest_pain → EMERGENCY; self_harm → CRISIS.
func seedRules() []dbRule {
	parse := func(s string) matchSpec {
		var m matchSpec
		_ = json.Unmarshal([]byte(s), &m)
		return m
	}
	return []dbRule{
		{code: "chest_pain", level: 1, severity: "emergency", routing: "EMERGENCY",
			match: parse(`{"any_field":["reason_for_visit","symptom_better_worse"],"contains":["chest pain","chest pressure","tight chest"]}`)},
		{code: "self_harm", level: 1, severity: "emergency", routing: "CRISIS",
			match: parse(`{"any_field":["reason_for_visit","symptom_better_worse"],"contains":["suicide","suicidal","kill myself","want to die","self harm"]}`)},
	}
}

func evalWith(t *testing.T, rules []dbRule, answers map[string]any) RedFlagOutcome {
	t.Helper()
	ev, _ := triage.MockExtractor{}.Extract(context.Background(), answerText(answers, "reason_for_visit"), "en")
	dbEng := &dbRuleEngine{rules: rules, answers: answers, evidence: ev}
	// Mirror redFlagEvaluator.Evaluate's aggregation without a DB load.
	out := RedFlagOutcome{Hits: []RedFlagHit{}}
	if _, err := dbEng.Evaluate(context.Background(), ev, 0, false); err != nil {
		t.Fatalf("eval: %v", err)
	}
	out.Hits = dbEng.matched
	worst := 0
	for _, h := range out.Hits {
		if worst == 0 || h.Level < worst {
			worst = h.Level
			out.Severity = h.Severity
			out.Routing = h.Routing
		}
	}
	out.Level = worst
	out.Triggered = len(out.Hits) > 0
	return out
}

func TestRedFlag_ChestPain(t *testing.T) {
	out := evalWith(t, seedRules(), map[string]any{"reason_for_visit": "I have chest pain since morning"})
	if !out.Triggered || out.Routing != "EMERGENCY" || out.Severity != "emergency" {
		t.Fatalf("chest pain should route EMERGENCY emergency, got %+v", out)
	}
}

func TestRedFlag_SelfHarmCrisis(t *testing.T) {
	out := evalWith(t, seedRules(), map[string]any{"reason_for_visit": "sometimes I think about suicide"})
	if !out.Triggered || out.Routing != "CRISIS" {
		t.Fatalf("self-harm should route CRISIS, got %+v", out)
	}
}

func TestRedFlag_NoFalsePositiveOnBenign(t *testing.T) {
	out := evalWith(t, seedRules(), map[string]any{"reason_for_visit": "mild headache and a runny nose for two days"})
	if out.Triggered {
		t.Fatalf("benign complaint must not trigger a red flag, got %+v", out)
	}
}

func TestRedFlag_CaseInsensitiveContains(t *testing.T) {
	out := evalWith(t, seedRules(), map[string]any{"reason_for_visit": "TIGHT CHEST and sweating"})
	if !out.Triggered || out.Routing != "EMERGENCY" {
		t.Fatalf("case-insensitive contains should fire, got %+v", out)
	}
}

func TestApplyRedFlag_OnlyRaises(t *testing.T) {
	// engine at routine level 4; a level-1 hit must raise (lower) to 1.
	hit := &triage.RedFlagHit{RuleID: "x", Level: 1, Severity: "emergency"}
	lvl, raised := triage.ApplyRedFlag(4, hit)
	if !raised || lvl != 1 {
		t.Fatalf("ApplyRedFlag should raise to 1, got lvl=%d raised=%v", lvl, raised)
	}
	// a less-urgent hit (level 3) must never lower an existing level-1.
	lvl2, _ := triage.ApplyRedFlag(1, &triage.RedFlagHit{Level: 3})
	if lvl2 != 1 {
		t.Fatalf("ApplyRedFlag must not lower urgency, got %d", lvl2)
	}
}

func TestRuleMatches_EvidenceCode(t *testing.T) {
	m := matchSpec{Evidence: []string{"s_chest_pain"}}
	if !ruleMatches(m, map[string]any{}, map[string]bool{"s_chest_pain": true}) {
		t.Fatalf("evidence-code match should fire")
	}
	if ruleMatches(m, map[string]any{}, map[string]bool{}) {
		t.Fatalf("evidence-code should not fire when absent")
	}
}
