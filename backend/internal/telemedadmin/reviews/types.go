// Package reviews is the telemedicine admin console's review-moderation
// surface: it unifies patient reviews from telemedicine_reviews and
// doctor_reviews, lets an operator hide/unhide them, and runs the doctor
// review-dispute queue (doctor_review_disputes).
package reviews

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/go-common/httperr"
)

const (
	SourceTelemedicine = "telemedicine"
	SourceDoctorModule = "doctor_module"

	StatusOpen     = "open"
	StatusUpheld   = "upheld"
	StatusRejected = "rejected"

	maxReasonLen = 500
	minReasonLen = 5
	maxQueryLen  = 100
)

var (
	ErrValidation     = errors.New("reviews: invalid request")
	ErrNotFound       = errors.New("reviews: not found")
	ErrConflict       = errors.New("reviews: illegal state transition")
	ErrSelfModeration = errors.New("reviews: a doctor may not moderate reviews or disputes about themselves")
	ErrNoActor        = errors.New("reviews: authenticated admin required")
)

var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusBadRequest, ErrValidation),
	httperr.R(http.StatusUnauthorized, ErrNoActor),
	httperr.R(http.StatusForbidden, ErrSelfModeration),
	httperr.R(http.StatusNotFound, ErrNotFound),
	httperr.R(http.StatusConflict, ErrConflict),
)

// Summary is the KPI strip.
type Summary struct {
	TotalReviews        int `json:"total_reviews"`
	HiddenReviews       int `json:"hidden_reviews"`
	LowRatedVisible     int `json:"low_rated_visible"`
	OpenDisputes        int `json:"open_disputes"`
	ResolvedDisputes30d int `json:"resolved_disputes_30d"`
	ReportedReviews     int `json:"reported_reviews"`
}

// Review is one review from either source.
type Review struct {
	ID            string    `json:"id"`
	Source        string    `json:"source"`
	DoctorID      *string   `json:"doctor_id"`
	DoctorUserID  *string   `json:"doctor_user_id"`
	DoctorName    string    `json:"doctor_name"`
	PatientRef    string    `json:"patient_ref"`
	AppointmentID *string   `json:"appointment_id"`
	Rating        *int      `json:"rating"`
	Comment       string    `json:"comment"`
	Hidden        bool      `json:"hidden"`
	HiddenReason  *string   `json:"hidden_reason"`
	Reported      bool      `json:"reported"`
	OpenDisputes  int       `json:"open_disputes"`
	CreatedAt     time.Time `json:"created_at"`
}

// ModerationEvent is one audit-trail entry for a review.
type ModerationEvent struct {
	Action string    `json:"action"`
	Reason string    `json:"reason"`
	Actor  string    `json:"actor"`
	At     time.Time `json:"at"`
}

// ReviewDetail adds the review's disputes and moderation history.
type ReviewDetail struct {
	Review
	Disputes []Dispute         `json:"disputes"`
	History  []ModerationEvent `json:"history"`
}

// Dispute is one doctor_review_disputes row.
type Dispute struct {
	ID               string     `json:"id"`
	Kind             string     `json:"kind"`
	Status           string     `json:"status"`
	Reason           *string    `json:"reason"`
	ReviewID         *string    `json:"review_id"`
	DoctorUserID     string     `json:"doctor_user_id"`
	DoctorName       string     `json:"doctor_name"`
	ResolutionReason *string    `json:"resolution_reason"`
	ResolvedAt       *time.Time `json:"resolved_at"`
	CreatedAt        time.Time  `json:"created_at"`
}

// DisputeDetail adds the disputed review (nil when it has been deleted).
type DisputeDetail struct {
	Dispute
	Review *Review `json:"review"`
}

// ListFilter filters the review list.
type ListFilter struct {
	Source   string
	Rating   int
	Hidden   *bool
	DoctorID string
	Query    string
	Limit    int
	Offset   int
}

// DisputeFilter filters the dispute queue.
type DisputeFilter struct {
	Status string
	Kind   string
	Limit  int
	Offset int
}

func validSource(s string) bool { return s == SourceTelemedicine || s == SourceDoctorModule }

func validUUID(s string) bool {
	_, err := uuid.Parse(s)
	return err == nil
}

// cleanReason trims and bounds an operator-supplied reason.
func cleanReason(r string) (string, error) {
	r = strings.TrimSpace(r)
	if len(r) < minReasonLen {
		return "", fmt.Errorf("%w: "+"a reason of at least 5 characters is required", ErrValidation)
	}
	if len(r) > maxReasonLen {
		return "", fmt.Errorf("%w: "+"reason is limited to 500 characters", ErrValidation)
	}
	return r, nil
}

// canResolve is the dispute state machine: only an open dispute can be
// resolved, to upheld or rejected. repeat reports an idempotent replay of the
// decision it already holds.
func canResolve(current, decision string) (repeat bool, err error) {
	if decision != StatusUpheld && decision != StatusRejected {
		return false, fmt.Errorf("%w: "+"decision must be upheld or rejected", ErrValidation)
	}
	switch current {
	case StatusOpen:
		return false, nil
	case decision:
		return true, nil
	default:
		return false, fmt.Errorf("%w: dispute is already %s", ErrConflict, current)
	}
}

// maskPatient hides all but a short prefix; the admin console never shows a name.
func maskPatient(id string) string {
	if len(id) < 8 {
		return "—"
	}
	return id[:8] + "…"
}

// likePattern escapes LIKE metacharacters and wraps for a contains match.
func likePattern(q string) string {
	q = strings.TrimSpace(q)
	if q == "" {
		return ""
	}
	r := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_")
	return "%" + r.Replace(q) + "%"
}

func clampPage(limit, offset int) (int, int) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}
