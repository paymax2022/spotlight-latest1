package feessession

import (
	"encoding/json"
	"errors"
	"time"
)

// Package feessession owns the AcademicSession and (per-school, per-session) Class
// entities of the EdTech School-Fees module. Both live here (build-spec §2 AcademicSession
// + Class; REUSE-MAP maps /internal/session/ + /internal/class/ under the fees module).
//
// Tables (migration 20260918000000_academy_fees_edtech.sql):
//   - academy_sessions      (AcademicSession; status active/closed/archived)
//   - academy_fee_classes    (Class; class_teacher_user_id, session_id, level)
//
// No money moves here. Session status is a GUARDED transition (never a raw UPDATE …
// SET status=) via the in-package pure state machine (statemachine.go).

// SessionStatus mirrors academy_sessions.status CHECK (active/closed/archived).
type SessionStatus string

const (
	SessionActive   SessionStatus = "active"
	SessionClosed   SessionStatus = "closed"
	SessionArchived SessionStatus = "archived"
)

// AcademicSession mirrors public.academy_sessions (e.g. "2026/2027", 3-term).
type AcademicSession struct {
	ID            string          `json:"id"`
	SchoolID      string          `json:"schoolId"`
	Name          string          `json:"name"`
	TermStructure json.RawMessage `json:"termStructure"`
	StartDate     *time.Time      `json:"startDate,omitempty"`
	EndDate       *time.Time      `json:"endDate,omitempty"`
	Status        SessionStatus   `json:"status"`
	CreatedAt     time.Time       `json:"createdAt"`
}

// Class mirrors public.academy_fee_classes (per-school, optionally per-session).
type Class struct {
	ID                 string    `json:"id"`
	SchoolID           string    `json:"schoolId"`
	SessionID          *string   `json:"sessionId,omitempty"`
	Name               string    `json:"name"`
	Level              *string   `json:"level,omitempty"`
	ClassTeacherUserID *string   `json:"classTeacherUserId,omitempty"`
	CreatedAt          time.Time `json:"createdAt"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// CreateSessionRequest opens an academic session for a school.
type CreateSessionRequest struct {
	Name          string          `json:"name" binding:"required"`
	TermStructure json.RawMessage `json:"termStructure"`
	StartDate     string          `json:"startDate"` // YYYY-MM-DD
	EndDate       string          `json:"endDate"`   // YYYY-MM-DD
}

// UpdateSessionStatusRequest drives the session status machine (active→closed→archived).
type UpdateSessionStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

// CreateClassRequest opens a class within a school (and optionally a session).
type CreateClassRequest struct {
	SessionID          string `json:"sessionId"`
	Name               string `json:"name" binding:"required"`
	Level              string `json:"level"`
	ClassTeacherUserID string `json:"classTeacherUserId"`
}

// UpdateClassRequest edits a class's descriptive fields / teacher assignment.
type UpdateClassRequest struct {
	Name               string `json:"name"`
	Level              string `json:"level"`
	ClassTeacherUserID string `json:"classTeacherUserId"`
}

// ── Sentinel errors ─────────────────────────────────────────────────────────────

var (
	ErrNotFound        = errors.New("not_found")
	ErrForbidden       = errors.New("forbidden")
	ErrUnauthenticated = errors.New("unauthenticated")
	ErrMissingName     = errors.New("missing_name")
	ErrInvalidDate     = errors.New("invalid_date")
	// ErrIllegalTransition / ErrInvalidStatus guard the session status machine.
	ErrIllegalTransition = errors.New("illegal_transition")
	ErrInvalidStatus     = errors.New("invalid_status")
	// ErrSchoolMismatch guards that a class's session belongs to the same school.
	ErrSchoolMismatch = errors.New("school_mismatch")
)
