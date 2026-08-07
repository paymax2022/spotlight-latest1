// Package tutor is the Spotlight Academy Phase-4 tutor-marketplace sub-package:
// tutors onboard, get KYC-verified, are assigned to learners/classes, grade work,
// accrue earnings, and withdraw via guarded, idempotent payouts.
//
// GOLDEN RULES enforced here (docs/prd/edtech screens.md §T, paymax-rails.md
// "payouts", conventions.md):
//   - Tutor capability is GATED by KYC: VerifyTutor requires the injected KYCChecker
//     to report tier >= 1 (fail-closed; nil checker → allow in dev).
//   - Payout state machine is GUARDED: requested → paid | failed. Illegal transitions
//     are rejected with a stable code AND written to the immutable audit log.
//   - Payouts are IDEMPOTENT on academy_tutor_payouts.idempotency_key (unique partial
//     index): a replayed request returns the SAME payout with ONE PayoutRail call.
//   - The actual value movement is delegated to the INJECTED PayoutRail (adapter, not
//     vendor SDK leak). This module only flips LOCAL payout state once the rail confirms.
//   - Earnings are APPEND-ONLY entries; the withdrawable balance is DERIVED as
//     SUM(pending earnings) — never a stored shadow balance.
//   - Everything mutating is written to public.audit_logs (module 'academy.tutor').
//
// Tables owned: academy_tutors, academy_tutor_assignments, academy_tutor_grades,
// academy_tutor_earnings, academy_tutor_payouts.
package tutor

import "time"

// Money is always integer MINOR UNITS (kobo). Never floats (conventions.md).

// ── Tutor ───────────────────────────────────────────────────────────────────────

// TutorStatus mirrors academy_tutors.status CHECK ('pending','verified','suspended').
type TutorStatus string

const (
	TutorPending   TutorStatus = "pending"
	TutorVerified  TutorStatus = "verified"
	TutorSuspended TutorStatus = "suspended"
)

// Tutor is one academy_tutors row.
type Tutor struct {
	ID               string      `json:"id"`
	UserID           string      `json:"user_id"`
	Bio              *string     `json:"bio,omitempty"`
	Subjects         []string    `json:"subjects"`
	Rating           float64     `json:"rating"`
	ReviewCount      int         `json:"review_count"`
	Status           TutorStatus `json:"status"`
	KYCState         string      `json:"kyc_state"`
	PayoutAccountRef *string     `json:"payout_account_ref,omitempty"`
	CreatedAt        time.Time   `json:"created_at"`
}

// ── Assignment ───────────────────────────────────────────────────────────────────

// Assignment kinds mirror academy_tutor_assignments.kind CHECK.
const (
	KindLesson     = "lesson"
	KindHomework   = "homework"
	KindAssessment = "assessment"
)

// Assignment is one academy_tutor_assignments row. Either ClassGroupID or LearnerID
// (or both) may be set; the assignment targets a class cohort and/or a single learner.
type Assignment struct {
	ID           string     `json:"id"`
	TutorID      string     `json:"tutor_id"`
	ClassGroupID *string    `json:"class_group_id,omitempty"`
	LearnerID    *string    `json:"learner_id,omitempty"`
	Kind         string     `json:"kind"` // lesson | homework | assessment
	ContentRef   *string    `json:"content_ref,omitempty"`
	Title        string     `json:"title"`
	DueAt        *time.Time `json:"due_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

// ── Grade ────────────────────────────────────────────────────────────────────────

// GradeState mirrors academy_tutor_grades.state CHECK ('pending','graded').
type GradeState string

const (
	GradePending GradeState = "pending"
	GradeGraded  GradeState = "graded"
)

// Grade is one academy_tutor_grades row.
type Grade struct {
	ID           string     `json:"id"`
	AssignmentID string     `json:"assignment_id"`
	LearnerID    string     `json:"learner_id"`
	Score        *float64   `json:"score,omitempty"`
	Feedback     *string    `json:"feedback,omitempty"`
	State        GradeState `json:"state"`
	CreatedAt    time.Time  `json:"created_at"`
	GradedAt     *time.Time `json:"graded_at,omitempty"`
}

// ── Earning (append-only; balance DERIVED) ────────────────────────────────────────

// Earning sources mirror academy_tutor_earnings.source CHECK ('consult','class','assignment').
const (
	SourceConsult    = "consult"
	SourceClass      = "class"
	SourceAssignment = "assignment"
)

// EarningState mirrors academy_tutor_earnings.state CHECK ('pending','paid','reversed').
type EarningState string

const (
	EarningPending  EarningState = "pending"
	EarningPaid     EarningState = "paid"
	EarningReversed EarningState = "reversed"
)

// Earning is one academy_tutor_earnings row. Rows are APPEND-ONLY (no UPDATE/DELETE of
// amounts); the withdrawable balance is DERIVED as SUM(amount_minor) WHERE state='pending'.
type Earning struct {
	ID          string       `json:"id"`
	TutorID     string       `json:"tutor_id"`
	Source      string       `json:"source"` // consult | class | assignment
	RefID       *string      `json:"ref_id,omitempty"`
	AmountMinor int64        `json:"amount_minor"`
	State       EarningState `json:"state"`
	LedgerRef   *string      `json:"ledger_ref,omitempty"`
	CreatedAt   time.Time    `json:"created_at"`
}

// ── Payout (guarded SM; money via rail; idempotent) ──────────────────────────────

// PayoutState mirrors academy_tutor_payouts.state CHECK ('requested','paid','failed').
type PayoutState string

const (
	PayoutRequested PayoutState = "requested"
	PayoutPaid      PayoutState = "paid"
	PayoutFailed    PayoutState = "failed"
)

// Payout is one academy_tutor_payouts row. The local SM is guarded
// requested → paid | failed; the actual disbursement is delegated to the PayoutRail.
type Payout struct {
	ID             string      `json:"id"`
	TutorID        string      `json:"tutor_id"`
	AmountMinor    int64       `json:"amount_minor"`
	State          PayoutState `json:"state"`
	PayoutRef      *string     `json:"payout_ref,omitempty"`
	IdempotencyKey *string     `json:"-"`
	CreatedAt      time.Time   `json:"created_at"`
	DecidedAt      *time.Time  `json:"decided_at,omitempty"`
}

// ── Aggregate views ──────────────────────────────────────────────────────────────

// Earnings is the member earnings dashboard: append-only entries plus the DERIVED
// withdrawable (pending) balance.
type Earnings struct {
	Entries      []Earning `json:"entries"`
	PendingMinor int64     `json:"pending_minor"` // derived = SUM(pending)
	Payouts      []Payout  `json:"payouts"`
}

// Cohort is a class group the tutor teaches, derived from the tutor's assignments
// (distinct class_group_id). AssignmentCount is how many of the tutor's assignments
// target that cohort. There is no standalone cohort table — this is a read-only
// projection over academy_tutor_assignments.
type Cohort struct {
	ClassGroupID    string `json:"class_group_id"`
	AssignmentCount int    `json:"assignment_count"`
}

// ── Request DTOs ─────────────────────────────────────────────────────────────────

// OnboardRequest — member POST /tutor/onboard.
type OnboardRequest struct {
	Bio      string   `json:"bio"`
	Subjects []string `json:"subjects"`
}

// AssignRequest — member POST /tutor/assignments.
type AssignRequest struct {
	ClassGroupID string `json:"class_group_id"`
	LearnerID    string `json:"learner_id"`
	Kind         string `json:"kind"` // lesson | homework | assessment (default homework)
	Title        string `json:"title" binding:"required"`
	ContentRef   string `json:"content_ref"`
	DueAt        string `json:"due_at"` // RFC3339, optional
}

// GradeRequest — member POST /tutor/grades.
type GradeRequest struct {
	AssignmentID string   `json:"assignment_id" binding:"required"`
	LearnerID    string   `json:"learner_id" binding:"required"`
	Score        *float64 `json:"score,omitempty"`
	Feedback     string   `json:"feedback"`
	// EarnMinor optionally accrues an assignment earning when the work is graded.
	EarnMinor int64 `json:"earn_minor,omitempty"`
}

// PayoutRequest — member POST /tutor/payouts.
type PayoutRequest struct {
	AmountMinor int64 `json:"amount_minor" binding:"required"`
}

// PayoutResult is the response from a payout request (or its idempotent replay).
type PayoutResult struct {
	Payout   *Payout `json:"payout"`
	Ref      string  `json:"ref,omitempty"`
	Replayed bool    `json:"replayed"` // true when this was an idempotent replay
}
