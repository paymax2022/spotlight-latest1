// Package connectassess implements Paymax Connect Phase 6F — Skill Assessments
// (SA-01…04, ADM-SA-01). A SkillAssessment is a THIN WRAPPER over the reused Naija
// Driver quiz engine (backend/internal/arena/quiz): it maps (domain, title,
// pass_threshold) onto a quiz bank identified by (bank_key, rubric_version) and
// delegates ALL question storage + marking + append-only attempt recording to that
// engine. This package OWNS only the Connect catalogue + the append-only badge
// ledger (connect_skill_assessments / connect_skill_badges).
//
// Invariants enforced here:
//   - PN-5  — a skill badge is issued ONLY after a passed, timestamped attempt
//     tied to a specific schema version (see Service.Submit: badge insert
//     lives strictly inside the `passed` branch).
//   - PN-12 — a badge PERMANENTLY records the assessment_version it was earned
//     against; a new question-bank version is a new Assessment row (new
//     rubric_version), so old badges never silently change meaning.
package connectassess

import (
	"context"
	"errors"
	"time"
)

// Domain errors (mapped to HTTP status by the handler).
var (
	ErrNotFound     = errors.New("connect: assessment not found")
	ErrInvalidInput = errors.New("connect: invalid input")
	ErrMissingIdem  = errors.New("connect: Idempotency-Key required")
	ErrInactive     = errors.New("connect: assessment is not active")
)

// CooldownDuration is the wait after a FAILED attempt before a retry may START
// (SA-04). Derived from the last recorded attempt's timestamp.
const CooldownDuration = 24 * time.Hour

// SingleStage: skill assessments are single-stage quizzes over the reused engine
// (the Naija Driver engine is multi-stage; a skill bank uses stage 1 only).
const SingleStage = 1

// CooldownError signals a retry is still in cooldown; carries the unlock time so
// the handler can surface a countdown (SA-04) without re-deriving it.
type CooldownError struct{ Until time.Time }

func (e *CooldownError) Error() string { return "connect: assessment retry is in cooldown" }

// Assessment maps a skill (domain,title,pass_threshold) onto a reused quiz bank
// keyed by (BankKey, Version). Version == the quiz rubric_version; it IS the
// versioned question bank a badge is bound to (PN-12).
type Assessment struct {
	ID            string    `json:"id"`
	Domain        string    `json:"domain"`
	Title         string    `json:"title"`
	BankKey       string    `json:"bankKey"`
	Version       string    `json:"assessmentVersion"` // == quiz rubric_version (PN-12)
	PassThreshold int       `json:"passThreshold"`     // percent 1..100
	Active        bool      `json:"active"`
	CreatedAt     time.Time `json:"createdAt"`
}

// Badge is one append-only, permanently versioned skill credential (PN-5/PN-12).
type Badge struct {
	ID           string    `json:"id"`
	UserID       string    `json:"userId"`
	AssessmentID string    `json:"assessmentId"`
	Domain       string    `json:"domain"`
	Version      string    `json:"assessmentVersion"` // frozen at issue-time (PN-12)
	Score        int       `json:"score"`
	PassedAt     time.Time `json:"passedAt"`
}

// BadgeInsert is the append-only badge write DTO.
type BadgeInsert struct {
	UserID         string
	AssessmentID   string
	Version        string
	Domain         string
	Score          int
	IdempotencyKey string
}

// AttemptMeta is the read-only projection of the most-recent quiz attempt used to
// enforce the SA-04 retry cooldown (read-only reuse of arena_quiz_attempt).
type AttemptMeta struct {
	Passed    bool
	CreatedAt time.Time
}

// Answer mirrors quiz.Answer (question external id + chosen option index) for the
// submit payload, keeping this package's HTTP surface decoupled from the engine's.
type Answer struct {
	QuestionID string `json:"questionId"`
	OptionID   string `json:"optionId"`
}

// UpsertInput is the admin catalogue write (ADM-SA-01, versioned CRUD). A new
// Version yields a NEW assessment (never mutates an issued badge's meaning).
type UpsertInput struct {
	Domain        string `json:"domain" binding:"required"`
	Title         string `json:"title" binding:"required"`
	BankKey       string `json:"bankKey" binding:"required"`
	Version       string `json:"assessmentVersion" binding:"required"`
	PassThreshold int    `json:"passThreshold"`
	Active        *bool  `json:"active"`
}

// GradeResult is the SA-03 submit outcome. State is the terminal grade
// PASSED | FAILED. Badge is present only on PASSED. CooldownUntil is set on FAILED.
type GradeResult struct {
	AttemptID     string     `json:"attemptId"`
	State         string     `json:"state"`
	Score         int        `json:"score"`
	Total         int        `json:"total"`
	Passed        bool       `json:"passed"`
	Badge         *Badge     `json:"badge,omitempty"`
	CooldownUntil *time.Time `json:"cooldownUntil,omitempty"`
}

// Auditor mirrors the per-package Connect audit interface.
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// LoyaltyAwarder is the loyalty rail: on a passed assessment we emit
// skill_verified ONCE per (user, assessment, version) — deduped by the badge's
// unique key, not per attempt (see §8 loyalty triggers of the PRD).
type LoyaltyAwarder interface {
	AwardFor(ctx context.Context, userID, module, trigger, ref string) error
}
