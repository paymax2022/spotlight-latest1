package reviews

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// PropertyAuthorizer is the object-level hotelier authZ hook (does the user hold an
// ACTIVE grant on the property?). Supplied by the extranet AuthZ.
type PropertyAuthorizer interface {
	HasProperty(ctx context.Context, userID, propertyID string) bool
}

// Service owns the verified-guest review lifecycle. The core invariant: a review is
// unlocked ONLY after a COMPLETED reservation owned by the caller, and there is at
// most one review per reservation (binds reservation + guest + property).
type Service struct {
	repo  *Repository
	authz PropertyAuthorizer
}

// NewService constructs the reviews service. authz may be nil for the pure member
// path (no hotelier/admin object checks needed there).
func NewService(repo *Repository, authz PropertyAuthorizer) *Service {
	return &Service{repo: repo, authz: authz}
}

// CanReview reports whether the caller may currently review a reservation: they own
// it, it is COMPLETED, and it has not already been reviewed. This drives the
// "REVIEWABLE" member surface (derived from the reservation state, not a DB state).
func (s *Service) CanReview(ctx context.Context, userID, reservationID string) (bool, error) {
	g, err := s.repo.GetReservationGate(ctx, reservationID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, ErrNotOwner
		}
		return false, err
	}
	if g.GuestUserID != userID {
		return false, ErrNotOwner
	}
	if g.State != "COMPLETED" {
		return false, ErrNotCompleted
	}
	exists, err := s.repo.ExistsForReservation(ctx, reservationID)
	if err != nil {
		return false, err
	}
	return !exists, nil
}

// Create writes a verified-guest review. It enforces the COMPLETED gate, ownership,
// the one-per-reservation rule, and a valid score. The property is bound from the
// reservation (the guest cannot review an arbitrary property).
func (s *Service) Create(ctx context.Context, userID, reservationID string, overall int, sub map[string]any, title, body string) (string, error) {
	if overall < 1 || overall > 5 {
		return "", ErrBadScore
	}
	g, err := s.repo.GetReservationGate(ctx, reservationID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotOwner
		}
		return "", err
	}
	if g.GuestUserID != userID {
		return "", ErrNotOwner // object-level authZ
	}
	if g.State != "COMPLETED" {
		return "", ErrNotCompleted // verified-guest gate
	}
	if g.PropertyID == "" {
		return "", ErrNotCompleted // no property bound (e.g. Rail A unsynced) — cannot verify
	}
	exists, err := s.repo.ExistsForReservation(ctx, reservationID)
	if err != nil {
		return "", err
	}
	if exists {
		return "", ErrAlreadyReviewed
	}
	id, err := s.repo.Create(ctx, Review{
		ReservationID: reservationID,
		PropertyID:    g.PropertyID,
		GuestUserID:   userID,
		OverallScore:  overall,
		SubScores:     sub,
		Title:         strings.TrimSpace(title),
		Body:          strings.TrimSpace(body),
	})
	if err != nil {
		// The partial UNIQUE(reservation_id) catches a concurrent double-submit.
		if strings.Contains(err.Error(), "uq_stays_review_reservation") {
			return "", ErrAlreadyReviewed
		}
		return "", err
	}
	return id, nil
}

// ListByProperty returns PUBLISHED reviews for a property (public/member).
func (s *Service) ListByProperty(ctx context.Context, propertyID string, limit, offset int) ([]Review, error) {
	return s.repo.ListByProperty(ctx, propertyID, limit, offset)
}

// ListMine returns the caller's reviews.
func (s *Service) ListMine(ctx context.Context, userID string, limit, offset int) ([]Review, error) {
	return s.repo.ListByGuest(ctx, userID, limit, offset)
}

// GetResponse returns the hotelier response for a review (if any).
func (s *Service) GetResponse(ctx context.Context, reviewID string) (Response, error) {
	return s.repo.GetResponse(ctx, reviewID)
}

// ListForHotelier returns ALL reviews for a property the hotelier owns.
func (s *Service) ListForHotelier(ctx context.Context, userID, propertyID string, limit, offset int) ([]Review, error) {
	if s.authz == nil || !s.authz.HasProperty(ctx, userID, propertyID) {
		return nil, ErrForbidden
	}
	return s.repo.ListByPropertyAll(ctx, propertyID, limit, offset)
}

// Respond writes/updates the hotelier response (object-scoped to the property).
func (s *Service) Respond(ctx context.Context, userID, reviewID, body string) (string, error) {
	pid, err := s.repo.PropertyOfReview(ctx, reviewID)
	if err != nil {
		return "", err
	}
	if s.authz == nil || !s.authz.HasProperty(ctx, userID, pid) {
		return "", ErrForbidden
	}
	return s.repo.UpsertResponse(ctx, reviewID, pid, userID, strings.TrimSpace(body))
}

// FlagAsHotelier flags a review for moderation (hotelier object-scoped). It does not
// hide the review — only admin moderation can hide it; this raises a flag.
func (s *Service) FlagAsHotelier(ctx context.Context, userID, reviewID, reason string) error {
	pid, err := s.repo.PropertyOfReview(ctx, reviewID)
	if err != nil {
		return err
	}
	if s.authz == nil || !s.authz.HasProperty(ctx, userID, pid) {
		return ErrForbidden
	}
	return s.repo.SetStatus(ctx, reviewID, "FLAGGED", strings.TrimSpace(reason))
}

// ListForAdminProperty returns all reviews for a property (admin moderation feed).
func (s *Service) ListForAdminProperty(ctx context.Context, propertyID string, limit, offset int) ([]Review, error) {
	return s.repo.ListByPropertyAll(ctx, propertyID, limit, offset)
}

// Moderate sets a review's status (admin: PUBLISHED | FLAGGED | HIDDEN).
func (s *Service) Moderate(ctx context.Context, reviewID, status, reason string) error {
	switch status {
	case "PUBLISHED", "FLAGGED", "HIDDEN", "PENDING":
	default:
		return errors.New("reviews: invalid moderation status")
	}
	return s.repo.SetStatus(ctx, reviewID, status, reason)
}

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
