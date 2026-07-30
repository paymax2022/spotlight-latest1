// Package assessment is the Spotlight Academy assessment sub-package: the question
// bank + the per-LearningObjective learner-progression engine.
//
// GOLDEN RULES enforced here (docs/prd/edtech state-machines.md §1, conventions.md):
//   - Guarded state machines. The question-item lifecycle (draft→review→approved→
//     retired) and the learner-progression lifecycle (not_started→in_progress→
//     practiced→mastered→exam_ready) only accept listed transitions; illegal ones
//     are rejected with a stable code AND written to the immutable audit log.
//   - Progression upgrades are score-/threshold-driven and emit a ProgressEvent.
//   - Everything mutating is written to the existing public.audit_logs table.
//   - No money here.
//
// Tables owned: academy_question_items, academy_past_questions,
// academy_mastery_records, academy_progress_events.
package assessment

import "time"

// ── Question-item lifecycle ────────────────────────────────────────────────────

// ItemStatus mirrors academy_question_items.status CHECK.
type ItemStatus string

const (
	ItemDraft    ItemStatus = "draft"
	ItemReview   ItemStatus = "review"
	ItemApproved ItemStatus = "approved"
	ItemRetired  ItemStatus = "retired"
)

// QuestionItem is one academy_question_items row.
type QuestionItem struct {
	ID             string         `json:"id"`
	Type           string         `json:"type"` // mcq, etc.
	Stem           string         `json:"stem"`
	Options        []any          `json:"options"`        // jsonb array
	Answer         map[string]any `json:"answer"`         // jsonb object; correct key(s)
	Difficulty     float64        `json:"difficulty"`     // 0..1
	Discrimination float64        `json:"discrimination"` // item-analysis passthrough
	ObjectiveID    *string        `json:"objective_id,omitempty"`
	SubjectID      *string        `json:"subject_id,omitempty"`
	Tags           []string       `json:"tags"`
	Status         ItemStatus     `json:"status"`
	CreatedBy      *string        `json:"created_by,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
}

// ── Learner progression (per LearningObjective) ────────────────────────────────

// MasteryState mirrors academy_mastery_records.state CHECK.
type MasteryState string

const (
	StateNotStarted MasteryState = "not_started"
	StateInProgress MasteryState = "in_progress"
	StatePracticed  MasteryState = "practiced"
	StateMastered   MasteryState = "mastered"
	StateExamReady  MasteryState = "exam_ready"
)

// MasteryRecord is one academy_mastery_records row (UNIQUE user_id, objective_id).
type MasteryRecord struct {
	ID          string           `json:"id"`
	UserID      string           `json:"user_id"`
	ObjectiveID string           `json:"objective_id"`
	State       MasteryState     `json:"state"`
	Score       float64          `json:"score"`
	History     []map[string]any `json:"history"`
	UpdatedAt   time.Time        `json:"updated_at"`
}

// ProgressEvent is one academy_progress_events row (append-only).
type ProgressEvent struct {
	ID          string         `json:"id"`
	UserID      string         `json:"user_id"`
	Type        string         `json:"type"`
	ObjectiveID *string        `json:"objective_id,omitempty"`
	Payload     map[string]any `json:"payload"`
	CreatedAt   time.Time      `json:"created_at"`
}

// Progression event-type constants written to academy_progress_events.type.
const (
	EvtPracticeRecorded = "practice_recorded"
	EvtPracticed        = "practiced"
	EvtMastered         = "mastered"
	EvtExamReady        = "exam_ready"
	EvtRemediated       = "remediated"
)

// ── Mastery thresholds & guards ────────────────────────────────────────────────

// MasteryThresholds parameterise the progression guards. Kept as data so a future
// curriculum/version can override them without code changes (conventions.md:
// "Curriculum is data, not code").
type MasteryThresholds struct {
	MinPracticeAttempts int     `json:"min_practice_attempts"` // in_progress → practiced
	MasteryScore        float64 `json:"mastery_score"`         // practiced  → mastered  (score ≥)
}

// DefaultThresholds are the baseline progression guards.
func DefaultThresholds() MasteryThresholds {
	return MasteryThresholds{MinPracticeAttempts: 3, MasteryScore: 0.7}
}

// ── Request DTOs ───────────────────────────────────────────────────────────────

// CreateItemRequest — admin POST /academy/question-bank/items.
type CreateItemRequest struct {
	Type           string         `json:"type"`
	Stem           string         `json:"stem" binding:"required"`
	Options        []any          `json:"options"`
	Answer         map[string]any `json:"answer"`
	Difficulty     *float64       `json:"difficulty,omitempty"`
	Discrimination *float64       `json:"discrimination,omitempty"`
	ObjectiveID    *string        `json:"objective_id,omitempty"`
	SubjectID      *string        `json:"subject_id,omitempty"`
	Tags           []string       `json:"tags,omitempty"`
}

// UpdateItemRequest — admin PUT /academy/question-bank/items/:id (content/tags only;
// status changes go through the dedicated transition endpoint).
type UpdateItemRequest struct {
	Stem           *string        `json:"stem,omitempty"`
	Options        []any          `json:"options,omitempty"`
	Answer         map[string]any `json:"answer,omitempty"`
	Difficulty     *float64       `json:"difficulty,omitempty"`
	Discrimination *float64       `json:"discrimination,omitempty"`
	ObjectiveID    *string        `json:"objective_id,omitempty"`
	SubjectID      *string        `json:"subject_id,omitempty"`
	Tags           []string       `json:"tags,omitempty"`
}

// ReviewItemRequest — admin POST /academy/question-bank/items/:id/transition.
type ReviewItemRequest struct {
	To ItemStatus `json:"to" binding:"required"` // target lifecycle state
}

// ItemFilter — list/filter query params for the bank.
type ItemFilter struct {
	SubjectID   string
	ObjectiveID string
	Status      string
	Difficulty  string // optional exact-ish band passthrough
	Tag         string
	Limit       int
	Offset      int
}

// PracticeSubmitRequest — member POST /academy/practice/submit. A learner submits
// answers for a set of approved items tied to one LearningObjective; the service
// scores them and runs the mastery state machine.
type PracticeSubmitRequest struct {
	ObjectiveID string           `json:"objective_id" binding:"required"`
	Answers     []PracticeAnswer `json:"answers" binding:"required"`
}

// PracticeAnswer is one learner answer in a practice submission.
type PracticeAnswer struct {
	QuestionItemID string         `json:"question_item_id" binding:"required"`
	Selected       map[string]any `json:"selected"`
	TimeMS         int            `json:"time_ms,omitempty"`
}

// PracticeResult is returned from a practice submission.
type PracticeResult struct {
	ObjectiveID string       `json:"objective_id"`
	Scored      int          `json:"scored"`
	Correct     int          `json:"correct"`
	Score       float64      `json:"score"` // 0..1
	FromState   MasteryState `json:"from_state"`
	ToState     MasteryState `json:"to_state"`
	Upgraded    bool         `json:"upgraded"`
}

// ItemAnalysis is the simple item-analysis read (difficulty/discrimination passthrough).
type ItemAnalysis struct {
	ItemID         string  `json:"item_id"`
	Difficulty     float64 `json:"difficulty"`
	Discrimination float64 `json:"discrimination"`
	Status         string  `json:"status"`
}
