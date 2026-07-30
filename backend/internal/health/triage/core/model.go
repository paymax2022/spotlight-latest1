// Package core is the Paymax AI Symptom Checker orchestration — TRIAGE &
// NAVIGATION ONLY, never diagnosis (SC-1). It wires the licensed clinical engine
// (Infermedica) behind triage.EngineProvider, an LLM evidence extractor
// (triage.EvidenceExtractor, SC-10 extraction-only), and a deterministic
// RED-FLAG safety layer that ALWAYS overrides toward higher urgency
// (triage.RedFlagEngine + triage.ApplyRedFlag, SC-2/SC-3). Every state
// transition and disposition is immutably audited (SC-12). The engine is fed a
// DE-IDENTIFIED input only — age band + sex + region + structured evidence, never
// name/PII (SC-7).
//
// This package depends on the shared contract package
// spotlight/backend/internal/health/triage (imported as `triage`) and redefines
// nothing already declared there (Disposition levels, Evidence, EngineProvider,
// EvidenceExtractor, RedFlagEngine, ApplyRedFlag, the SessionState machine +
// CanSession, MockEngine/MockExtractor/DefaultRedFlagEngine).
package core

import (
	"time"

	"spotlight/backend/internal/health/triage"
)

// Session mirrors public.health_triage_sessions. disposition_level is 1..5
// (1=emergency .. 5=self-care); it is the PROJECTION of the assessment + the
// always-overriding red-flag layer, never a diagnosis (SC-1).
type Session struct {
	ID               string     `json:"id"`
	UserID           string     `json:"user_id"`
	ProfileID        *string    `json:"profile_id,omitempty"`
	State            string     `json:"state"`
	Language         string     `json:"language"`
	Channel          string     `json:"channel"`
	ConsentID        *string    `json:"consent_id,omitempty"`
	DispositionLevel *int       `json:"disposition_level,omitempty"`
	DispositionCode  *string    `json:"disposition_code,omitempty"`
	EngineRef        *string    `json:"engine_ref,omitempty"`
	RedFlag          bool       `json:"red_flag"`
	StartedAt        time.Time  `json:"started_at"`
	AssessedAt       *time.Time `json:"assessed_at,omitempty"`
	ClosedAt         *time.Time `json:"closed_at,omitempty"`
	IdempotencyKey   *string    `json:"-"`
	CreatedAt        time.Time  `json:"created_at"`
}

// Profile mirrors public.health_triage_profiles. The DOB is the only birth
// detail held; the engine is given an age band + sex only (SC-7 minimisation).
type Profile struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	Kind       string     `json:"kind"` // self | child | dependant
	Name       string     `json:"name,omitempty"`
	DOB        *time.Time `json:"dob,omitempty"`
	Sex        string     `json:"sex,omitempty"`
	IsPregnant bool       `json:"is_pregnant"`
	CreatedAt  time.Time  `json:"created_at"`
}

// Consent mirrors public.health_triage_consents (immutable; SC-7 NDPA).
type Consent struct {
	ID        string         `json:"id"`
	UserID    string         `json:"user_id"`
	ProfileID *string        `json:"profile_id,omitempty"`
	Scope     map[string]any `json:"scope"`
	GrantedAt time.Time      `json:"granted_at"`
}

// Intake mirrors public.health_triage_intake — raw symptom text / body-map per
// channel. Raw text is the ONLY place free text is held; it never reaches the
// engine (SC-7/SC-10): the LLM extracts structured evidence from it first.
type Intake struct {
	ID        string         `json:"id"`
	SessionID string         `json:"session_id"`
	RawText   string         `json:"raw_text,omitempty"`
	Language  string         `json:"language,omitempty"`
	BodyMap   map[string]any `json:"body_map,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

// EvidenceRow mirrors public.health_triage_evidence — an immutable structured
// fact consumed by the engine. It NEVER carries a clinical conclusion (SC-10).
type EvidenceRow struct {
	ID        string    `json:"id"`
	SessionID string    `json:"session_id"`
	Kind      string    `json:"kind"`   // symptom | risk_factor | answer
	Code      string    `json:"code"`   // engine concept id
	Value     string    `json:"value"`  // present | absent | unknown / answer value
	Source    string    `json:"source"` // user | nlu | engine | region
	CreatedAt time.Time `json:"created_at"`
}

// toEvidence converts a persisted row into the contract Evidence the engine and
// red-flag layer consume.
func (e EvidenceRow) toEvidence() triage.Evidence {
	return triage.Evidence{Kind: e.Kind, Code: e.Code, Value: e.Value, Source: e.Source}
}

// Assessment mirrors public.health_triage_assessments. conditions are POSSIBLE
// CAUSES (label + probability), never a diagnosis (SC-1). disposition_level is
// 1..5 and reflects the red-flag-overridden level.
type Assessment struct {
	ID               string                 `json:"id"`
	SessionID        string                 `json:"session_id"`
	Conditions       []triage.PossibleCause `json:"conditions"`
	DispositionLevel int                    `json:"disposition_level"`
	DispositionCode  string                 `json:"disposition_code"`
	EnginePayload    map[string]any         `json:"engine_payload,omitempty"`
	RedFlagTriggered bool                   `json:"red_flag_triggered"`
	RuleID           *string                `json:"rule_id,omitempty"`
	Source           string                 `json:"source"` // engine | red_flag | fallback
	CreatedAt        time.Time              `json:"created_at"`
}

// SessionView is the read model returned by GetSession. It frames the assessment
// as POSSIBLE CAUSES (never "diagnosis", SC-1) and always carries the mandatory
// medical disclaimer (SC-8) plus the care route for the level (§6).
type SessionView struct {
	Session        Session                `json:"session"`
	PossibleCauses []triage.PossibleCause `json:"possible_causes"`
	Disposition    *Disposition           `json:"disposition,omitempty"`
	NextQuestion   *triage.Question       `json:"next_question,omitempty"`
	Disclaimer     string                 `json:"disclaimer"`
}

// Disposition is the navigation outcome — level + plain-language guidance + the
// care-loop route. It is explicitly NOT a diagnosis (SC-1).
type Disposition struct {
	Level    int    `json:"level"` // 1..5
	Code     string `json:"code"`
	Route    string `json:"route"`    // emergency | telemed | self_care
	RedFlag  bool   `json:"red_flag"` // forced up by the deterministic layer (SC-2)
	Guidance string `json:"guidance"`
}

// Disclaimer is the mandatory medical disclaimer surfaced on every result (SC-8).
// It reinforces SC-1 framing: triage/navigation, possible causes, not a diagnosis.
const Disclaimer = "This is triage and navigation guidance, not a medical diagnosis. " +
	"It suggests possible causes and a next step only. " +
	"If this is an emergency, seek emergency care or call an ambulance immediately. " +
	"Always confirm with a licensed clinician."

// dispositionCodeFor returns the stable disposition code for a level. (The parent
// package's dispositionCode is unexported, so core keeps its own copy in sync.)
func dispositionCodeFor(level int) string {
	switch level {
	case triage.LevelEmergencyAmbulance:
		return "emergency_ambulance"
	case triage.LevelEmergencyUrgent:
		return "emergency_urgent"
	case triage.LevelConsult24h:
		return "consult_24h"
	case triage.LevelConsult:
		return "consult"
	default:
		return "self_care"
	}
}

// guidanceForLevel returns conservative plain-language next-step copy per level.
// Framed as guidance toward care (SC-1), never as a diagnosis or a prescription.
func guidanceForLevel(level int) string {
	switch level {
	case triage.LevelEmergencyAmbulance:
		return "This may be an emergency. Call an ambulance and go to the nearest emergency facility now."
	case triage.LevelEmergencyUrgent:
		return "Go now to the nearest health facility, or start an urgent telemedicine consult."
	case triage.LevelConsult24h:
		return "See a clinician within 24 hours — book a telemedicine or pharmacist consult."
	case triage.LevelConsult:
		return "Book a routine consult with a doctor or pharmacist; a lab test may help."
	default:
		return "Home care and over-the-counter guidance may help. We will check in on you to follow up."
	}
}
