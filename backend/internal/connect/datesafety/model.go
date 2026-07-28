// Package connectdatesafety implements the Paymax Connect date-safety center:
// trusted-contact management, a date planner with trusted-contact share, a
// check-in, and post-date feedback. Trusted-contact phone numbers are sensitive
// PII — they are never logged and are owner-only (RLS). See
// docs/prd/dating/{acceptance.md §Phase 1, compliance.md}.
package connectdatesafety

import "time"

// Check-in lifecycle (mirrors connect_date_plans.checkin_state CHECK).
const (
	StatePlanned   = "planned"
	StateShared    = "shared"
	StateCheckedIn = "checked_in"
	StateCompleted = "completed"
	StateMissed    = "missed"
)

// allowedTransition encodes the date-plan check-in state machine. Any transition
// not listed here is rejected (guarded transitions, never ad-hoc status writes).
var allowedTransition = map[string]map[string]bool{
	StatePlanned:   {StateShared: true, StateCheckedIn: true, StateCompleted: true, StateMissed: true},
	StateShared:    {StateCheckedIn: true, StateCompleted: true, StateMissed: true},
	StateCheckedIn: {StateCompleted: true, StateMissed: true},
	StateCompleted: {},
	StateMissed:    {},
}

// CanTransition reports whether from→to is an allowed check-in transition.
func CanTransition(from, to string) bool { return allowedTransition[from][to] }

// TrustedContact mirrors a row of public.connect_trusted_contacts.
type TrustedContact struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Phone        string    `json:"phone"`
	Relationship string    `json:"relationship,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// TrustedContactRequest is the create body.
type TrustedContactRequest struct {
	Name         string `json:"name" binding:"required"`
	Phone        string `json:"phone" binding:"required"`
	Relationship string `json:"relationship"`
}

// DatePlan mirrors a row of public.connect_date_plans.
type DatePlan struct {
	ID                string         `json:"id"`
	MatchID           string         `json:"match_id"`
	OwnerID           string         `json:"owner_id"`
	Idea              *string        `json:"idea,omitempty"`
	Venue             *string        `json:"venue,omitempty"`
	ScheduledAt       *time.Time     `json:"scheduled_at,omitempty"`
	SharedWithContact bool           `json:"shared_with_contact"`
	SharedContactID   *string        `json:"shared_contact_id,omitempty"`
	CheckinState      string         `json:"checkin_state"`
	CheckinAt         *time.Time     `json:"checkin_at,omitempty"`
	Feedback          map[string]any `json:"feedback,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
}

// CreateDatePlanRequest is the create body.
type CreateDatePlanRequest struct {
	MatchID     string     `json:"match_id" binding:"required"`
	Idea        string     `json:"idea"`
	Venue       string     `json:"venue"`
	ScheduledAt *time.Time `json:"scheduled_at"`
}

// ShareRequest shares a plan with a trusted contact.
type ShareRequest struct {
	ContactID string `json:"contact_id" binding:"required"`
}

// FeedbackRequest is post-date feedback; may carry a safety concern that opens a case.
type FeedbackRequest struct {
	Rating       int    `json:"rating"`
	Notes        string `json:"notes"`
	SafetyReport bool   `json:"safety_report"` // true → also open a connect_case
}
