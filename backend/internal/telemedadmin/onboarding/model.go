// Package onboarding is the telemedicine admin surface for reviewing doctor /
// specialist / veterinarian onboarding applications. It reads the onboarding
// pipeline the mobile app writes (doctor_profiles draft, doctor_merchant_upgrades,
// doctor_legal_consents, doctor_app_permissions, doctor_verifications) and applies
// decisions through the existing MDCN review service so the state machine,
// discoverability gate and licence auto-suspend job stay single-sourced.
package onboarding

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// Stage is the admin-facing summary of where an applicant is.
type Stage string

const (
	StageStarted       Stage = "started"
	StageTypeSelected  Stage = "type_selected"
	StageInProgress    Stage = "in_progress"
	StagePendingReview Stage = "pending_review"
	StageNeedsInfo     Stage = "needs_info"
	StageApproved      Stage = "approved"
	StageRejected      Stage = "rejected"
	StageSuspended     Stage = "suspended"
)

var allStages = []Stage{
	StageStarted, StageTypeSelected, StageInProgress, StagePendingReview,
	StageNeedsInfo, StageApproved, StageRejected, StageSuspended,
}

// ValidStage reports whether s is a known stage filter value.
func ValidStage(s string) bool {
	for _, st := range allStages {
		if string(st) == s {
			return true
		}
	}
	return false
}

// RequiredConsents is the set of legal documents the mobile onboarding asks a
// provider to accept (LEGAL_DOC_ORDER in the app).
var RequiredConsents = []string{
	"terms_of_service", "medical_privacy", "hipaa_data_protection",
	"professional_conduct", "telemedicine_policy",
}

// Application is one row of the review queue.
type Application struct {
	UserID             string     `json:"user_id"`
	Name               string     `json:"name"`
	Email              *string    `json:"email"`
	Phone              *string    `json:"phone"`
	ProviderType       string     `json:"provider_type"`
	SelectedType       *string    `json:"selected_type"`
	Stage              Stage      `json:"stage"`
	UpgradeState       *string    `json:"upgrade_state"`
	VerificationStatus *string    `json:"verification_status"`
	VerificationID     *string    `json:"verification_id"`
	MDCNNumber         *string    `json:"mdcn_number"`
	ConsentsAccepted   int        `json:"consents_accepted"`
	ConsentsRequired   int        `json:"consents_required"`
	PermissionsGranted int        `json:"permissions_granted"`
	StepsCompleted     int        `json:"steps_completed"`
	SubmittedAt        *time.Time `json:"submitted_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

// ApplicationList is a page of applications plus per-stage counts.
type ApplicationList struct {
	Items  []Application  `json:"items"`
	Total  int            `json:"total"`
	Counts map[string]int `json:"counts"`
}

// ListQuery is the validated list filter.
type ListQuery struct {
	Stage  string
	Q      string
	Limit  int
	Offset int
}

type Consent struct {
	Kind       string     `json:"kind"`
	Version    string     `json:"version"`
	Accepted   bool       `json:"accepted"`
	AcceptedAt *time.Time `json:"accepted_at"`
}

type Permission struct {
	Kind      string     `json:"kind"`
	State     string     `json:"state"`
	DecidedAt *time.Time `json:"decided_at"`
}

type Verification struct {
	ID              string     `json:"id"`
	Status          string     `json:"status"`
	Kind            string     `json:"kind"`
	MDCNNumber      *string    `json:"mdcn_number"`
	Discipline      *string    `json:"discipline"`
	LicenceExpiry   *string    `json:"licence_expiry"`
	SubmittedAt     *time.Time `json:"submitted_at"`
	DecidedAt       *time.Time `json:"decided_at"`
	Notes           *string    `json:"notes"`
	RejectionReason *string    `json:"rejection_reason"`
}

type Document struct {
	ID         string    `json:"id"`
	DocType    string    `json:"doc_type"`
	Label      *string   `json:"label"`
	FileName   *string   `json:"file_name"`
	MimeType   *string   `json:"mime_type"`
	SizeBytes  *int64    `json:"size_bytes"`
	Required   bool      `json:"required"`
	UploadedAt time.Time `json:"uploaded_at"`
}

type AuditEntry struct {
	ID        string         `json:"id"`
	Action    string         `json:"action"`
	ActorID   string         `json:"actor_id"`
	CreatedAt time.Time      `json:"created_at"`
	Detail    map[string]any `json:"detail"`
}

// ApplicationDetail is the full review view of one applicant.
type ApplicationDetail struct {
	Application
	Specialty      *string        `json:"specialty"`
	Hospital       *string        `json:"hospital"`
	IsPublished    bool           `json:"is_published"`
	CompletedSteps []string       `json:"completed_steps"`
	Consents       []Consent      `json:"consents"`
	Permissions    []Permission   `json:"permissions"`
	Verifications  []Verification `json:"verifications"`
	Documents      []Document     `json:"documents"`
	Audit          []AuditEntry   `json:"audit"`
	CanDecide      bool           `json:"can_decide"`
	ReviewPath     string         `json:"review_path"`
}

// DecisionRequest is the reviewer verdict.
type DecisionRequest struct {
	Action        string `json:"action" binding:"required"`
	LicenceExpiry string `json:"licence_expiry"`
	Discipline    string `json:"discipline"`
	Notes         string `json:"notes"`
}

const maxNotesLen = 2000

var (
	ErrNotFound           = errors.New("onboarding: application not found")
	ErrValidation         = errors.New("onboarding: invalid request")
	ErrNoOpenVerification = errors.New("onboarding: applicant has no verification awaiting a decision")
)

// Decision is a validated DecisionRequest.
type Decision struct {
	Action        string
	LicenceExpiry *time.Time
	Discipline    *string
	Notes         string
}

// ValidateDecision checks a verdict before anything is written. now is injected
// so the future-expiry rule is testable.
func ValidateDecision(req DecisionRequest, now time.Time) (Decision, error) {
	d := Decision{Action: req.Action, Notes: strings.TrimSpace(req.Notes)}
	if len(d.Notes) > maxNotesLen {
		return d, wrap("notes must be at most 2000 characters")
	}
	switch req.Action {
	case "approve":
		if req.LicenceExpiry == "" {
			return d, wrap("licence_expiry is required to approve")
		}
		t, err := time.Parse("2006-01-02", req.LicenceExpiry)
		if err != nil {
			return d, wrap("licence_expiry must be YYYY-MM-DD")
		}
		if !t.After(now.UTC().Truncate(24 * time.Hour)) {
			return d, wrap("licence_expiry must be in the future")
		}
		if req.Discipline != "medical" && req.Discipline != "dental" {
			return d, wrap("discipline must be medical or dental to approve")
		}
		disc := req.Discipline
		d.LicenceExpiry, d.Discipline = &t, &disc
	case "reject", "need_info":
		if d.Notes == "" {
			return d, wrap("notes (the reason) are required to " + strings.ReplaceAll(req.Action, "_", " "))
		}
	default:
		return d, wrap("action must be approve, need_info or reject")
	}
	return d, nil
}

func wrap(msg string) error { return fmt.Errorf("%w: %s", ErrValidation, msg) }

// CanDecide reports whether a verification status accepts an ops decision.
func CanDecide(status string) bool { return status == "pending" || status == "needs_info" }
