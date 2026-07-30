// Package exam is the Spotlight Academy exam-arena + CBT sub-package: national exam
// arenas, CBT blueprints, UTME subject-combination rules, and the guarded,
// server-authoritative CBT attempt engine.
//
// GOLDEN RULES enforced here (docs/prd/edtech exam-arena.md, state-machines.md §2):
//   - Guarded CBT attempt state machine. The attempt lifecycle (created→started→
//     paused→submitted→scored→reviewed) only accepts listed transitions; illegal
//     ones are rejected with a stable code AND written to the immutable audit log.
//   - SERVER-AUTHORITATIVE timer. server_deadline = started_at + blueprint.total_seconds;
//     the client countdown is cosmetic. Offline attempts reconcile against server clock.
//   - Attempt + responses are IMMUTABLE once submitted (integrity). Submit is
//     IDEMPOTENT — keyed on academy_attempts.idempotency_key (unique index).
//   - Integrity / anti-cheat signals are logged, NOT auto-punitive.
//   - Everything mutating is written to the existing public.audit_logs table.
//   - No money here (entitlement is checked via an injected interface; commerce wires later).
//
// Tables owned: academy_exam_arenas, academy_cbt_blueprints,
// academy_subject_combination_rules, academy_attempts, academy_responses.
package exam

import "time"

// ── Exam attempt lifecycle ─────────────────────────────────────────────────────

// AttemptState mirrors academy_attempts.state CHECK.
type AttemptState string

const (
	AttemptCreated   AttemptState = "created"
	AttemptStarted   AttemptState = "started"
	AttemptPaused    AttemptState = "paused"
	AttemptSubmitted AttemptState = "submitted"
	AttemptScored    AttemptState = "scored"
	AttemptReviewed  AttemptState = "reviewed"
)

// validAttemptState reports whether s is a known attempt state.
func validAttemptState(s AttemptState) bool {
	switch s {
	case AttemptCreated, AttemptStarted, AttemptPaused, AttemptSubmitted, AttemptScored, AttemptReviewed:
		return true
	default:
		return false
	}
}

// ── Exam arena (academy_exam_arenas) ───────────────────────────────────────────

// ArenaStatus mirrors academy_exam_arenas.status CHECK.
type ArenaStatus string

const (
	ArenaDraft    ArenaStatus = "draft"
	ArenaActive   ArenaStatus = "active"
	ArenaArchived ArenaStatus = "archived"
)

// Arena is one academy_exam_arenas row. code ∈ {CCE,BECE,WASSCE,NECO,UTME,NABTEB}.
type Arena struct {
	ID           string         `json:"id"`
	Code         string         `json:"code"`
	Name         string         `json:"name"`
	SubjectSet   []string       `json:"subject_set"`
	ScoringRules map[string]any `json:"scoring_rules"` // jsonb; scale/grade-band config
	Calendar     map[string]any `json:"calendar"`      // jsonb
	CountdownAt  *time.Time     `json:"countdown_at,omitempty"`
	Status       ArenaStatus    `json:"status"`
}

// ── CBT blueprint (academy_cbt_blueprints) ──────────────────────────────────────

// BlueprintVariant mirrors academy_cbt_blueprints.variant CHECK.
type BlueprintVariant string

const (
	VariantFull   BlueprintVariant = "full"
	VariantSingle BlueprintVariant = "single"
	VariantDrill  BlueprintVariant = "drill"
)

// PausePolicy mirrors academy_cbt_blueprints.pause_policy CHECK.
type PausePolicy string

const (
	PauseNone    PausePolicy = "none"
	PauseAllowed PausePolicy = "allowed"
)

// CBTBlueprint is one academy_cbt_blueprints row. total_seconds drives the
// server-authoritative timer.
type CBTBlueprint struct {
	ID           string           `json:"id"`
	ArenaID      string           `json:"arena_id"`
	Name         string           `json:"name"`
	Variant      BlueprintVariant `json:"variant"`
	Sections     []any            `json:"sections"` // jsonb array
	TotalItems   int              `json:"total_items"`
	TotalSeconds int              `json:"total_seconds"` // server timer budget
	Navigation   map[string]any   `json:"navigation"`    // jsonb
	Tools        map[string]any   `json:"tools"`         // jsonb (calculator/none)
	Shuffle      bool             `json:"shuffle"`
	PausePolicy  PausePolicy      `json:"pause_policy"`
	Status       string           `json:"status"`
}

// ── Subject-combination rule (academy_subject_combination_rules) ────────────────

// SubjectCombinationRule maps an intended course → required subject set + guidance.
type SubjectCombinationRule struct {
	ID               string   `json:"id"`
	ArenaID          string   `json:"arena_id"`
	Course           string   `json:"course"`
	RequiredSubjects []string `json:"required_subjects"`
	Guidance         *string  `json:"guidance,omitempty"`
}

// ── Attempt (academy_attempts) ──────────────────────────────────────────────────

// Attempt is one academy_attempts row.
type Attempt struct {
	ID             string         `json:"id"`
	UserID         string         `json:"user_id"`
	BlueprintID    string         `json:"blueprint_id"`
	ArenaID        *string        `json:"arena_id,omitempty"`
	State          AttemptState   `json:"state"`
	StartedAt      *time.Time     `json:"started_at,omitempty"`
	ServerDeadline *time.Time     `json:"server_deadline,omitempty"` // server-authoritative
	PausedAt       *time.Time     `json:"paused_at,omitempty"`
	SubmittedAt    *time.Time     `json:"submitted_at,omitempty"`
	Score          map[string]any `json:"score"` // jsonb; per-subject + overall
	Readiness      *float64       `json:"readiness,omitempty"`
	Predicted      map[string]any `json:"predicted"` // jsonb
	Integrity      map[string]any `json:"integrity"` // jsonb; anti-cheat signals (logged, not punitive)
	OfflineOrigin  bool           `json:"offline_origin"`
	IdempotencyKey *string        `json:"idempotency_key,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
}

// ── Response (academy_responses) ────────────────────────────────────────────────

// Response is one academy_responses row. Immutable once the attempt is submitted.
type Response struct {
	ID             string         `json:"id"`
	AttemptID      string         `json:"attempt_id"`
	QuestionItemID string         `json:"question_item_id"`
	Selected       map[string]any `json:"selected"` // jsonb
	Correct        *bool          `json:"correct,omitempty"`
	TimeMS         int            `json:"time_ms"`
	Flagged        bool           `json:"flagged"`
	CreatedAt      time.Time      `json:"created_at"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// BeginAttemptRequest — member POST /exam/attempts.
type BeginAttemptRequest struct {
	BlueprintID   string `json:"blueprint_id" binding:"required"`
	OfflineOrigin bool   `json:"offline_origin,omitempty"`
}

// SubmitAttemptRequest — member POST /exam/attempts/:id/submit. Carries the full
// frozen response set plus optional integrity signals.
type SubmitAttemptRequest struct {
	Responses []ResponseInput `json:"responses"`
	Integrity map[string]any  `json:"integrity,omitempty"`
}

// ResponseInput is one learner answer in a submission.
type ResponseInput struct {
	QuestionItemID string         `json:"question_item_id" binding:"required"`
	Selected       map[string]any `json:"selected"`
	TimeMS         int            `json:"time_ms,omitempty"`
	Flagged        bool           `json:"flagged,omitempty"`
}

// CreateArenaRequest — admin POST /exam/arenas.
type CreateArenaRequest struct {
	Code         string         `json:"code" binding:"required"`
	Name         string         `json:"name" binding:"required"`
	SubjectSet   []string       `json:"subject_set,omitempty"`
	ScoringRules map[string]any `json:"scoring_rules,omitempty"`
	Calendar     map[string]any `json:"calendar,omitempty"`
	CountdownAt  *time.Time     `json:"countdown_at,omitempty"`
}

// UpdateArenaRequest — admin PUT /exam/arenas/:id (partial).
type UpdateArenaRequest struct {
	Name         *string        `json:"name,omitempty"`
	SubjectSet   []string       `json:"subject_set,omitempty"`
	ScoringRules map[string]any `json:"scoring_rules,omitempty"`
	Calendar     map[string]any `json:"calendar,omitempty"`
	CountdownAt  *time.Time     `json:"countdown_at,omitempty"`
	Status       *string        `json:"status,omitempty"`
}

// CreateBlueprintRequest — admin POST /exam/arenas/:id/blueprints.
type CreateBlueprintRequest struct {
	Name         string         `json:"name" binding:"required"`
	Variant      string         `json:"variant,omitempty"`
	Sections     []any          `json:"sections,omitempty"`
	TotalItems   int            `json:"total_items,omitempty"`
	TotalSeconds int            `json:"total_seconds" binding:"required"`
	Navigation   map[string]any `json:"navigation,omitempty"`
	Tools        map[string]any `json:"tools,omitempty"`
	Shuffle      *bool          `json:"shuffle,omitempty"`
	PausePolicy  string         `json:"pause_policy,omitempty"`
}

// UpdateBlueprintRequest — admin PUT /exam/blueprints/:id (partial).
type UpdateBlueprintRequest struct {
	Name         *string        `json:"name,omitempty"`
	Variant      *string        `json:"variant,omitempty"`
	Sections     []any          `json:"sections,omitempty"`
	TotalItems   *int           `json:"total_items,omitempty"`
	TotalSeconds *int           `json:"total_seconds,omitempty"`
	Navigation   map[string]any `json:"navigation,omitempty"`
	Tools        map[string]any `json:"tools,omitempty"`
	Shuffle      *bool          `json:"shuffle,omitempty"`
	PausePolicy  *string        `json:"pause_policy,omitempty"`
	Status       *string        `json:"status,omitempty"`
}

// CombinationRequest — admin POST/PUT subject-combination rule.
type CombinationRequest struct {
	ArenaID          string   `json:"arena_id" binding:"required"`
	Course           string   `json:"course" binding:"required"`
	RequiredSubjects []string `json:"required_subjects,omitempty"`
	Guidance         *string  `json:"guidance,omitempty"`
}

// ── Result DTOs ─────────────────────────────────────────────────────────────────

// SubjectScore is the per-subject scoring breakdown.
type SubjectScore struct {
	Subject string  `json:"subject"`
	Raw     int     `json:"raw"`    // correct count
	Total   int     `json:"total"`  // items in subject
	Scaled  float64 `json:"scaled"` // scaled per scoring_rules (e.g. /100 of the 400 scale)
	Grade   string  `json:"grade,omitempty"`
}

// Result is the pure scoring output (per-subject + overall + readiness + predicted).
type Result struct {
	Subjects  []SubjectScore `json:"subjects"`
	Overall   float64        `json:"overall"` // UTME 400-scale OR aggregate of bands
	Grade     string         `json:"grade,omitempty"`
	Readiness float64        `json:"readiness"` // coverage × mastery × mock
	Predicted map[string]any `json:"predicted"`
	Late      bool           `json:"late"` // submitted after server_deadline
}
