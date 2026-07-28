package feesstudent

import (
	"errors"
	"time"
)

// Package feesstudent owns the Student entity + Guardian LINKING for the EdTech
// School-Fees module (build-spec §2 Student/Guardian, §4 SF-7), built against
// public.academy_students (migration 20260918000000_academy_fees_edtech.sql).
//
// GOLDEN RULE (REUSE-MAP §1 "Guardian/student identity", §5.1): this package NEVER
// creates a parallel guardian/student identity store. A guardian is an EXISTING Paymax
// identity (auth.users). One guardian identity spans all children / all schools. Links
// are recorded on academy_students.guardian_user_ids[] (the fees-domain roster link) and
// mirror the sibling academy/identity GuardianLink model — we reuse identities, we do not
// mint new ones. The Student.student_user_id / guardian_user_ids MUST reference existing
// auth.users rows; this package only records associations, it never inserts an identity.
//
// No money moves here. Every mutation is audit-logged (module 'academy.fees').

// StudentStatus mirrors academy_students.status CHECK.
type StudentStatus string

const (
	StudentActive    StudentStatus = "active"
	StudentPromoted  StudentStatus = "promoted"
	StudentRepeated  StudentStatus = "repeated"
	StudentGraduated StudentStatus = "graduated"
	StudentWithdrawn StudentStatus = "withdrawn"
)

// Student mirrors public.academy_students (per-school enrollment). Distinct from
// academy_edupay_accounts (the guardian↔payer link) — a Student MAY point at an
// edupay account via EduPayAccountID for reuse of the existing payer link.
type Student struct {
	ID              string        `json:"id"`
	SchoolID        string        `json:"schoolId"`
	ClassID         *string       `json:"classId,omitempty"`
	EduPayAccountID *string       `json:"edupayAccountId,omitempty"`
	AdmissionNumber *string       `json:"admissionNumber,omitempty"`
	StudentUserID   *string       `json:"studentUserId,omitempty"` // nullable: minors may lack their own login
	GuardianUserIDs []string      `json:"guardianUserIds"`         // existing auth.users identities
	Status          StudentStatus `json:"status"`
	MinorFlag       bool          `json:"minorFlag"`
	CreatedAt       time.Time     `json:"createdAt"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// CreateStudentRequest enrolls a student in a school. admission_number is unique per
// school (DB UNIQUE (school_id, admission_number)). guardian_user_ids, if supplied, MUST
// be existing identities — they are linked, never created.
type CreateStudentRequest struct {
	ClassID         string   `json:"classId"`
	EduPayAccountID string   `json:"edupayAccountId"`
	AdmissionNumber string   `json:"admissionNumber"`
	StudentUserID   string   `json:"studentUserId"`
	GuardianUserIDs []string `json:"guardianUserIds"`
	MinorFlag       *bool    `json:"minorFlag"` // defaults true when nil (build-spec §2)
}

// LinkGuardianRequest links an EXISTING guardian identity to a student. The guardian_user_id
// must reference an existing auth.users row (reuse — never mint a new identity).
type LinkGuardianRequest struct {
	GuardianUserID string `json:"guardianUserId" binding:"required"`
}

// ── Bulk CSV import (parse + validate → preview + approval queue) ─────────────────

// ImportRow is one parsed+validated CSV row in an import preview. Valid rows are
// eligible for approval; invalid rows carry a stable snake_case Error code and are
// rejected from the batch (never auto-imported).
type ImportRow struct {
	LineNumber      int      `json:"lineNumber"`
	AdmissionNumber string   `json:"admissionNumber"`
	ClassID         string   `json:"classId,omitempty"`
	StudentUserID   string   `json:"studentUserId,omitempty"`
	GuardianUserIDs []string `json:"guardianUserIds,omitempty"`
	MinorFlag       bool     `json:"minorFlag"`
	Valid           bool     `json:"valid"`
	Error           string   `json:"error,omitempty"` // stable snake_case code when !Valid
}

// ImportPreview is the result of parsing+validating a CSV. It is a PREVIEW only — nothing
// is written to academy_students until ApproveImport is called on the valid rows. This is
// the "rows pending until approved" approval-queue concept (build-spec §4 SF-6/SF-2 review
// discipline — human approval before mutation).
type ImportPreview struct {
	SchoolID   string      `json:"schoolId"`
	Rows       []ImportRow `json:"rows"`
	ValidCount int         `json:"validCount"`
	ErrorCount int         `json:"errorCount"`
	// DuplicateAdmissionNumbers lists admission numbers that appear more than once WITHIN
	// the uploaded batch (a batch-level collision, separate from an existing-DB collision).
	DuplicateAdmissionNumbers []string `json:"duplicateAdmissionNumbers,omitempty"`
}

// ── Sentinel errors ─────────────────────────────────────────────────────────────

var (
	ErrNotFound              = errors.New("not_found")
	ErrUnauthenticated       = errors.New("unauthenticated")
	ErrMissingSchool         = errors.New("missing_school")
	ErrMissingAdmissionNo    = errors.New("missing_admission_number")
	ErrMissingGuardian       = errors.New("missing_guardian")
	ErrGuardianAlreadyLinked = errors.New("guardian_already_linked")
	// ErrAdmissionNumberTaken is the per-school uniqueness guard: (school_id,
	// admission_number) already exists (DB UNIQUE + service pre-check).
	ErrAdmissionNumberTaken = errors.New("admission_number_taken")
	// ErrImportNotApprovable is returned when ApproveImport is asked to import rows that
	// were not part of a valid preview (guards the approval-queue contract).
	ErrImportNotApprovable = errors.New("import_not_approvable")
)
