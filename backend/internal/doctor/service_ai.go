package doctor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"
)

// ErrAIRateLimited is returned when a doctor exceeds the configured per-minute or
// per-day AI-assist budget. The handler maps it to HTTP 429. The check runs BEFORE
// the paid GenerateJSON call so the LLM is never invoked once over limit.
var ErrAIRateLimited = errors.New("doctor: AI rate limit exceeded")

// aiRateDefaultPerMin / aiRateDefaultPerDay are the fallback limits used when the
// AIService is constructed without explicit config (NewAIService). WithRateLimits
// overrides them from config (DOCTOR_AI_RATE_PER_MIN / DOCTOR_AI_RATE_PER_DAY).
const (
	aiRateDefaultPerMin = 20
	aiRateDefaultPerDay = 200
)

// service_ai.go — Wave 5 (AI-assist) business logic.
//
// The three GENERATE endpoints (note-summary, rx-safety, lab-explanation) are
// advisory and on-demand: they call the server-side LLM and return an AiEnvelope.
// They persist NOTHING (no new table, no migration). Only ACCEPT writes — and it
// reuses the existing clinical-note write path (Service.SaveNote → InsertNote),
// so the accepted SOAP draft lands on the same doctor_clinical_notes row.
//
// SAFETY model:
//   - A CLINICAL SYSTEM PROMPT instructs the model that its output is a DRAFT for a
//     licensed clinician to review (not a diagnosis/treatment decision), to flag
//     uncertainty, to be conservative, and to output ONLY JSON in the exact schema.
//   - If the LLM is not configured, we DO NOT fabricate a medical answer — we
//     return an error-status envelope carrying the disclaimer + a clear message.
//   - Every response (ready OR error) carries the mandatory AiDisclaimer.

// aiGenerator is the dependency the AI service needs from the LLM client. Defining
// it here (consumer-side) keeps the service testable; *llm.Client satisfies it.
type aiGenerator interface {
	Enabled() bool
	GenerateJSON(ctx context.Context, systemPrompt, userPrompt string) (json.RawMessage, error)
}

// AIService implements the Wave 5 AI-assist endpoints. It composes the existing
// *Service (for the shared clinical-note write on accept) with an LLM generator.
// This is additive: NewService is unchanged.
type AIService struct {
	svc        *Service
	gen        aiGenerator
	ratePerMin int // 0 disables the per-minute window
	ratePerDay int // 0 disables the per-day window
}

// NewAIService wires the AI-assist service. gen may be a disabled *llm.Client
// (Enabled()==false) — in that case generate endpoints return a clearly-marked
// "not configured" envelope and never invent clinical content.
func NewAIService(svc *Service, gen aiGenerator) *AIService {
	return &AIService{svc: svc, gen: gen, ratePerMin: aiRateDefaultPerMin, ratePerDay: aiRateDefaultPerDay}
}

// WithRateLimits overrides the per-doctor AI rate/cost guard limits from config.
// A limit of 0 disables that window. Additive: NewAIService keeps sane defaults.
func (a *AIService) WithRateLimits(perMin, perDay int) *AIService {
	a.ratePerMin = perMin
	a.ratePerDay = perDay
	return a
}

// guardRate enforces a per-doctor fixed-window rate/cost limit BEFORE each paid
// GenerateJSON call. It uses Redis INCR + EXPIRE on minute- and day-bucketed keys:
//
//	ai:rl:<userID>:m:<unixMinute>   (TTL 70s)
//	ai:rl:<userID>:d:<unixDay>      (TTL 26h)
//
// The FIRST increment in a window sets the TTL. When the count exceeds the limit
// for either window we return ErrAIRateLimited (handler → HTTP 429) and the LLM is
// never called. If Redis is nil or errors, we FAIL OPEN (allow the call) and log —
// a limiter outage must never block clinical AI assist.
func (a *AIService) guardRate(ctx context.Context, userID string) error {
	rc := a.svc.redis
	if rc == nil {
		log.Printf("doctor ai: rate guard unavailable (redis nil) — failing open for user=%s", userID)
		return nil
	}
	now := time.Now().Unix()
	type window struct {
		key   string
		limit int
		ttl   time.Duration
	}
	windows := []window{
		{key: fmt.Sprintf("ai:rl:%s:m:%d", userID, now/60), limit: a.ratePerMin, ttl: 70 * time.Second},
		{key: fmt.Sprintf("ai:rl:%s:d:%d", userID, now/86400), limit: a.ratePerDay, ttl: 26 * time.Hour},
	}
	for _, w := range windows {
		if w.limit <= 0 {
			continue // window disabled
		}
		n, err := rc.Incr(ctx, w.key).Result()
		if err != nil {
			log.Printf("doctor ai: rate guard INCR failed (%v) — failing open for user=%s", err, userID)
			return nil // fail open
		}
		if n == 1 {
			// First hit in this window: set the expiry so the counter resets.
			if err := rc.Expire(ctx, w.key, w.ttl).Err(); err != nil {
				log.Printf("doctor ai: rate guard EXPIRE failed (%v) — counter may not reset for user=%s", err, userID)
			}
		}
		if n > int64(w.limit) {
			return ErrAIRateLimited
		}
	}
	return nil
}

// ── System prompts (clinical guardrails) ─────────────────────────────────────

const aiPromptPreamble = "You are a clinical documentation assistant embedded in a telemedicine app. " +
	"Your output is a DRAFT for a licensed clinician to review and verify — it is NOT a diagnosis, " +
	"treatment decision, or medical advice. Be conservative, avoid speculation, and explicitly flag " +
	"any uncertainty or missing information. Do not invent patient data you were not given. " +
	"Respond with ONLY a single valid JSON object matching the schema below — no prose, no markdown, no code fences."

const aiNoteSummarySchema = `{
  "subjective": string,
  "objective": string,
  "assessment": string,
  "plan": string,
  "diagnosis": string[],
  "keyPoints": string[]
}`

const aiSafetySchema = `{
  "overallSeverity": "low"|"moderate"|"high"|"critical",
  "findings": [{
    "id": string,
    "kind": "interaction"|"contraindication"|"dosage"|"duplication"|"allergy",
    "severity": "low"|"moderate"|"high"|"critical",
    "title": string,
    "detail": string,
    "drugs": string[],
    "recommendation": string
  }],
  "safeToIssue": boolean,
  "summary": string
}`

const aiLabSchema = `{
  "headline": string,
  "plainSummary": string,
  "flags": [{
    "testName": string,
    "flag": "normal"|"low"|"high",
    "meaning": string,
    "possibleCauses": string[]
  }],
  "followUps": string[]
}`

// errorEnvelope builds an AiEnvelope in the error state — ALWAYS carrying the
// disclaimer and NO output (no fabricated medical content).
func errorEnvelope(message string) *AiEnvelope {
	return &AiEnvelope{
		Status:       AiStatusError,
		Model:        AiModelLabel,
		Disclaimer:   AiDisclaimer,
		ErrorMessage: message,
	}
}

// readyEnvelope wraps a successfully-generated, parsed output.
func readyEnvelope(output interface{}) *AiEnvelope {
	now := time.Now()
	return &AiEnvelope{
		Status:      AiStatusReady,
		Model:       AiModelLabel,
		GeneratedAt: &now,
		Disclaimer:  AiDisclaimer,
		Output:      output,
	}
}

// ── 1. AI note summary (generate) ────────────────────────────────────────────

// GenerateNoteSummary produces a SOAP/visit-summary draft for a consult. It reads
// nothing it cannot access (the appointment id + any caller-supplied notes form the
// model context); it persists nothing. Returns an AiEnvelope, never an error for
// the disabled/LLM-failure cases (those become error-status envelopes so the UI can
// render them) — only a missing Idempotency-Key is a hard 400.
func (a *AIService) GenerateNoteSummary(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*AiEnvelope, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if !a.gen.Enabled() {
		return errorEnvelope(AiNotConfiguredMessage), nil
	}
	if err := a.guardRate(ctx, userID); err != nil {
		return nil, err
	}
	in := parseAiInput(raw)
	system := aiPromptPreamble + "\nProduce a SOAP-style consultation note summary. Schema:\n" + aiNoteSummarySchema
	user := fmt.Sprintf("Consultation context to summarise.\nappointmentId: %s\nnotes: %s\nstructuredContext: %s",
		derefStr(in.AppointmentID), derefStr(in.Notes), string(in.Context))

	rawJSON, err := a.gen.GenerateJSON(ctx, system, user)
	if err != nil {
		return errorEnvelope("Failed to generate note summary: " + err.Error()), nil
	}
	var out AiNoteSummaryOutput
	if err := json.Unmarshal(rawJSON, &out); err != nil {
		return errorEnvelope("AI returned an unparseable note summary."), nil
	}
	return readyEnvelope(out), nil
}

// ── 2. AI note summary (accept → persist to the clinical note) ───────────────

// AcceptNoteSummary persists the accepted (possibly edited) SOAP draft onto the
// existing clinical note row by reusing the shared SaveNote path. No new table.
func (a *AIService) AcceptNoteSummary(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*AcceptAiNoteSummaryResult, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	in := parseAiInput(raw)
	if in.AppointmentID == nil || *in.AppointmentID == "" || in.Output == nil {
		return nil, ErrInvalidAmount // package's generic 400 sentinel (handler renders 400)
	}
	out := in.Output

	// Marshal the diagnosis labels into the JSONB shape SaveNoteRequest expects.
	diagnosis, _ := json.Marshal(out.Diagnosis)

	noteReq := SaveNoteRequest{
		Subjective: &out.Subjective,
		Objective:  &out.Objective,
		Assessment: &out.Assessment,
		Plan:       &out.Plan,
		Diagnosis:  json.RawMessage(diagnosis),
		Status:     "draft", // accepted draft; clinician finalises separately
	}
	note, err := a.svc.SaveNote(ctx, userID, *in.AppointmentID, idemKey, noteReq)
	if err != nil {
		return nil, err
	}
	return &AcceptAiNoteSummaryResult{NoteID: note.ID, Accepted: true}, nil
}

// ── 3. AI prescription safety (generate, no persistence) ─────────────────────

func (a *AIService) CheckPrescriptionSafety(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*AiEnvelope, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if !a.gen.Enabled() {
		return errorEnvelope(AiNotConfiguredMessage), nil
	}
	if err := a.guardRate(ctx, userID); err != nil {
		return nil, err
	}
	in := parseAiInput(raw)
	system := aiPromptPreamble + "\nAnalyse the prescription draft for interactions, contraindications, " +
		"dosage issues, therapeutic duplication and allergy matches. Set safeToIssue=false if any critical " +
		"finding exists. Schema:\n" + aiSafetySchema
	user := fmt.Sprintf("Prescription safety check.\npatientId: %s\npetId: %s\ndrugItems: %s\npatientContext: %s",
		derefStr(in.PatientID), derefStr(in.PetID), string(in.Items), string(in.Context))

	rawJSON, err := a.gen.GenerateJSON(ctx, system, user)
	if err != nil {
		return errorEnvelope("Failed to run prescription safety check: " + err.Error()), nil
	}
	var out AiSafetyOutput
	if err := json.Unmarshal(rawJSON, &out); err != nil {
		return errorEnvelope("AI returned an unparseable safety report."), nil
	}
	return readyEnvelope(out), nil
}

// ── 4. AI lab explanation (generate, no persistence) ─────────────────────────

func (a *AIService) ExplainLabResult(ctx context.Context, userID, idemKey string, raw json.RawMessage) (*AiEnvelope, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if !a.gen.Enabled() {
		return errorEnvelope(AiNotConfiguredMessage), nil
	}
	if err := a.guardRate(ctx, userID); err != nil {
		return nil, err
	}
	in := parseAiInput(raw)

	// Best-effort: enrich the prompt with the actual lab values when a resultId is
	// supplied and readable for this doctor. A read failure is non-fatal — the model
	// can still work from any caller-supplied context (we never fabricate values).
	var values string
	if in.ResultID != nil && *in.ResultID != "" {
		if res, err := a.svc.GetLabResult(ctx, userID, *in.ResultID); err == nil && res != nil {
			if b, mErr := json.Marshal(res); mErr == nil {
				values = string(b)
			}
		}
	}

	system := aiPromptPreamble + "\nProduce a plain-language explanation of the lab result for the clinician " +
		"to share with the patient. Explain each abnormal flag and suggest follow-ups. Schema:\n" + aiLabSchema
	user := fmt.Sprintf("Lab result explanation.\nresultId: %s\nresultValues: %s\nextraContext: %s",
		derefStr(in.ResultID), values, string(in.Context))

	rawJSON, err := a.gen.GenerateJSON(ctx, system, user)
	if err != nil {
		return errorEnvelope("Failed to explain lab result: " + err.Error()), nil
	}
	var out AiLabExplanationOutput
	if err := json.Unmarshal(rawJSON, &out); err != nil {
		return errorEnvelope("AI returned an unparseable lab explanation."), nil
	}
	return readyEnvelope(out), nil
}
