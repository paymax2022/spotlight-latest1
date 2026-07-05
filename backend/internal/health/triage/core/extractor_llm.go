package core

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"spotlight/backend/internal/health/triage"
)

// extractor_llm.go — LLMExtractor implements triage.EvidenceExtractor by asking a
// server-side LLM to map free text / voice transcript (EN/Pidgin/…) into STRUCTURED
// evidence the engine consumes.
//
// SC-10 (anti-hallucination): the LLM does EVIDENCE EXTRACTION ONLY. It must never
// produce a diagnosis, a disposition, dosing, or any clinical conclusion. The
// system prompt constrains it to emit ONLY a JSON array of {kind,code,value}, and
// this code defensively drops anything that is not a recognised structured fact.
//
// On ANY error (LLM disabled, network, malformed JSON, empty) the extractor falls
// back to triage.MockExtractor (keyword map) so triage degrades safely and never
// fabricates conclusions.

// llmGenerator is the consumer-side slice of the LLM client we need; *llm.Client
// satisfies it. Defining it here keeps the package testable and decoupled.
type llmGenerator interface {
	Enabled() bool
	GenerateJSON(ctx context.Context, systemPrompt, userPrompt string) (json.RawMessage, error)
}

// LLMExtractor maps free text → structured Evidence via a constrained LLM, with a
// deterministic mock fallback.
type LLMExtractor struct {
	gen      llmGenerator
	fallback triage.EvidenceExtractor
}

// NewLLMExtractor builds the extractor. A nil/disabled gen makes Extract delegate
// straight to the mock (mock-first). fallback defaults to triage.MockExtractor.
func NewLLMExtractor(gen llmGenerator) *LLMExtractor {
	return &LLMExtractor{gen: gen, fallback: triage.MockExtractor{}}
}

// extractionSystemPrompt is the hard constraint. It forbids conclusions (SC-10)
// and pins the output schema. The model is told it is NOT a doctor and must only
// transcribe symptoms/risk-factors into structured codes.
const extractionSystemPrompt = `You are a medical SCRIBE for a triage system. You DO NOT diagnose, ` +
	`advise, prescribe, or assign urgency. Your ONLY job is to convert the user's free-text ` +
	`symptom description (which may be in English or Nigerian Pidgin/Hausa/Yoruba/Igbo) into a ` +
	`list of STRUCTURED clinical evidence items.

Rules:
- Output ONLY a JSON array. No prose, no markdown, no explanation.
- Each item: {"kind":"symptom"|"risk_factor"|"answer","code":"<snake_case concept id>","value":"present"|"absent"|"unknown"}.
- Use concept ids like s_fever, s_headache, s_cough, s_chest_pain, s_breathlessness, s_bleeding, s_unconscious, s_convulsion, s_vomiting, s_diarrhea, s_weakness, s_pain.
- NEVER output a diagnosis, disease name, condition, treatment, medication, dose, or urgency level.
- If you find nothing structured, output [].
Return ONLY the JSON array.`

// llmEvidenceItem is the strict shape the model must emit.
type llmEvidenceItem struct {
	Kind  string `json:"kind"`
	Code  string `json:"code"`
	Value string `json:"value"`
}

// Extract converts text → []triage.Evidence. It NEVER returns conclusions (SC-10).
func (x *LLMExtractor) Extract(ctx context.Context, text, language string) ([]triage.Evidence, error) {
	if x == nil || x.gen == nil || !x.gen.Enabled() || strings.TrimSpace(text) == "" {
		return x.fallbackExtract(ctx, text, language)
	}

	userPrompt := fmt.Sprintf("Language: %s\nUser said: %q\nReturn the JSON evidence array.", language, text)
	raw, err := x.gen.GenerateJSON(ctx, extractionSystemPrompt, userPrompt)
	if err != nil {
		// SC-10: never fabricate — degrade to the deterministic keyword extractor.
		return x.fallbackExtract(ctx, text, language)
	}

	var items []llmEvidenceItem
	if err := json.Unmarshal(raw, &items); err != nil || len(items) == 0 {
		return x.fallbackExtract(ctx, text, language)
	}

	out := make([]triage.Evidence, 0, len(items))
	for _, it := range items {
		// Defensive filter: drop anything that is not a recognised structured fact.
		// This is the second line of SC-10 defence even if the prompt is subverted.
		if !validKind(it.Kind) || it.Code == "" || isConclusionCode(it.Code) {
			continue
		}
		out = append(out, triage.Evidence{
			Kind:   it.Kind,
			Code:   normalizeCode(it.Code),
			Value:  normalizeValue(it.Value),
			Source: "nlu",
		})
	}
	if len(out) == 0 {
		return x.fallbackExtract(ctx, text, language)
	}
	return out, nil
}

func (x *LLMExtractor) fallbackExtract(ctx context.Context, text, language string) ([]triage.Evidence, error) {
	if x == nil || x.fallback == nil {
		return triage.MockExtractor{}.Extract(ctx, text, language)
	}
	return x.fallback.Extract(ctx, text, language)
}

func validKind(k string) bool {
	switch k {
	case "symptom", "risk_factor", "answer":
		return true
	}
	return false
}

// isConclusionCode rejects codes that look like diagnoses/conditions/treatments —
// the LLM must produce evidence, not conclusions (SC-10). Heuristic but defensive.
func isConclusionCode(code string) bool {
	c := strings.ToLower(code)
	for _, bad := range []string{"dx_", "cond_", "disease", "diagnos", "rx_", "drug_", "treat", "dose", "mg", "prescri"} {
		if strings.Contains(c, bad) {
			return true
		}
	}
	return false
}

func normalizeCode(code string) string {
	c := strings.TrimSpace(strings.ToLower(code))
	c = strings.ReplaceAll(c, " ", "_")
	return c
}

func normalizeValue(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "present", "yes", "true":
		return "present"
	case "absent", "no", "false":
		return "absent"
	case "":
		return "present"
	default:
		return "unknown"
	}
}
