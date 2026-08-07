// Package governance is the CLINICAL GOVERNANCE + VALIDATION + WHATSAPP layer of
// the Paymax AI Symptom Checker. It owns the clinician-governed lifecycle of
// clinical content + red-flag rules (SC-6 licensed-clinician sign-off before
// publish), the DB-backed red-flag engine that LAYERS OVER the deterministic
// default (urgency-only, SC-2), the shadow-mode validation harness (emergency
// sensitivity first, SC-11), and the omnichannel WhatsApp entrypoint (SC-8
// disclaimer + one-tap emergency on every reply). Everything is versioned and
// auditable to public.audit_logs / module 'health.triage.gov' (SC-12).
//
// It NEVER edits the protected core triage package — it imports the parent
// `triage` package for the shared contracts (ContentState SM, Evidence,
// RedFlagEngine, RedFlagHit, EngineProvider, levels, DefaultRedFlagEngine) and
// injects DBRedFlagEngine into the core service.
package governance

import (
	"time"

	"spotlight/backend/internal/health/triage"
)

// ContentItem is a clinician-governed clinical content row (RAG library entry,
// disclaimer, first-aid, self-care guidance, interview question copy). SC-10:
// content is CURATED, never LLM-generated. Lifecycle is governed by
// triage.ContentState (draft→clinical_review→approved→published→deprecated) and
// publish requires a licensed-clinician sign-off (reviewer_id + published_at).
type ContentItem struct {
	ID          string              `json:"id"`
	Code        string              `json:"code"`
	Kind        string              `json:"kind"` // condition|first_aid|disclaimer|self_care|question
	Language    string              `json:"language"`
	Body        string              `json:"body"`
	RAGTags     []string            `json:"rag_tags"`
	State       triage.ContentState `json:"state"`
	Version     int                 `json:"version"`
	ReviewerID  *string             `json:"reviewer_id,omitempty"`
	CreatedBy   string              `json:"created_by,omitempty"` // author (maker); the approver must differ (SC-011)
	PublishedAt *time.Time          `json:"published_at,omitempty"`
	CreatedAt   time.Time           `json:"created_at"`
}

// RedFlagRule is a deterministic, clinician-authored emergency rule. SC-2: a rule
// can ONLY RAISE urgency (force the disposition to a more-urgent / lower level);
// it can never lower it. SC-6: a rule must pass licensed-clinician sign-off before
// it is published and becomes live in DBRedFlagEngine. The condition jsonb is an
// evidence-match expression (see redflag_db.go for the evaluator).
type RedFlagRule struct {
	ID           string              `json:"id"`
	Code         string              `json:"code"`
	Name         string              `json:"name"`
	Condition    RuleCondition       `json:"condition"`
	UrgencyLevel int                 `json:"urgency_level"` // force disposition to (≤) this level
	Severity     string              `json:"severity"`      // emergency|urgent
	State        triage.ContentState `json:"state"`
	Version      int                 `json:"version"`
	ReviewerID   *string             `json:"reviewer_id,omitempty"`
	CreatedBy    string              `json:"created_by,omitempty"` // author (maker); the approver must differ (SC-011)
	PublishedAt  *time.Time          `json:"published_at,omitempty"`
	CreatedAt    time.Time           `json:"created_at"`
}

// RuleCondition is the evidence-match expression stored in red_flag_rules.condition.
// A rule fires when ALL of AllPresent are present AND NONE of NonePresent are
// present, optionally gated on pregnancy / age band. Conservative by design:
// an empty/unknown condition never fires (fail-closed → no spurious override).
type RuleCondition struct {
	AllPresent      []string `json:"all_present,omitempty"`  // every code must be value=present
	AnyPresent      []string `json:"any_present,omitempty"`  // at least one code present
	NonePresent     []string `json:"none_present,omitempty"` // none of these may be present
	RequirePregnant bool     `json:"require_pregnant,omitempty"`
	MaxAgeYears     *int     `json:"max_age_years,omitempty"` // rule only applies at/below this age
	MinAgeYears     *int     `json:"min_age_years,omitempty"`
}

// Vignette is an African clinical test case for the validation harness. The engine
// is run over its evidence and the result is compared to expected_level /
// expected_emergency (SC-11 emergency-sensitivity-first shadow eval).
type Vignette struct {
	ID                 string            `json:"id"`
	Code               string            `json:"code"`
	Language           string            `json:"language"`
	Evidence           []triage.Evidence `json:"evidence"`
	ExpectedLevel      int               `json:"expected_level"`
	ExpectedEmergency  bool              `json:"expected_emergency"`
	ExpectedConditions []string          `json:"expected_conditions"`
	AgeYears           int               `json:"age_years"`
	Sex                string            `json:"sex"`
	Region             string            `json:"region"`
	CreatedAt          time.Time         `json:"created_at"`
}

// EvalRun is one persisted shadow-eval observation: how the engine scored a single
// vignette on a given run.
type EvalRun struct {
	ID               string    `json:"id"`
	VignetteID       string    `json:"vignette_id"`
	EngineLevel      int       `json:"engine_level"`
	LevelMatch       bool      `json:"level_match"`
	EmergencyCorrect bool      `json:"emergency_correct"`
	RanAt            time.Time `json:"ran_at"`
}

// LanguagePack is a supported language for the symptom checker (Phase 1: EN +
// Nigerian Pidgin 'pcm').
type LanguagePack struct {
	ID     string `json:"id"`
	Code   string `json:"code"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

// ChannelSession maps an external omnichannel id (e.g. a WhatsApp wa_id) to an
// internal triage session id, enabling idempotent inbound webhook handling.
type ChannelSession struct {
	ID         string    `json:"id"`
	Channel    string    `json:"channel"`
	ExternalID string    `json:"external_id"`
	SessionID  *string   `json:"session_id,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}
