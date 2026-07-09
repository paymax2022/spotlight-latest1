package feespromotion

import (
	"errors"
	"time"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// Package feespromotion owns the end-of-session Promotion engine of the EdTech
// School-Fees module (build-spec §3.3, invariant SF-3 — a RELEASE BLOCKER).
//
// It builds against public.academy_promotion_records + public.academy_students +
// public.academy_fee_classes + public.academy_fee_schedules (migration
// 20260918000000_academy_fees_edtech.sql) and REUSES the pure guard logic in
// feesstatemachine (promotion.go). No promotion state is ever written with a raw
// UPDATE … SET state=; every state change goes through PromotionTransition.
//
// Lifecycle (the ONLY legal path — see feesstatemachine/promotion.go):
//
//	session_active     → results_finalized   (all required scores present)
//	results_finalized  → promotion_computed  (engine PROPOSES a decision — never auto-applies)
//	promotion_computed → promotion_reviewed  (teacher_approval, approver #1)
//	promotion_reviewed → promotion_approved  (admin_approval, approver #2)
//	promotion_approved → applied             (rollover: Class + FeeSchedule reassignment)
//
// SF-3 (release blocker): there is NO path from promotion_computed straight to
// `applied`, and none from promotion_reviewed to `applied`. The ONLY predecessor
// of `applied` is promotion_approved, reached only after TWO distinct human
// approvals. Enforcement is layered:
//   1. the pure state machine (feesstatemachine) has no such edge — an illegal
//      jump returns ErrApprovalRequired;
//   2. this service additionally asserts BOTH approver columns are set (and are
//      DISTINCT identities) before it will fire EvAdminApply;
//   3. the DB CHECK academy_promotion_records_two_approvals_check is the backstop.
// No money moves here; every state change is audit-logged (module 'academy.fees').

// State is a thin alias of the shared promotion state so callers of this package
// need not import feesstatemachine directly.
type State = feesstatemachine.PromotionState

// Re-export the promotion states for ergonomic use within the package + tests.
const (
	StateSessionActive    = feesstatemachine.PromotionSessionActive
	StateResultsFinalized = feesstatemachine.PromotionResultsFinalized
	StateComputed         = feesstatemachine.PromotionComputed
	StateReviewed         = feesstatemachine.PromotionReviewed
	StateApproved         = feesstatemachine.PromotionApproved
	StateApplied          = feesstatemachine.PromotionApplied
)

// Decision mirrors academy_promotion_records.decision CHECK.
type Decision string

const (
	DecisionPromoted    Decision = "promoted"
	DecisionRepeated    Decision = "repeated"
	DecisionConditional Decision = "conditional"
)

func validDecision(d Decision) bool {
	switch d {
	case DecisionPromoted, DecisionRepeated, DecisionConditional:
		return true
	default:
		return false
	}
}

// StudentStatus mirrors academy_students.status CHECK (the subset the rollover sets).
type StudentStatus string

const (
	StudentActive   StudentStatus = "active"
	StudentPromoted StudentStatus = "promoted"
	StudentRepeated StudentStatus = "repeated"
)

// PromotionRecord mirrors public.academy_promotion_records.
type PromotionRecord struct {
	ID                string     `json:"id"`
	StudentID         string     `json:"studentId"`
	FromClassID       *string    `json:"fromClassId,omitempty"`
	ToClassID         *string    `json:"toClassId,omitempty"`
	SessionID         *string    `json:"sessionId,omitempty"`
	ExamScore         *float64   `json:"examScore,omitempty"`
	Decision          *Decision  `json:"decision,omitempty"`
	State             State      `json:"state"`
	TeacherApprovedBy *string    `json:"teacherApprovedBy,omitempty"`
	TeacherApprovedAt *time.Time `json:"teacherApprovedAt,omitempty"`
	AdminApprovedBy   *string    `json:"adminApprovedBy,omitempty"`
	AdminApprovedAt   *time.Time `json:"adminApprovedAt,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
}

// Student mirrors the subset of public.academy_students the rollover reassigns.
type Student struct {
	ID       string        `json:"id"`
	SchoolID string        `json:"schoolId"`
	ClassID  *string       `json:"classId,omitempty"`
	Status   StudentStatus `json:"status"`
}

// ── Score import ─────────────────────────────────────────────────────────────

// StudentScore is one per-student exam score for a class+session.
type StudentScore struct {
	StudentID string  `json:"studentId"`
	Score     float64 `json:"score"`
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

// ImportScoresRequest carries per-student exam scores for a class+session. When
// every required (rostered) student has a score, the class rolls session_active →
// results_finalized. This is the ONLY input that finalizes results.
type ImportScoresRequest struct {
	SchoolID  string         `json:"schoolId" binding:"required"`
	ClassID   string         `json:"classId" binding:"required"`
	SessionID string         `json:"sessionId" binding:"required"`
	Scores    []StudentScore `json:"scores" binding:"required"`
}

// ComputeRequest proposes promotion decisions for a finalized class. It carries the
// school's own configurable pass-mark policy and the destination class for promoted
// students. The engine PROPOSES only (results_finalized → promotion_computed); it
// NEVER applies (SF-3).
type ComputeRequest struct {
	SchoolID string `json:"schoolId" binding:"required"`
	// PassMark is the school's configurable threshold: score >= PassMark ⇒ promoted.
	PassMark float64 `json:"passMark"`
	// ConditionalFloor (optional): PassMark > score >= ConditionalFloor ⇒ conditional;
	// below ConditionalFloor ⇒ repeated. If <= 0, there is no conditional band and
	// any score below PassMark ⇒ repeated.
	ConditionalFloor float64 `json:"conditionalFloor"`
	// ToClassID is the destination class assigned to promoted/conditional students.
	ToClassID string `json:"toClassId" binding:"required"`
}

// ApproveRequest carries the approving actor for a single approval step.
type ApproveRequest struct {
	// ApproverID is the human granting this approval (teacher or admin). Server-side
	// this is taken from the authenticated user, never the request body, but the DTO
	// documents the semantic.
	ApproverID string `json:"approverId"`
}

// ── Sentinel errors ──────────────────────────────────────────────────────────

var (
	ErrNotFound        = errors.New("not_found")
	ErrForbidden       = errors.New("forbidden")
	ErrUnauthenticated = errors.New("unauthenticated")
	ErrInvalidInput    = errors.New("invalid_input")
	ErrSchoolMismatch  = errors.New("school_mismatch")
	// ErrScoresIncomplete: not every rostered student has a score, so results cannot
	// be finalized (session_active → results_finalized is refused).
	ErrScoresIncomplete = errors.New("scores_incomplete")
	// ErrInvalidDecision: a computed decision is not one of promoted/repeated/conditional.
	ErrInvalidDecision = errors.New("invalid_decision")

	// ── SF-3 guards (re-exported so callers/tests use one identity) ──────────────

	// ErrApprovalRequired is the SF-3 signal, forwarded from feesstatemachine: an
	// attempt to reach `applied` (or otherwise advance) without the required human
	// approval event granted in order. THE bypass-detection error.
	ErrApprovalRequired = feesstatemachine.ErrApprovalRequired
	// ErrIllegalTransition / ErrTerminal forwarded from feesstatemachine.
	ErrIllegalTransition = feesstatemachine.ErrIllegalTransition
	ErrTerminal          = feesstatemachine.ErrTerminal
	// ErrApproversMustDiffer enforces the stronger SF-3 reading: the teacher approval
	// and the admin approval MUST be two DISTINCT human identities. A single person
	// cannot satisfy both approvals.
	ErrApproversMustDiffer = errors.New("approvers_must_differ")
	// ErrApprovalsIncomplete is the belt-and-braces service assertion fired at apply
	// time: even though the state machine already forbids reaching this point without
	// both approvals, apply additionally verifies BOTH approver columns are non-empty
	// (defence in depth for SF-3). It should be structurally unreachable.
	ErrApprovalsIncomplete = errors.New("approvals_incomplete")
)
