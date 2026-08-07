package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"spotlight/backend/internal/health/triage"
)

// engine_infermedica.go — InfermedicaEngine implements triage.EngineProvider by
// calling the licensed Infermedica Engine/Platform API (/triage + /diagnosis,
// 5-level triage). It is the "buy-the-engine, own-the-edge" choice from PRD §5.
//
// SAFETY:
//   - SC-7: the request body is DE-IDENTIFIED — age band (years) + sex + evidence
//     only. NO name / DOB / PII is ever sent. The region rides as evidence, not as
//     a free-text address.
//   - SC-1/SC-4: the engine triages only — output is mapped to a 5-level
//     disposition + possible causes; this adapter never frames output as a
//     diagnosis and never returns dosing/prescriptions.
//   - The adapter is used ONLY when App-Id/App-Key creds are present; otherwise the
//     wiring layer falls back to triage.MockEngine (mock-first, network-free CI).

const (
	infermedicaBaseURL = "https://api.infermedica.com/v3"
	infermedicaTimeout = 12 * time.Second
)

// InfermedicaEngine is the HTTP client for the Infermedica engine. appID/appKey
// are server-side only and never returned to a client or logged.
type InfermedicaEngine struct {
	appID   string
	appKey  string
	baseURL string
	http    *http.Client
}

// NewInfermedicaEngine builds the adapter. When appID or appKey is empty the
// engine is disabled (Enabled()==false) and the caller MUST fall back to the mock
// rather than fabricate clinical output.
func NewInfermedicaEngine(appID, appKey string) *InfermedicaEngine {
	return &InfermedicaEngine{
		appID:   appID,
		appKey:  appKey,
		baseURL: infermedicaBaseURL,
		http:    &http.Client{Timeout: infermedicaTimeout},
	}
}

// Enabled reports whether credentials are configured.
func (e *InfermedicaEngine) Enabled() bool { return e.appID != "" && e.appKey != "" }

// Name identifies the provider for engine_ref/audit.
func (e *InfermedicaEngine) Name() string { return "infermedica" }

// --- wire shapes (de-identified) ---

type infEvidence struct {
	ID       string `json:"id"`
	ChoiceID string `json:"choice_id"`
	Source   string `json:"source,omitempty"`
}

type infRequest struct {
	Sex      string        `json:"sex"`
	Age      infAge        `json:"age"`
	Evidence []infEvidence `json:"evidence"`
	// Extras carry the region as a structured flag (e.g. malaria-endemic), never an
	// address — keeps the request de-identified (SC-7).
	Extras map[string]any `json:"extras,omitempty"`
}

type infAge struct {
	Value int    `json:"value"`
	Unit  string `json:"unit"`
}

// infDiagnosisResponse is the subset of /diagnosis we consume.
type infDiagnosisResponse struct {
	Question *struct {
		Type  string `json:"type"`
		Text  string `json:"text"`
		Items []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Choices []struct {
				ID    string `json:"id"`
				Label string `json:"label"`
			} `json:"choices"`
		} `json:"items"`
	} `json:"question"`
	Conditions []struct {
		ID          string  `json:"id"`
		Name        string  `json:"name"`
		Probability float64 `json:"probability"`
	} `json:"conditions"`
	ShouldStop bool `json:"should_stop"`
}

// infTriageResponse is the subset of /triage we consume (5-level).
type infTriageResponse struct {
	TriageLevel string `json:"triage_level"` // emergency_ambulance | emergency | consultation_24 | consultation | self_care
	RootCause   string `json:"root_cause,omitempty"`
}

// Triage runs /diagnosis (to advance the interview / collect conditions) and, when
// the interview is complete, /triage (for the 5-level disposition). It returns the
// next adaptive question while the interview continues (Done=false), else the
// mapped disposition + possible causes (Done=true).
func (e *InfermedicaEngine) Triage(ctx context.Context, in triage.EngineInput) (triage.EngineResult, error) {
	if !e.Enabled() {
		return triage.EngineResult{}, fmt.Errorf("core: infermedica engine not configured")
	}

	body := infRequest{
		Sex:      normalizeSex(in.Sex),
		Age:      infAge{Value: clampAge(in.AgeYears), Unit: "year"},
		Evidence: toInfEvidence(in.Evidence),
	}
	if in.Region != "" {
		// Region rides as a structured extra (e.g. endemic risk), not free text PII.
		body.Extras = map[string]any{"region": in.Region}
	}

	// 1) /diagnosis — adaptive interview + candidate conditions.
	var diag infDiagnosisResponse
	if err := e.post(ctx, "/diagnosis", body, &diag); err != nil {
		return triage.EngineResult{}, err
	}

	conditions := make([]triage.PossibleCause, 0, len(diag.Conditions))
	for _, c := range diag.Conditions {
		// Framed as POSSIBLE CAUSES, never a diagnosis (SC-1).
		conditions = append(conditions, triage.PossibleCause{Label: c.Name, Probability: c.Probability})
	}

	// Interview not complete → return the next question, stay interviewing.
	if !diag.ShouldStop && diag.Question != nil && len(diag.Question.Items) > 0 {
		item := diag.Question.Items[0]
		opts := make([]string, 0, len(item.Choices))
		for _, ch := range item.Choices {
			opts = append(opts, ch.Label)
		}
		return triage.EngineResult{
			Conditions: conditions,
			Questions:  []triage.Question{{Code: item.ID, Text: diag.Question.Text, Options: opts}},
			Done:       false,
			EngineRef:  e.Name(),
		}, nil
	}

	// 2) /triage — 5-level disposition once the interview is complete.
	var tri infTriageResponse
	if err := e.post(ctx, "/triage", body, &tri); err != nil {
		return triage.EngineResult{}, err
	}
	level := mapTriageLevel(tri.TriageLevel)

	return triage.EngineResult{
		Conditions: conditions,
		Level:      level,
		Code:       dispositionCodeFor(level),
		Done:       true,
		EngineRef:  e.Name(),
	}, nil
}

func (e *InfermedicaEngine) post(ctx context.Context, path string, reqBody any, out any) error {
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("core: infermedica marshal %s: %w", path, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("core: infermedica build %s: %w", path, err)
	}
	// Credentials ONLY on outbound headers — never logged, never returned.
	req.Header.Set("App-Id", e.appID)
	req.Header.Set("App-Key", e.appKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := e.http.Do(req)
	if err != nil {
		return fmt.Errorf("core: infermedica %s request: %w", path, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("core: infermedica %s read: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("core: infermedica %s status %d: %s", path, resp.StatusCode, string(raw))
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("core: infermedica %s decode: %w", path, err)
	}
	return nil
}

// --- mapping helpers ---

// mapTriageLevel maps Infermedica's 5-level triage string to our 5-level scale.
// Conservative on the unknown case: favour the safer (more urgent) consult (SC-3).
func mapTriageLevel(s string) int {
	switch s {
	case "emergency_ambulance":
		return triage.LevelEmergencyAmbulance
	case "emergency":
		return triage.LevelEmergencyUrgent
	case "consultation_24":
		return triage.LevelConsult24h
	case "consultation":
		return triage.LevelConsult
	case "self_care":
		return triage.LevelSelfCare
	default:
		// Unknown → conservative: route to a consult rather than self-care (SC-3).
		return triage.LevelConsult
	}
}

func toInfEvidence(ev []triage.Evidence) []infEvidence {
	out := make([]infEvidence, 0, len(ev))
	for _, e := range ev {
		if e.Code == "" {
			continue
		}
		out = append(out, infEvidence{ID: e.Code, ChoiceID: choiceForValue(e.Value), Source: "predefined"})
	}
	return out
}

func choiceForValue(v string) string {
	switch v {
	case "present", "absent", "unknown":
		return v
	case "":
		return "present"
	default:
		return v
	}
}

func normalizeSex(s string) string {
	switch s {
	case "male", "m", "M":
		return "male"
	case "female", "f", "F":
		return "female"
	default:
		// Infermedica requires male|female; default conservatively to female so
		// maternal red-flags are never silently disabled (SC-9). The deterministic
		// red-flag layer still runs regardless.
		return "female"
	}
}

func clampAge(years int) int {
	if years < 0 {
		return 0
	}
	if years > 130 {
		return 130
	}
	return years
}
