// Package compliance is the telemedicine admin surface for clinician compliance:
// licence-expiry tracking, suspend / reinstate, the compliance audit log,
// mandatory training, quality scores and read-only access-log viewers.
//
// Suspension state lives on doctor_profiles.verification ('suspended') — the
// value the doctor module and the mobile app read — and is mirrored onto
// doctors.is_available / is_online so a suspended clinician drops off the
// patient-facing list and cannot be booked. Migration
// 20271099000090_telemedicine_suspension_guard.sql stops the clinician turning
// availability back on while suspended.
package compliance

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var (
	ErrValidation     = errors.New("compliance: invalid request")
	ErrNotFound       = errors.New("compliance: clinician not found")
	ErrNoProfile      = errors.New("compliance: clinician has no doctor profile to suspend")
	ErrNotApproved    = errors.New("compliance: only an approved clinician can be suspended")
	ErrNotSuspended   = errors.New("compliance: clinician is not suspended")
	ErrLicenceExpired = errors.New("compliance: licence has expired — renew verification before reinstating")
	ErrNoApproval     = errors.New("compliance: no approved verification on record")
)

const (
	StatusApproved  = "approved"
	StatusSuspended = "suspended"

	ActionSuspend   = "doctor.admin.suspended"
	ActionReinstate = "doctor.admin.reinstated"
	ActionAuto      = "doctor.mdcn.licence.auto_suspended"

	minReason = 5
	maxReason = 500

	defaultLimit = 50
	maxLimit     = 200
)

type Summary struct {
	LicencesExpired     int `json:"licences_expired"`
	LicencesExpiring30d int `json:"licences_expiring_30d"`
	LicencesExpiring90d int `json:"licences_expiring_90d"`
	Suspended           int `json:"suspended"`
	TrainingPending     int `json:"training_pending"`
	TrainingCompleted   int `json:"training_completed"`
	AuditEvents7d       int `json:"audit_events_7d"`
}

type LicenceRow struct {
	UserID        string  `json:"user_id"`
	DoctorID      *string `json:"doctor_id"`
	Name          string  `json:"name"`
	Specialty     string  `json:"specialty"`
	MDCNNumber    *string `json:"mdcn_number"`
	LicenceExpiry string  `json:"licence_expiry"`
	DaysToExpiry  int     `json:"days_to_expiry"`
	Bucket        string  `json:"bucket"`
	ProfileStatus string  `json:"profile_status"`
}

type SuspendedClinician struct {
	UserID         string     `json:"user_id"`
	DoctorID       *string    `json:"doctor_id"`
	Name           string     `json:"name"`
	Specialty      string     `json:"specialty"`
	MDCNNumber     *string    `json:"mdcn_number"`
	LicenceExpiry  *string    `json:"licence_expiry"`
	LicenceExpired bool       `json:"licence_expired"`
	SuspendedAt    *time.Time `json:"suspended_at"`
	SuspendedBy    *string    `json:"suspended_by"`
	Reason         *string    `json:"reason"`
}

type StatusChange struct {
	UserID  string `json:"user_id"`
	Status  string `json:"status"`
	AuditID string `json:"audit_id"`
}

type AuditEvent struct {
	ID         string          `json:"id"`
	UserID     string          `json:"user_id"`
	UserName   *string         `json:"user_name"`
	Action     string          `json:"action"`
	EntityType *string         `json:"entity_type"`
	EntityID   *string         `json:"entity_id"`
	Detail     json.RawMessage `json:"detail"`
	CreatedAt  time.Time       `json:"created_at"`
}

type TrainingRow struct {
	ID          string     `json:"id"`
	UserID      string     `json:"user_id"`
	UserName    *string    `json:"user_name"`
	ModuleID    string     `json:"module_id"`
	Title       *string    `json:"title"`
	Status      string     `json:"status"`
	CompletedAt *time.Time `json:"completed_at"`
	AgeDays     int        `json:"age_days"`
}

type QualityRow struct {
	UserID      string    `json:"user_id"`
	UserName    *string   `json:"user_name"`
	Score       float64   `json:"score"`
	PeriodLabel *string   `json:"period_label"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type RecordAccessRow struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	UserName   *string   `json:"user_name"`
	PatientRef *string   `json:"patient_ref"`
	Action     string    `json:"action"`
	CreatedAt  time.Time `json:"created_at"`
}

type DocAccessRow struct {
	ID         string    `json:"id"`
	DocID      string    `json:"doc_id"`
	AccessorID string    `json:"accessor_id"`
	Basis      string    `json:"basis"`
	AccessedAt time.Time `json:"accessed_at"`
}

type Page[T any] struct {
	Items []T `json:"items"`
	Total int `json:"total"`
}

// Bucket classifies a licence by days to expiry. Negative = already expired.
func Bucket(days int) string {
	switch {
	case days < 0:
		return "expired"
	case days <= 30:
		return "30d"
	case days <= 90:
		return "90d"
	default:
		return "later"
	}
}

// ValidReason trims and bounds a suspend/reinstate justification.
func ValidReason(s string) (string, error) {
	r := strings.TrimSpace(s)
	if len([]rune(r)) < minReason || len([]rune(r)) > maxReason {
		return "", ErrValidation
	}
	return r, nil
}

// CanSuspend reports why a clinician in the given profile status cannot be suspended.
func CanSuspend(profileStatus string) error {
	if profileStatus != StatusApproved {
		return ErrNotApproved
	}
	return nil
}

// CanReinstate applies the reinstatement rules: must be suspended, must hold an
// approved verification, and the licence on it must not be expired.
func CanReinstate(profileStatus string, hasApproval bool, licenceExpiry *time.Time, today time.Time) error {
	if profileStatus != StatusSuspended {
		return ErrNotSuspended
	}
	if !hasApproval {
		return ErrNoApproval
	}
	if licenceExpiry != nil && licenceExpiry.Before(truncDay(today)) {
		return ErrLicenceExpired
	}
	return nil
}

func truncDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}
