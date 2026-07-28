package preconsult

import (
	"context"
	"encoding/json"
	"strings"
)

// ai.go — OPTIONAL symptom-checker pre-fill (PRD M4). Reuses the integrations/llm
// client behind a narrow LLMGenerator interface (estate ainotes pattern) with a
// deterministic mock default so the package runs offline and never blocks intake.
//
// Safety: any AI-structured complaint is labelled PATIENT-REPORTED, never assessed
// or diagnosed (PRD §5.3). The result is a SUGGESTION the patient may accept/edit —
// it is never required and never auto-submitted.

// LLMGenerator is the slice of the LLM client this package needs. Satisfied by
// *llm.Client; a nil generator falls back to the deterministic mock.
type LLMGenerator interface {
	Enabled() bool
	Model() string
	GenerateJSON(ctx context.Context, systemPrompt, userPrompt string) (json.RawMessage, error)
}

// ComplaintSuggestion is the structured, patient-reported pre-fill for M4. It maps
// only to schema fields the patient can edit; it asserts no clinical conclusion.
type ComplaintSuggestion struct {
	PatientReported bool   `json:"patient_reported"` // always true
	ReasonForVisit  string `json:"reason_for_visit"`
	ReasonCategory  string `json:"reason_category,omitempty"`
	SymptomOnset    string `json:"symptom_onset,omitempty"`
	Source          string `json:"source"` // "ai" | "mock"
}

const complaintSystemPrompt = `You restructure a patient's own words into a brief chief complaint for a pre-consultation intake. You do NOT diagnose, assess, or give medical advice. Respond with ONLY valid JSON, no markdown, in exactly this shape:
{
  "reason_for_visit": "string, <= 200 chars, the patient's complaint in plain words",
  "reason_category": "one of: general|skin|respiratory|digestive|mental_health|sexual_health|pain|injury|chronic_followup|other, or empty",
  "symptom_onset": "one of: today|few_days|about_a_week|few_weeks|over_a_month, or empty"
}
Do not invent symptoms the patient did not state.`

// SuggestComplaint structures free text into a patient-reported complaint. With no
// configured LLM it uses a deterministic keyword mock (never fabricated clinical
// content). The patient must confirm/edit before it enters the form.
func (s *Service) SuggestComplaint(ctx context.Context, freeText string) (*ComplaintSuggestion, error) {
	if s.llm != nil && s.llm.Enabled() {
		raw, err := s.llm.GenerateJSON(ctx, complaintSystemPrompt, "Patient said:\n"+freeText)
		if err == nil {
			var sug ComplaintSuggestion
			if json.Unmarshal(raw, &sug) == nil && sug.ReasonForVisit != "" {
				sug.PatientReported = true
				sug.Source = "ai"
				return &sug, nil
			}
		}
		// Fall through to the deterministic mock on any AI failure (never block intake).
	}
	return mockComplaint(freeText), nil
}

// mockComplaint is the deterministic, network-free fallback.
func mockComplaint(freeText string) *ComplaintSuggestion {
	t := strings.TrimSpace(freeText)
	if len(t) > 200 {
		t = t[:200]
	}
	cat := ""
	lower := strings.ToLower(freeText)
	switch {
	case strings.Contains(lower, "rash") || strings.Contains(lower, "skin"):
		cat = "skin"
	case strings.Contains(lower, "cough") || strings.Contains(lower, "breath"):
		cat = "respiratory"
	case strings.Contains(lower, "stomach") || strings.Contains(lower, "vomit") || strings.Contains(lower, "diarr"):
		cat = "digestive"
	case strings.Contains(lower, "pain"):
		cat = "pain"
	}
	return &ComplaintSuggestion{PatientReported: true, ReasonForVisit: t, ReasonCategory: cat, Source: "mock"}
}
