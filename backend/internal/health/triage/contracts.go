// Package triage is the Paymax AI Symptom Checker — TRIAGE & NAVIGATION ONLY,
// never diagnosis (SC-1). Architecture: licence the clinical engine, own the edge.
// A deterministic RED-FLAG layer can ALWAYS override the engine toward higher
// urgency (SC-2/SC-3). The LLM only maps free text → structured evidence, never
// medical conclusions (SC-10). This file is the shared contract every triage
// sub-service builds against.
package triage

import (
	"context"
	"strings"
)

const (
	keyMock             = "mock"
	keyPresent          = "present"
	codeSFever          = "s_fever"
	codeSChestPain      = "s_chest_pain"
	codeSBreathlessness = "s_breathlessness"
	codeSBleeding       = "s_bleeding"
	codeSUnconscious    = "s_unconscious"
	codeSConvulsion     = "s_convulsion"
	codeSDiarrhea       = "s_diarrhea"
)

// ── 5-level disposition (1 = most urgent). Conservative: ambiguity favours safety. ──
const (
	LevelEmergencyAmbulance = 1 // call ambulance + nearest ER + first-aid
	LevelEmergencyUrgent    = 2 // go now to nearest facility / urgent telemed
	LevelConsult24h         = 3 // see a clinician within 24h (telemed/pharmacist)
	LevelConsult            = 4 // routine consult (book doctor/pharmacist/lab)
	LevelSelfCare           = 5 // home care + OTC guidance + follow-up
)

// SafeLevel normalizes a disposition level to a valid 1..5 band, failing SAFE
// (TR-007 / SC-3): any out-of-range level — 0/unset, negative, or above self-care
// (garbage/uncertain engine output) — is clamped to a conservative clinician
// consult rather than silently routing to self-care. Valid levels pass through.
func SafeLevel(level int) int {
	if level < LevelEmergencyAmbulance || level > LevelSelfCare {
		return LevelConsult // when in doubt, route to a clinician — never self-care
	}
	return level
}

// RouteForLevel maps a disposition level to the care-loop route (§6).
func RouteForLevel(level int) string {
	switch level {
	case LevelEmergencyAmbulance, LevelEmergencyUrgent:
		return "emergency"
	case LevelConsult24h, LevelConsult:
		return "telemed"
	default:
		return "self_care"
	}
}

// Evidence is a structured, engine-consumable fact. NEVER free-text conclusions.
type Evidence struct {
	Kind   string `json:"kind"`   // symptom | risk_factor | answer
	Code   string `json:"code"`   // engine concept id (e.g. s_21)
	Value  string `json:"value"`  // present | absent | unknown
	Source string `json:"source"` // user | nlu | engine | region
}

// PossibleCause is a ranked candidate — framed as a possibility, NOT a diagnosis (SC-1).
type PossibleCause struct {
	Label       string  `json:"label"`
	Probability float64 `json:"probability"`
}

// Question is the next adaptive interview question from the engine.
type Question struct {
	Code    string   `json:"code"`
	Text    string   `json:"text"`
	Options []string `json:"options,omitempty"`
}

// EngineInput is de-identified (SC-7): age band + sex + evidence + coarse region only.
type EngineInput struct {
	AgeYears int        `json:"age_years"`
	Sex      string     `json:"sex"`
	Region   string     `json:"region"` // for endemic risk auto-set (e.g. malaria)
	Evidence []Evidence `json:"evidence"`
}

// EngineResult is the engine's triage output (5-level), plus next questions.
type EngineResult struct {
	Conditions []PossibleCause `json:"conditions"`
	Level      int             `json:"level"`
	Code       string          `json:"code"`
	Questions  []Question      `json:"questions"`
	Done       bool            `json:"done"` // interview complete
	EngineRef  string          `json:"engine_ref"`
}

// EngineProvider is the licensed clinical reasoning engine (Infermedica/Ada) behind
// a provider-agnostic interface; a deterministic mock runs in dev/CI. It triages
// only — it never prescribes/diagnoses (SC-4).
type EngineProvider interface {
	Name() string
	Triage(ctx context.Context, in EngineInput) (EngineResult, error)
}

// EvidenceExtractor maps free-text/voice (EN/Pidgin/…) → structured Evidence using
// an LLM. SC-10: extraction only; it must NOT produce clinical conclusions.
type EvidenceExtractor interface {
	Extract(ctx context.Context, text, language string) ([]Evidence, error)
}

// RedFlagHit is a deterministic emergency-rule match that overrides the engine.
type RedFlagHit struct {
	RuleID   string         `json:"rule_id"`
	Level    int            `json:"level"`    // forced (≤) disposition level
	Severity string         `json:"severity"` // emergency | urgent
	Matched  map[string]any `json:"matched"`
}

// RedFlagEngine evaluates deterministic, clinician-authored rules that can ALWAYS
// raise urgency (SC-2). Emergency detection is rules-based, never probability-only.
type RedFlagEngine interface {
	Evaluate(ctx context.Context, ev []Evidence, ageYears int, pregnant bool) (*RedFlagHit, error)
}

// ApplyRedFlag enforces SC-2/SC-3: a red-flag hit forces the disposition to the
// MORE urgent (lower) level; it never lowers urgency.
func ApplyRedFlag(engineLevel int, hit *RedFlagHit) (level int, redFlag bool) {
	if hit == nil {
		return engineLevel, false
	}
	if engineLevel == 0 || hit.Level < engineLevel {
		return hit.Level, true
	}
	return engineLevel, true
}

type SessionState string

const (
	SessStarted      SessionState = "started"
	SessConsented    SessionState = "consented"
	SessInterviewing SessionState = "interviewing"
	SessRedFlag      SessionState = "red_flag_detected"
	SessEscalated    SessionState = "escalated"
	SessAssessed     SessionState = "assessed"
	SessDisposition  SessionState = "disposition_given"
	SessReferred     SessionState = "referred"
	SessClosed       SessionState = "closed"
	SessAbandoned    SessionState = "abandoned"
)

var allowedSession = map[SessionState]map[SessionState]bool{
	SessStarted:      {SessConsented: true, SessAbandoned: true},
	SessConsented:    {SessInterviewing: true, SessAbandoned: true},
	SessInterviewing: {SessInterviewing: true, SessRedFlag: true, SessAssessed: true, SessAbandoned: true},
	SessRedFlag:      {SessEscalated: true, SessDisposition: true},
	SessEscalated:    {SessDisposition: true},
	SessAssessed:     {SessDisposition: true},
	SessDisposition:  {SessReferred: true, SessClosed: true},
	SessReferred:     {SessClosed: true},
	SessClosed:       {},
	SessAbandoned:    {},
}

// CanSession reports whether a TriageSession transition is legal.
func CanSession(from, to SessionState) bool {
	nx, ok := allowedSession[from]
	return ok && nx[to]
}

type ReferralState string

const (
	RefCreated   ReferralState = "created"
	RefRouted    ReferralState = "routed"
	RefPaid      ReferralState = "paid"
	RefFulfilled ReferralState = "fulfilled"
	RefFollowUp  ReferralState = "follow_up"
	RefClosed    ReferralState = "closed"
)

var allowedReferral = map[ReferralState]map[ReferralState]bool{
	RefCreated:   {RefRouted: true, RefClosed: true},
	RefRouted:    {RefPaid: true, RefFulfilled: true, RefClosed: true}, // emergency/self-care need no payment
	RefPaid:      {RefFulfilled: true, RefClosed: true},
	RefFulfilled: {RefFollowUp: true, RefClosed: true},
	RefFollowUp:  {RefClosed: true},
	RefClosed:    {},
}

func CanReferral(from, to ReferralState) bool { nx, ok := allowedReferral[from]; return ok && nx[to] }

type EscalationState string

const (
	EscRaised       EscalationState = "raised"
	EscNotified     EscalationState = "notified"
	EscAcknowledged EscalationState = "acknowledged"
	EscResolved     EscalationState = "resolved"
)

var allowedEscalation = map[EscalationState]map[EscalationState]bool{
	EscRaised:       {EscNotified: true},
	EscNotified:     {EscAcknowledged: true},
	EscAcknowledged: {EscResolved: true},
	EscResolved:     {},
}

func CanEscalation(from, to EscalationState) bool {
	nx, ok := allowedEscalation[from]
	return ok && nx[to]
}

// ContentState governs clinical content + red-flag rules — clinician sign-off to
// publish (SC-6). Shared by content_items and red_flag_rules.
type ContentState string

const (
	ContentDraft      ContentState = "draft"
	ContentReview     ContentState = "clinical_review"
	ContentApproved   ContentState = "approved"
	ContentPublished  ContentState = "published"
	ContentDeprecated ContentState = "deprecated"
)

var allowedContent = map[ContentState]map[ContentState]bool{
	ContentDraft:      {ContentReview: true},
	ContentReview:     {ContentApproved: true, ContentDraft: true}, // kick back
	ContentApproved:   {ContentPublished: true, ContentReview: true},
	ContentPublished:  {ContentDeprecated: true},
	ContentDeprecated: {},
}

func CanContent(from, to ContentState) bool { nx, ok := allowedContent[from]; return ok && nx[to] }

// deterministic, network-free implementations so the package runs in
// dev/CI without a licensed engine or LLM key (mock-first). The real Infermedica
// adapter + LLM extractor are wired by config when credentials are present.

// MockEngine is a deterministic stand-in for the licensed triage engine. It asks a
// couple of follow-ups then returns a conservative 5-level disposition derived from
// a simple severity heuristic. It NEVER diagnoses (SC-1) — output is possibilities.
type MockEngine struct{}

func (MockEngine) Name() string { return keyMock }

func (MockEngine) Triage(_ context.Context, in EngineInput) (EngineResult, error) {
	symptoms := 0
	severe := false
	for _, e := range in.Evidence {
		if e.Kind == "symptom" && e.Value == keyPresent {
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
			EngineRef: keyMock,
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
	if in.Region != "" && hasSymptom(in.Evidence, codeSFever) && level > LevelConsult {
		level = LevelConsult
	}
	return EngineResult{
		Conditions: []PossibleCause{{Label: "Common viral illness", Probability: 0.4}, {Label: "Malaria (consider in-region)", Probability: 0.3}},
		Level:      level,
		Code:       dispositionCode(level),
		Done:       true,
		EngineRef:  keyMock,
	}, nil
}

// MockExtractor maps free text → structured evidence via a keyword map (no LLM,
// no conclusions). The real extractor uses a constrained LLM with this as fallback.
type MockExtractor struct{}

var keywordToSymptom = map[string]string{
	"fever": codeSFever, "hot": codeSFever, "temperature": codeSFever,
	"headache": "s_headache", "cough": "s_cough", "catarrh": "s_cough",
	"chest pain": codeSChestPain, "chest dey pain": codeSChestPain,
	"breath": codeSBreathlessness, "breathing": codeSBreathlessness, "no fit breathe": codeSBreathlessness,
	"bleed": codeSBleeding, "blood": codeSBleeding,
	"unconscious": codeSUnconscious, "faint": codeSUnconscious, "no dey respond": codeSUnconscious,
	"convuls": codeSConvulsion, "seizure": codeSConvulsion,
	"vomit": "s_vomiting", "purge": codeSDiarrhea, "diarrh": codeSDiarrhea, "belle run": codeSDiarrhea,
	"weak": "s_weakness", "tired": "s_weakness", "pain": "s_pain",
}

func (MockExtractor) Extract(_ context.Context, text, _ string) ([]Evidence, error) {
	lower := strings.ToLower(text)
	seen := map[string]bool{}
	var out []Evidence
	for kw, code := range keywordToSymptom {
		if strings.Contains(lower, kw) && !seen[code] {
			seen[code] = true
			out = append(out, Evidence{Kind: "symptom", Code: code, Value: keyPresent, Source: "nlu"})
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
		if e.Value == keyPresent {
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
		return hit("rf_bleeding_high_risk", LevelEmergencyAmbulance), nil
	case present["s_fever"] && ageYears < 1:
		return hit("rf_infant_fever", LevelEmergencyUrgent), nil // SC-9 paediatric caution
	}
	return nil, nil
}

func isSevereSymptom(code string) bool {
	switch code {
	case codeSChestPain, codeSBreathlessness, codeSBleeding, codeSUnconscious, codeSConvulsion:
		return true
	}
	return false
}

func hasSymptom(ev []Evidence, code string) bool {
	for _, e := range ev {
		if e.Code == code && e.Value == keyPresent {
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
