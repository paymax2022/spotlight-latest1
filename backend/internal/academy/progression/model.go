// Package progression is the Spotlight Academy Phase-2 adaptive-progression
// sub-package: per-learner LEARNING PATHS built from a subject's ordered
// curriculum objectives, ADAPTIVE PRACTICE selection from mastery gaps, and
// next-best-objective RECOMMENDATIONS.
//
// GOLDEN RULES enforced here (docs/prd/edtech/.../state-machines.md §1,
// curriculum.md, gamification-rewards.md):
//   - Guarded state machine. Path steps move locked → available → in_progress →
//     done; the remediation regression (done → in_progress) is the only backward
//     path. Illegal transitions are rejected with a stable code AND written to the
//     immutable audit log.
//   - Curriculum is DATA, never code. Subjects/topics/objectives are read from the
//     curriculum tables (academy_subjects → academy_topics → academy_learning_objectives);
//     nothing about a subject's structure is hardcoded.
//   - Mastery is REUSED, never duplicated. The single source of truth for a
//     learner's per-objective mastery is academy_mastery_records (owned by the
//     assessment package). This package only READS those rows to drive path/step
//     state, adaptive selection and recommendations — it never writes mastery.
//   - Progression transitions emit academy_progress_events and audit to
//     public.audit_logs (module 'academy.progression').
//
// Tables owned: academy_learning_paths, academy_path_steps,
// academy_practice_sessions, academy_recommendations, academy_adaptive_config.
package progression

import "time"

// ── Path lifecycle ──────────────────────────────────────────────────────────────

// PathState mirrors academy_learning_paths.state CHECK.
type PathState string

const (
	PathActive    PathState = "active"
	PathCompleted PathState = "completed"
)

// PathStepState mirrors academy_path_steps.state CHECK.
type PathStepState string

const (
	StepLocked     PathStepState = "locked"
	StepAvailable  PathStepState = "available"
	StepInProgress PathStepState = "in_progress"
	StepDone       PathStepState = "done"
)

// LearningPath is one academy_learning_paths row (UNIQUE user_id, subject_id).
type LearningPath struct {
	ID        string     `json:"id"`
	UserID    string     `json:"user_id"`
	ClassID   *string    `json:"class_id,omitempty"`
	SubjectID string     `json:"subject_id"`
	State     PathState  `json:"state"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	Steps     []PathStep `json:"steps,omitempty"`
}

// PathStep is one academy_path_steps row (UNIQUE path_id, objective_id). Mastery
// is merged in for the read surface (state/score read from academy_mastery_records;
// never persisted on the step).
type PathStep struct {
	ID          string        `json:"id"`
	PathID      string        `json:"path_id"`
	ObjectiveID string        `json:"objective_id"`
	Ordinal     int           `json:"ordinal"`
	State       PathStepState `json:"state"`
	UpdatedAt   time.Time     `json:"updated_at"`

	// Merged-in mastery view (read-only projection of academy_mastery_records).
	MasteryState string  `json:"mastery_state,omitempty"`
	MasteryScore float64 `json:"mastery_score,omitempty"`
}

// PracticeSession is one academy_practice_sessions row.
type PracticeSession struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Kind         string    `json:"kind"`          // adaptive | drill
	ObjectiveIDs []string  `json:"objective_ids"` // text[] of objective ids
	State        string    `json:"state"`         // created | completed
	Score        *float64  `json:"score,omitempty"`
	ItemIDs      []string  `json:"item_ids,omitempty"` // selected items (not persisted)
	CreatedAt    time.Time `json:"created_at"`
}

// Recommendation is one academy_recommendations row.
type Recommendation struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	ObjectiveID *string   `json:"objective_id,omitempty"`
	Reason      string    `json:"reason,omitempty"`
	Score       float64   `json:"score"`
	CreatedAt   time.Time `json:"created_at"`
}

// ── Curriculum / mastery read projections ──────────────────────────────────────

// Objective is the ordered curriculum read used to build a path: one
// academy_learning_objectives row joined to its topic ordering.
type Objective struct {
	ObjectiveID  string `json:"objective_id"`
	TopicID      string `json:"topic_id"`
	TopicOrdinal int    `json:"topic_ordinal"`
	ObjOrdinal   int    `json:"objective_ordinal"`
	Code         string `json:"code"`
	Title        string `json:"title"`
}

// Mastery is the read-only projection of one academy_mastery_records row used by
// the pure adaptive/recommendation selectors. The canonical record lives in the
// assessment package; this package never writes it.
type Mastery struct {
	ObjectiveID string  `json:"objective_id"`
	State       string  `json:"state"` // not_started|in_progress|practiced|mastered|exam_ready
	Score       float64 `json:"score"` // 0..1
}

// QuestionItemRef is a minimal projection of academy_question_items used by the
// pure item picker (difficulty-aware selection).
type QuestionItemRef struct {
	ID          string  `json:"id"`
	ObjectiveID string  `json:"objective_id"`
	Difficulty  float64 `json:"difficulty"` // 0..1
}

// ── Adaptive config (curriculum-as-data) ───────────────────────────────────────

// AdaptiveConfig is one academy_adaptive_config row (key/value jsonb). Known keys:
// mastery_threshold, reco_rules, path_rules.
type AdaptiveConfig struct {
	Key       string         `json:"key"`
	Value     map[string]any `json:"value"`
	UpdatedAt time.Time      `json:"updated_at"`
}

// Config keys.
const (
	CfgMasteryThreshold = "mastery_threshold"
	CfgRecoRules        = "reco_rules"
	CfgPathRules        = "path_rules"
)

// DefaultMasteryThreshold is the fallback when academy_adaptive_config has no
// mastery_threshold row. A learner whose mastery score is below this (or who has
// not reached the 'mastered' state) is "weak" on that objective.
const DefaultMasteryThreshold = 0.7

// ── Progress event types written to academy_progress_events.type ────────────────
const (
	EvtStepAvailable  = "step_available"
	EvtStepStarted    = "step_started"
	EvtStepDone       = "step_done"
	EvtStepRemediated = "step_remediated"
	EvtPathBuilt      = "path_built"
	EvtPathCompleted  = "path_completed"
)

// ── Request / response DTOs ─────────────────────────────────────────────────────

// BuildPathRequest — member POST /progression/paths.
type BuildPathRequest struct {
	SubjectID string  `json:"subject_id" binding:"required"`
	ClassID   *string `json:"class_id,omitempty"`
}

// AdaptivePracticeRequest — member POST /progression/practice/adaptive. Either a
// subject (the service pulls that subject's weak objectives) OR an explicit
// objective set may be supplied; objective_ids takes precedence when present.
type AdaptivePracticeRequest struct {
	SubjectID    string   `json:"subject_id,omitempty"`
	ObjectiveIDs []string `json:"objective_ids,omitempty"`
	Limit        int      `json:"limit,omitempty"` // max items in the session
}

// UpsertAdaptiveConfigRequest — admin PUT /progression/adaptive-config.
type UpsertAdaptiveConfigRequest struct {
	Key   string         `json:"key" binding:"required"`
	Value map[string]any `json:"value" binding:"required"`
}
