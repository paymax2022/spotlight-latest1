// Package trade is the Spotlight Academy Phase-3 trade sub-package: the learn-to-earn
// moat. Trade tracks → modules/lessons/projects → guarded project submissions and
// skill assessments → on PASS a verifiable credential is issued via an INJECTED
// CredentialIssuer (idempotent). Plus a lightweight mentor directory + matching.
//
// GOLDEN RULES enforced here (CLAUDE.md, docs/prd/edtech state-machines.md):
//   - Guarded state machines. The submission lifecycle (submitted→reviewed→passed|
//     failed) and the mentor-match lifecycle (requested→active→closed) only accept
//     listed transitions; illegal ones are rejected with a stable code AND written
//     to the immutable public.audit_logs table (module 'academy.trade').
//   - Skill-assessment PASS issues a credential through an injected interface, keyed
//     on academy_skill_attempts.idempotency_key so a replay never double-issues.
//   - Project files are signed-URL refs only (no blobs ever touch the DB/this code).
//   - No money path here.
//
// Tables owned (match supabase/migrations/20260815001200_academy_credentials_live.sql
// EXACTLY): academy_trade_modules, academy_trade_lessons, academy_trade_projects,
// academy_project_submissions, academy_skill_assessments, academy_skill_attempts,
// academy_mentors, academy_mentor_matches. academy_trade_tracks is seeded in Phase 0.
package trade

import (
	"context"
	"encoding/json"
	"time"
)

// ── Project-submission lifecycle ──────────────────────────────────────────────

// SubmissionState mirrors academy_project_submissions.state CHECK.
type SubmissionState string

const (
	SubmissionSubmitted SubmissionState = "submitted"
	SubmissionReviewed  SubmissionState = "reviewed"
	SubmissionPassed    SubmissionState = "passed"
	SubmissionFailed    SubmissionState = "failed"
)

// ── Skill-attempt lifecycle ───────────────────────────────────────────────────

// AttemptState mirrors academy_skill_attempts.state CHECK.
type AttemptState string

const (
	AttemptCreated AttemptState = "created"
	AttemptGraded  AttemptState = "graded"
)

// ── Mentor-match lifecycle ────────────────────────────────────────────────────

// MatchState mirrors academy_mentor_matches.state CHECK.
type MatchState string

const (
	MatchRequested MatchState = "requested"
	MatchActive    MatchState = "active"
	MatchClosed    MatchState = "closed"
)

// ── Domain rows ───────────────────────────────────────────────────────────────

// TradeModule is one academy_trade_modules row.
type TradeModule struct {
	ID         string `json:"id"`
	TradeTrack string `json:"trade_track"`
	Title      string `json:"title"`
	Ordinal    int    `json:"ordinal"`
	Status     string `json:"status"`
}

// TradeLesson is one academy_trade_lessons row.
type TradeLesson struct {
	ID         string  `json:"id"`
	ModuleID   string  `json:"module_id"`
	Title      string  `json:"title"`
	Type       string  `json:"type"`
	MediaRef   *string `json:"media_ref,omitempty"`
	Transcript *string `json:"transcript,omitempty"`
	Ordinal    int     `json:"ordinal"`
	Status     string  `json:"status"`
}

// TradeProject is one academy_trade_projects row.
type TradeProject struct {
	ID       string          `json:"id"`
	ModuleID string          `json:"module_id"`
	Title    string          `json:"title"`
	Rubric   json.RawMessage `json:"rubric"`
	Ordinal  int             `json:"ordinal"`
}

// ProjectSubmission is one academy_project_submissions row. files is a jsonb array of
// signed-URL refs — NEVER raw blobs.
type ProjectSubmission struct {
	ID          string          `json:"id"`
	UserID      string          `json:"user_id"`
	ProjectID   string          `json:"project_id"`
	Files       json.RawMessage `json:"files"`
	State       SubmissionState `json:"state"`
	RubricScore *float64        `json:"rubric_score,omitempty"`
	ReviewerID  *string         `json:"reviewer_id,omitempty"`
	Feedback    *string         `json:"feedback,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
	ReviewedAt  *time.Time      `json:"reviewed_at,omitempty"`
}

// SkillAssessment is one academy_skill_assessments row.
type SkillAssessment struct {
	ID              string          `json:"id"`
	TradeTrack      string          `json:"trade_track"`
	Title           string          `json:"title"`
	Rubric          json.RawMessage `json:"rubric"`
	PassThreshold   float64         `json:"pass_threshold"`
	CredentialTitle string          `json:"credential_title"`
	Status          string          `json:"status"`
}

// SkillAttempt is one academy_skill_attempts row.
type SkillAttempt struct {
	ID             string       `json:"id"`
	UserID         string       `json:"user_id"`
	AssessmentID   string       `json:"assessment_id"`
	Score          *float64     `json:"score,omitempty"`
	Passed         bool         `json:"passed"`
	State          AttemptState `json:"state"`
	CredentialID   *string      `json:"credential_id,omitempty"`
	IdempotencyKey *string      `json:"idempotency_key,omitempty"`
	CreatedAt      time.Time    `json:"created_at"`
}

// Mentor is one academy_mentors row.
type Mentor struct {
	ID         string  `json:"id"`
	UserID     string  `json:"user_id"`
	TradeTrack *string `json:"trade_track,omitempty"`
	Bio        *string `json:"bio,omitempty"`
	Status     string  `json:"status"`
}

// MentorMatch is one academy_mentor_matches row.
type MentorMatch struct {
	ID        string     `json:"id"`
	LearnerID string     `json:"learner_id"`
	MentorID  string     `json:"mentor_id"`
	State     MatchState `json:"state"`
	CreatedAt time.Time  `json:"created_at"`
}

// ── Aggregate read DTOs ───────────────────────────────────────────────────────

// ModuleWithLessons bundles a module with its ordered lessons + projects for the hub.
type ModuleWithLessons struct {
	Module   TradeModule    `json:"module"`
	Lessons  []TradeLesson  `json:"lessons"`
	Projects []TradeProject `json:"projects"`
}

// TradeHub is the learner's view of their chosen trade track.
type TradeHub struct {
	TradeTrack string              `json:"trade_track"`
	Modules    []ModuleWithLessons `json:"modules"`
}

// AttemptResult is returned from taking a skill assessment.
type AttemptResult struct {
	AttemptID    string  `json:"attempt_id"`
	AssessmentID string  `json:"assessment_id"`
	Score        float64 `json:"score"`
	Passed       bool    `json:"passed"`
	CredentialID *string `json:"credential_id,omitempty"`
}

// ── Request DTOs ──────────────────────────────────────────────────────────────

// CreateModuleRequest — admin POST /trade/modules.
type CreateModuleRequest struct {
	TradeTrack string `json:"trade_track" binding:"required"`
	Title      string `json:"title" binding:"required"`
	Ordinal    int    `json:"ordinal,omitempty"`
	Status     string `json:"status,omitempty"`
}

// UpdateModuleRequest — admin PUT /trade/modules/:id.
type UpdateModuleRequest struct {
	Title   *string `json:"title,omitempty"`
	Ordinal *int    `json:"ordinal,omitempty"`
	Status  *string `json:"status,omitempty"`
}

// CreateLessonRequest — admin POST /trade/lessons.
type CreateLessonRequest struct {
	ModuleID   string  `json:"module_id" binding:"required"`
	Title      string  `json:"title" binding:"required"`
	Type       string  `json:"type,omitempty"`
	MediaRef   *string `json:"media_ref,omitempty"`
	Transcript *string `json:"transcript,omitempty"`
	Ordinal    int     `json:"ordinal,omitempty"`
	Status     string  `json:"status,omitempty"`
}

// UpdateLessonRequest — admin PUT /trade/lessons/:id.
type UpdateLessonRequest struct {
	Title      *string `json:"title,omitempty"`
	Type       *string `json:"type,omitempty"`
	MediaRef   *string `json:"media_ref,omitempty"`
	Transcript *string `json:"transcript,omitempty"`
	Ordinal    *int    `json:"ordinal,omitempty"`
	Status     *string `json:"status,omitempty"`
}

// CreateProjectRequest — admin POST /trade/projects.
type CreateProjectRequest struct {
	ModuleID string          `json:"module_id" binding:"required"`
	Title    string          `json:"title" binding:"required"`
	Rubric   json.RawMessage `json:"rubric,omitempty"`
	Ordinal  int             `json:"ordinal,omitempty"`
}

// UpdateProjectRequest — admin PUT /trade/projects/:id.
type UpdateProjectRequest struct {
	Title   *string         `json:"title,omitempty"`
	Rubric  json.RawMessage `json:"rubric,omitempty"`
	Ordinal *int            `json:"ordinal,omitempty"`
}

// SubmitProjectRequest — member POST /trade/projects/:id/submit. files are signed-URL
// refs only (no blobs); shape is opaque to this module ({url,name,size,...}).
type SubmitProjectRequest struct {
	Files []map[string]any `json:"files" binding:"required"`
}

// ReviewSubmissionRequest — admin POST /trade/submissions/:id/review.
type ReviewSubmissionRequest struct {
	RubricScore float64 `json:"rubric_score"`
	Pass        bool    `json:"pass"`
	Feedback    string  `json:"feedback,omitempty"`
}

// CreateSkillAssessmentRequest — admin POST /trade/skill-assessments.
type CreateSkillAssessmentRequest struct {
	TradeTrack      string          `json:"trade_track" binding:"required"`
	Title           string          `json:"title" binding:"required"`
	Rubric          json.RawMessage `json:"rubric,omitempty"`
	PassThreshold   *float64        `json:"pass_threshold,omitempty"`
	CredentialTitle string          `json:"credential_title" binding:"required"`
	Status          string          `json:"status,omitempty"`
}

// UpdateSkillAssessmentRequest — admin PUT /trade/skill-assessments/:id.
type UpdateSkillAssessmentRequest struct {
	Title           *string         `json:"title,omitempty"`
	Rubric          json.RawMessage `json:"rubric,omitempty"`
	PassThreshold   *float64        `json:"pass_threshold,omitempty"`
	CredentialTitle *string         `json:"credential_title,omitempty"`
	Status          *string         `json:"status,omitempty"`
}

// TakeAssessmentRequest — member POST /trade/assessments/:id/take.
type TakeAssessmentRequest struct {
	Score float64 `json:"score"`
}

// CreateMentorRequest — admin POST /trade/mentors (mentor approval/registration).
type CreateMentorRequest struct {
	UserID     string  `json:"user_id" binding:"required"`
	TradeTrack *string `json:"trade_track,omitempty"`
	Bio        *string `json:"bio,omitempty"`
	Status     string  `json:"status,omitempty"`
}

// ── Credential issuer (injected) ──────────────────────────────────────────────

// CredentialIssuer is the boundary to the credentials package. The integration owner
// wires the real credentials issuer to this interface; trade only calls it. The
// signature is fixed by the build spec and MUST NOT change.
type CredentialIssuer interface {
	IssueTradeCredential(ctx context.Context, userID, tradeTrack, title string) (credentialID, verificationID string, err error)
}

// noopIssuer is the dev/default fallback used when no issuer is injected. It returns
// empty ids and no error so the package runs end-to-end without the credentials
// package bound.
type noopIssuer struct{}

func (noopIssuer) IssueTradeCredential(ctx context.Context, userID, tradeTrack, title string) (string, string, error) {
	return "", "", nil
}
