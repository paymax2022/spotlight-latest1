package reviews

import (
	"errors"
	"time"
)

// Sentinel errors.
var (
	// ErrNotCompleted is returned when a guest tries to review a reservation that is
	// not COMPLETED — the verified-guest gate (PRD §14). A review is unlocked ONLY
	// after a completed stay.
	ErrNotCompleted = errors.New("reviews: reservation not COMPLETED — review locked")
	// ErrNotOwner is returned when the caller does not own the reservation.
	ErrNotOwner = errors.New("reviews: caller does not own this reservation")
	// ErrAlreadyReviewed is returned when a reservation already has a review.
	ErrAlreadyReviewed = errors.New("reviews: reservation already reviewed")
	// ErrForbidden is the hotelier/admin object-scope failure.
	ErrForbidden = errors.New("reviews: forbidden")
	// ErrBadScore is an out-of-range overall score.
	ErrBadScore = errors.New("reviews: overall_score must be 1..5")
)

// Review is a verified-guest review bound to a COMPLETED reservation.
type Review struct {
	ID            string         `json:"id"`
	ReservationID string         `json:"reservation_id"`
	PropertyID    string         `json:"property_id"`
	GuestUserID   string         `json:"guest_user_id"`
	OverallScore  int            `json:"overall_score"`
	SubScores     map[string]any `json:"sub_scores"`
	Title         string         `json:"title"`
	Body          string         `json:"body"`
	Status        string         `json:"status"` // PUBLISHED | FLAGGED | HIDDEN | PENDING
	FlaggedReason string         `json:"flagged_reason"`
	CreatedAt     time.Time      `json:"created_at"`
}

// Response is a hotelier response to a review.
type Response struct {
	ID              string    `json:"id"`
	ReviewID        string    `json:"review_id"`
	PropertyID      string    `json:"property_id"`
	ResponderUserID string    `json:"responder_user_id"`
	Body            string    `json:"body"`
	CreatedAt       time.Time `json:"created_at"`
}
