package doctor

import (
	"encoding/json"
	"time"
)

// model_ai.go — Wave 5 (AI-assist) request & response shapes.
//
// These mirror mobile-app/reactnative/src/types/doctor.phase3.ts EXACTLY (the
// AiEnvelope<T> wrapper + the three output types). Field json tags match the TS
// property names 1:1 so the mobile client's AiNoteSummary / AiSafetyReport /
// AiLabExplanation parse without translation.
//
// SAFETY: every AI response is advisory decision-support for a licensed clinician
// — never a definitive diagnosis or treatment instruction. The disclaimer field is
// ALWAYS populated (ready OR error). When the LLM is not configured we return an
// error-status envelope with NO fabricated medical output.
//
// NONE of these are money movements. The generate endpoints persist nothing; only
// the note-summary ACCEPT writes (to the existing doctor_clinical_notes row via the
// shared SaveNote path).

// AiStatus mirrors the TS union 'idle'|'generating'|'ready'|'error'.
type AiStatus string

const (
	AiStatusIdle       AiStatus = "idle"
	AiStatusGenerating AiStatus = "generating"
	AiStatusReady      AiStatus = "ready"
	AiStatusError      AiStatus = "error"
)

// AiModelLabel is the display label echoed to the client (NOT a secret; the API
// key never appears here).
const AiModelLabel = "Spotlight Care AI (Claude)"

// AiDisclaimer is the standard, mandatory safety copy attached to EVERY AI
// response. It makes explicit that the content is AI-generated decision support
// that REQUIRES independent verification by the licensed clinician and must never
// be presented as definitive.
const AiDisclaimer = "AI-generated draft for decision support only. It is NOT a diagnosis, " +
	"treatment decision, or medical advice, and may be incomplete or incorrect. " +
	"A licensed clinician must independently review and verify every detail before acting."

// AiNotConfiguredMessage is returned (in errorMessage) when no LLM key is set. No
// medical content is fabricated in this path.
const AiNotConfiguredMessage = "AI assist is not configured on this server. No AI draft was generated."

// AiEnvelope mirrors the TS generic AiEnvelope<T>. `Output` is left as a generic
// any so a single struct serves all three endpoints; the concrete output type is
// always one of the *Output structs below.
//
// JSON tags MUST match doctor.phase3.ts: status, model, generatedAt, confidence,
// disclaimer, output, accepted, edited, errorMessage.
type AiEnvelope struct {
	Status       AiStatus    `json:"status"`
	Model        string      `json:"model"`
	GeneratedAt  *time.Time  `json:"generatedAt,omitempty"`
	Confidence   *int        `json:"confidence,omitempty"`
	Disclaimer   string      `json:"disclaimer"`
	Output       interface{} `json:"output,omitempty"`
	Accepted     bool        `json:"accepted"`
	Edited       bool        `json:"edited"`
	ErrorMessage string      `json:"errorMessage,omitempty"`
}

// ── AI output types (mirror doctor.phase3.ts) ────────────────────────────────

// AiNoteSummaryOutput mirrors the TS AiNoteSummaryOutput.
type AiNoteSummaryOutput struct {
	Subjective string   `json:"subjective"`
	Objective  string   `json:"objective"`
	Assessment string   `json:"assessment"`
	Plan       string   `json:"plan"`
	Diagnosis  []string `json:"diagnosis"`
	KeyPoints  []string `json:"keyPoints"`
}

// AiSafetyFinding mirrors the TS AiSafetyFinding.
type AiSafetyFinding struct {
	ID             string   `json:"id"`
	Kind           string   `json:"kind"`     // interaction|contraindication|dosage|duplication|allergy
	Severity       string   `json:"severity"` // low|moderate|high|critical
	Title          string   `json:"title"`
	Detail         string   `json:"detail"`
	Drugs          []string `json:"drugs"`
	Recommendation string   `json:"recommendation"`
}

// AiSafetyOutput mirrors the TS AiSafetyOutput.
type AiSafetyOutput struct {
	OverallSeverity string            `json:"overallSeverity"`
	Findings        []AiSafetyFinding `json:"findings"`
	SafeToIssue     bool              `json:"safeToIssue"`
	Summary         string            `json:"summary"`
}

// AiLabFlagExplanation mirrors the TS AiLabFlagExplanation.
type AiLabFlagExplanation struct {
	TestName       string   `json:"testName"`
	Flag           string   `json:"flag"` // normal|low|high
	Meaning        string   `json:"meaning"`
	PossibleCauses []string `json:"possibleCauses"`
}

// AiLabExplanationOutput mirrors the TS AiLabExplanationOutput.
type AiLabExplanationOutput struct {
	Headline     string                 `json:"headline"`
	PlainSummary string                 `json:"plainSummary"`
	Flags        []AiLabFlagExplanation `json:"flags"`
	FollowUps    []string               `json:"followUps"`
}

// ── Accept (persists to the existing clinical note) ──────────────────────────

// AcceptAiNoteSummaryResult mirrors the TS AcceptAiNoteSummaryResult.
type AcceptAiNoteSummaryResult struct {
	NoteID   string `json:"noteId"`
	Accepted bool   `json:"accepted"`
}

// aiInput carries the typed knobs the AI generate/accept endpoints pull out of the
// free-form request body. Kept separate from opsPatch / clinicalPatch so nothing
// shared is touched.
type aiInput struct {
	AppointmentID *string             `json:"appointmentId,omitempty"`
	ResultID      *string             `json:"resultId,omitempty"`
	PatientID     *string             `json:"patientId,omitempty"`
	PetID         *string             `json:"petId,omitempty"`
	Items         json.RawMessage     `json:"items,omitempty"`   // PrescriptionDrugItem[]
	Notes         *string             `json:"notes,omitempty"`   // optional consult context
	Context       json.RawMessage     `json:"context,omitempty"` // optional structured context
	Edited        bool                `json:"edited,omitempty"`
	Output        *AiNoteSummaryOutput `json:"output,omitempty"` // accepted (possibly edited) draft
}

func parseAiInput(raw json.RawMessage) aiInput {
	var in aiInput
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &in)
	}
	return in
}
