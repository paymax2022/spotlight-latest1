package triage

import (
	"context"
	"strings"
)

// mock.go — deterministic, network-free implementations so the package runs in
// dev/CI without a licensed engine or LLM key (mock-first). The real Infermedica
// adapter + LLM extractor are wired by config when credentials are present.

// MockEngine is a deterministic stand-in for the licensed triage engine. It asks a
// couple of follow-ups then returns a conservative 5-level disposition derived from
// a simple severity heuristic. It NEVER diagnoses (SC-1) — output is possibilities.
type MockEngine struct{}

func (MockEngine) Name() string { return "mock" }

func (MockEngine) Triage(_ context.Context, in EngineInput) (EngineResult, error) {
	symptoms := 0
	severe := false
	for _, e := range in.Evidence {
		if e.Kind == "symptom" && e.Value == "present" {
			symptoms++
			if isSevereSymptom(e.Code) {
				severe = true
			}
		}
	}
	// Ask one clarifying question on a thin first pass (adaptive interview).
	if symptoms <= 1 && !severe {
		return EngineResult{
			Questions: []Question{{Code: "q_duration", Text: "How long have you had this?", Options: []string{"today", "few days", "over a week"}}},
			Done:      false,
			EngineRef: "mock",
		}, nil
	}
	level := LevelSelfCare
	switch {
	case severe:
		level = LevelEmergencyUrgent
	case symptoms >= 3:
		level = LevelConsult24h
	case symptoms == 2:
		level = LevelConsult
	}
	// Malaria-endemic region bias (Africa-tuning): fever in-region → at least consult.
	if in.Region != "" && hasSymptom(in.Evidence, "s_fever") && level > LevelConsult {
		level = LevelConsult
	}
	return EngineResult{
		Conditions: []PossibleCause{{Label: "Common viral illness", Probability: 0.4}, {Label: "Malaria (consider in-region)", Probability: 0.3}},
		Level:      level,
		Code:       dispositionCode(level),
		Done:       true,
		EngineRef:  "mock",
	}, nil
}

// MockExtractor maps free text → structured evidence via a keyword map (no LLM,
// no conclusions). The real extractor uses a constrained LLM with this as fallback.
type MockExtractor struct{}

var keywordToSymptom = map[string]string{
	"fever": "s_fever", "hot": "s_fever", "temperature": "s_fever",
	"headache": "s_headache", "cough": "s_cough", "catarrh": "s_cough",
	"chest pain": "s_chest_pain", "chest dey pain": "s_chest_pain",
	"breath": "s_breathlessness", "breathing": "s_breathlessness", "no fit breathe": "s_breathlessness",
	"bleed": "s_bleeding", "blood": "s_bleeding",
	"unconscious": "s_unconscious", "faint": "s_unconscious", "no dey respond": "s_unconscious",
	"convuls": "s_convulsion", "seizure": "s_convulsion",
	"vomit": "s_vomiting", "purge": "s_diarrhea", "diarrh": "s_diarrhea", "belle run": "s_diarrhea",
	"weak": "s_weakness", "tired": "s_weakness", "pain": "s_pain",
}

func (MockExtractor) Extract(_ context.Context, text, _ string) ([]Evidence, error) {
	lower := strings.ToLower(text)
	seen := map[string]bool{}
	var out []Evidence
	for kw, code := range keywordToSymptom {
		if strings.Contains(lower, kw) && !seen[code] {
			seen[code] = true
			out = append(out, Evidence{Kind: "symptom", Code: code, Value: "present", Source: "nlu"})
		}
	}
	return out, nil
}

// DefaultRedFlagEngine is the deterministic safety net (SC-2/SC-3): even with no
// DB-published rules it forces EMERGENCY on unambiguous danger signs. The DB-backed
// rule engine (clinician-governed) layers ON TOP and can only raise urgency further.
type DefaultRedFlagEngine struct{}

func (DefaultRedFlagEngine) Evaluate(_ context.Context, ev []Evidence, ageYears int, pregnant bool) (*RedFlagHit, error) {
	present := map[string]bool{}
	for _, e := range ev {
		if e.Value == "present" {
			present[e.Code] = true
		}
	}
	hit := func(rule string, lvl int) *RedFlagHit {
		return &RedFlagHit{RuleID: rule, Level: lvl, Severity: "emergency", Matched: map[string]any{"rule": rule}}
	}
	switch {
	case present["s_unconscious"], present["s_convulsion"]:
		return hit("rf_unconscious_convulsion", LevelEmergencyAmbulance), nil
	case present["s_chest_pain"] && present["s_breathlessness"]:
		return hit("rf_chest_pain_breathless", LevelEmergencyAmbulance), nil
	case present["s_breathlessness"]:
		return hit("rf_breathlessness", LevelEmergencyUrgent), nil
	case present["s_bleeding"] && (pregnant || ageYears < 5):
		return hit("rf_bleeding_high_risk", LevelEmergencyAmbulance), nil // maternal/paediatric (SC-9)
	case present["s_fever"] && ageYears < 1:
		return hit("rf_infant_fever", LevelEmergencyUrgent), nil // SC-9 paediatric caution
	}
	return nil, nil
}

// ── helpers ──

func isSevereSymptom(code string) bool {
	switch code {
	case "s_chest_pain", "s_breathlessness", "s_bleeding", "s_unconscious", "s_convulsion":
		return true
	}
	return false
}

func hasSymptom(ev []Evidence, code string) bool {
	for _, e := range ev {
		if e.Code == code && e.Value == "present" {
			return true
		}
	}
	return false
}

func dispositionCode(level int) string {
	switch level {
	case LevelEmergencyAmbulance:
		return "emergency_ambulance"
	case LevelEmergencyUrgent:
		return "emergency_urgent"
	case LevelConsult24h:
		return "consult_24h"
	case LevelConsult:
		return "consult"
	default:
		return "self_care"
	}
}
