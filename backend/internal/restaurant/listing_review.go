package restaurant

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"spotlight/backend/go-common/fsm"
)

// Today a restaurant's public face — its name, description, address and menu —
// goes live the instant an owner saves it. There is no review of any kind. For a
// consumer marketplace that is a standing trust problem: nothing stands between
// an owner's text and a customer's screen.
// This adds the state, the transitions and the gate. It does NOT change what
// discovery serves until FEATURE_FOODHUB_MODERATION is on: every existing
// restaurant is backfilled APPROVED, and with the flag off the gate is not
// applied at all. §1.4 of the PRD requires exactly that — the consumer flow must
// behave identically with the new flags off.

// ListingReviewStatus is the moderation state of a restaurant's public listing.
type ListingReviewStatus string

const (
	// ListingDraft — never submitted. A newly created restaurant starts here.
	ListingDraft ListingReviewStatus = "DRAFT"
	// ListingPending — awaiting a reviewer.
	ListingPending ListingReviewStatus = "PENDING"
	// ListingApproved — publicly listable.
	ListingApproved ListingReviewStatus = "APPROVED"
	// ListingChangesRequested — a reviewer asked for edits; the owner resubmits.
	ListingChangesRequested ListingReviewStatus = "CHANGES_REQUESTED"
	// ListingRejected — terminal for this submission; the owner may resubmit.
	ListingRejected ListingReviewStatus = "REJECTED"
)

// allowedListingTransitions is the guarded state machine.
// APPROVED is deliberately NOT terminal: a listing that has gone bad must be
// pullable without deleting the restaurant, and an owner editing an approved
// listing must be able to put it back into review.
var allowedListingTransitions = fsm.Table[ListingReviewStatus]{
	ListingDraft:            {ListingPending: true},
	ListingPending:          {ListingApproved: true, ListingRejected: true, ListingChangesRequested: true},
	ListingChangesRequested: {ListingPending: true},
	ListingRejected:         {ListingPending: true},
	ListingApproved:         {ListingPending: true, ListingChangesRequested: true, ListingRejected: true},
}

// CanTransitionListing reports whether a listing may move between two states.
// Unknown states deny: a status this build does not understand must never be
// treated as publishable.
func CanTransitionListing(from, to ListingReviewStatus) bool {
	return allowedListingTransitions.Can(from, to)
}

// IsPubliclyListable reports whether a listing may appear in discovery.
// Only APPROVED. In particular an EMPTY status is not listable — a row whose
// status could not be read must not default to public.
func IsPubliclyListable(status ListingReviewStatus) bool {
	return status == ListingApproved
}

// ListingDecisionNeedsReason reports whether a reviewer must say why.
// Rejecting or asking for changes without a reason leaves the owner with nothing
// to act on, and support with nothing to explain.
func ListingDecisionNeedsReason(to ListingReviewStatus) bool {
	return to == ListingRejected || to == ListingChangesRequested
}

// SubmitListingForReview puts an owner's listing in front of a reviewer and
// snapshots exactly what is being reviewed.
// The snapshot matters: without it "approved" refers to whatever the owner has
// edited since, which is not a review at all.
func (s *Service) SubmitListingForReview(ctx context.Context, restaurantID, userID string) error {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageStore); err != nil {
		return err
	}
	var current string
	if err := s.db.QueryRow(ctx,
		`SELECT COALESCE(listing_review_status,'DRAFT') FROM restaurants WHERE id=$1`, restaurantID).
		Scan(&current); err != nil {
		return fmt.Errorf("restaurant: not found")
	}
	if !CanTransitionListing(ListingReviewStatus(current), ListingPending) {
		return fmt.Errorf("restaurant: a %s listing cannot be submitted for review", current)
	}
	_, err := s.db.Exec(ctx, `
		UPDATE restaurants
		   SET listing_review_status = 'PENDING',
		       listing_review_reason = NULL,
		       published_snapshot = jsonb_build_object(
		         'name', name, 'description', COALESCE(description,''), 'address', address,
		         'logo_url', logo_url, 'cuisine', COALESCE(cuisine,''), 'submitted_at', now()
		       ),
		       updated_at = now()
		 WHERE id = $1`, restaurantID)
	return err
}

// DecideListing records a reviewer's decision.
// Rejecting or requesting changes requires a reason: an owner told "rejected"
// with no explanation has nothing to act on, and support has nothing to relay.
func (s *Service) DecideListing(ctx context.Context, restaurantID, reviewerID string, to ListingReviewStatus, reason string) error {
	if ListingDecisionNeedsReason(to) && strings.TrimSpace(reason) == "" {
		return fmt.Errorf("restaurant: a reason is required to %s a listing", to)
	}
	var current string
	if err := s.db.QueryRow(ctx,
		`SELECT COALESCE(listing_review_status,'DRAFT') FROM restaurants WHERE id=$1`, restaurantID).
		Scan(&current); err != nil {
		return fmt.Errorf("restaurant: not found")
	}
	if !CanTransitionListing(ListingReviewStatus(current), to) {
		return fmt.Errorf("restaurant: cannot move a listing from %s to %s", current, to)
	}
	_, err := s.db.Exec(ctx, `
		UPDATE restaurants
		   SET listing_review_status = $2,
		       listing_review_reason = NULLIF($3,''),
		       listing_reviewed_by = $4,
		       listing_reviewed_at = now(),
		       updated_at = now()
		 WHERE id = $1`, restaurantID, string(to), reason, reviewerID)
	return err
}

// PendingListings is the moderation queue.
func (s *Service) PendingListings(ctx context.Context) ([]UnclaimedRestaurant, error) {
	const q = `
		SELECT id, name, address, is_open, created_at, listing_review_status
		FROM restaurants
		WHERE listing_review_status = 'PENDING'
		ORDER BY updated_at ASC
		LIMIT 200`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UnclaimedRestaurant{}
	for rows.Next() {
		var r UnclaimedRestaurant
		if err := rows.Scan(&r.ID, &r.Name, &r.Address, &r.IsOpen, &r.CreatedAt, &r.Reason); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// RateOrderRequest rates the restaurant and (if present) the rider for a
// delivered order. Stars are 1..5.
type RateOrderRequest struct {
	RestaurantStars int    `json:"restaurant_stars" binding:"required,min=1,max=5"`
	RiderStars      *int   `json:"rider_stars,omitempty"`
	Comment         string `json:"comment"`
}

// OrderRating is a persisted rating record.
type OrderRating struct {
	ID              string `json:"id"`
	OrderID         string `json:"order_id"`
	RaterID         string `json:"rater_id"`
	RestaurantID    string `json:"restaurant_id"`
	RestaurantStars int    `json:"restaurant_stars"`
	RiderID         string `json:"rider_id,omitempty"`
	RiderStars      *int   `json:"rider_stars,omitempty"`
	Comment         string `json:"comment,omitempty"`
}

// RateOrder records the customer's rating of the restaurant and (optionally) the
// rider for a delivered order, then recomputes the restaurant's average rating.
// Only the order's customer may rate, and only once the order is delivered.
func (s *Service) RateOrder(ctx context.Context, orderID, raterID string, req RateOrderRequest) (*OrderRating, error) {
	var customerID, restaurantID, status string
	var riderPtr *string
	const q = `SELECT customer_id, restaurant_id, rider_id, status FROM orders WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, orderID).Scan(&customerID, &restaurantID, &riderPtr, &status); err != nil {
		return nil, errors.New("restaurant: order not found")
	}
	if raterID != customerID {
		return nil, errors.New("restaurant: only the customer may rate this order")
	}
	if status != string(OrderDelivered) {
		return nil, errors.New("restaurant: order is not delivered yet")
	}

	// Sanitize the free-text comment (SEC-007) and auto-flag abusive content for a
	// moderator (RV-004) — flagged reviews stay visible until a human hides them, so a
	// false positive never silently suppresses a legitimate review.
	comment := sanitizeReviewComment(req.Comment)
	moderation := autoFlagComment(comment)
	r := &OrderRating{
		ID:              uuid.New().String(),
		OrderID:         orderID,
		RaterID:         raterID,
		RestaurantID:    restaurantID,
		RestaurantStars: req.RestaurantStars,
		RiderStars:      req.RiderStars,
		Comment:         comment,
	}
	if riderPtr != nil {
		r.RiderID = *riderPtr
	}

	const ins = `INSERT INTO restaurant_ratings
	    (id, order_id, rater_id, restaurant_id, restaurant_stars, rider_id, rider_stars, comment, moderation_status)
	    VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),$9)
	    ON CONFLICT (order_id, rater_id) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins,
		r.ID, orderID, raterID, restaurantID, req.RestaurantStars, riderPtr, req.RiderStars, comment, moderation); err != nil {
		return nil, err
	}

	s.recomputeRestaurantRating(ctx, restaurantID)
	return r, nil
}

// recomputeRestaurantRating recalculates a restaurant's average rating from its
// received restaurant_stars and writes it back to the restaurants.rating column.
func (s *Service) recomputeRestaurantRating(ctx context.Context, restaurantID string) {
	var avg float64
	// Hidden (moderated-away) reviews are excluded so a suppressed fake review can't
	// skew the average.
	s.db.QueryRow(ctx,
		`SELECT COALESCE(AVG(restaurant_stars),5.0) FROM restaurant_ratings WHERE restaurant_id=$1 AND moderation_status <> 'hidden'`,
		restaurantID).Scan(&avg)
	s.db.Exec(ctx, `UPDATE restaurants SET rating=$1, updated_at=NOW() WHERE id=$2`, avg, restaurantID)
}

// PublicReview is a review as shown publicly — anonymized (no rater identity, SEC-009)
// and moderation-filtered.
type PublicReview struct {
	Stars     int    `json:"stars"`
	Comment   string `json:"comment,omitempty"`
	CreatedAt string `json:"created_at"`
}

// ListReviews returns a restaurant's public reviews: hidden ones are excluded and the
// rater identity is never exposed. Newest first.
func (s *Service) ListReviews(ctx context.Context, restaurantID string) ([]PublicReview, error) {
	rows, err := s.db.Query(ctx,
		`SELECT restaurant_stars, COALESCE(comment,''), created_at::text
		 FROM restaurant_ratings
		 WHERE restaurant_id=$1 AND moderation_status <> 'hidden'
		 ORDER BY created_at DESC LIMIT 100`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PublicReview{}
	for rows.Next() {
		var r PublicReview
		if err := rows.Scan(&r.Stars, &r.Comment, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ModerateReview sets a review's moderation status (RV-004). Intended for platform ops
// (route fail-closed behind restaurant.admin.onboarding). Recomputes the rating when a
// review is hidden/unhidden so the average reflects only visible reviews.
func (s *Service) ModerateReview(ctx context.Context, reviewID, status string) error {
	if status != "visible" && status != "flagged" && status != "hidden" {
		return errors.New("restaurant: moderation status must be visible|flagged|hidden")
	}
	var restaurantID string
	if err := s.db.QueryRow(ctx,
		`UPDATE restaurant_ratings SET moderation_status=$1 WHERE id=$2 RETURNING restaurant_id`,
		status, reviewID).Scan(&restaurantID); err != nil {
		return errors.New("restaurant: review not found")
	}
	s.recomputeRestaurantRating(ctx, restaurantID)
	return nil
}

// bannedReviewTerms is a small abuse/profanity list; a comment containing any is
// auto-flagged for a human moderator (not auto-hidden — a false positive shouldn't
// silently suppress a legitimate review). Deliberately conservative.
var bannedReviewTerms = []string{"scam", "fraud", "idiot", "stupid", "fuck", "shit", "bitch", "kill you"}

// sanitizeReviewComment cleans a review comment the same way order instructions are
// cleaned (SEC-007): control chars stripped, whitespace collapsed, length-capped.
func sanitizeReviewComment(s string) string { return sanitizeInstructions(s) }

// autoFlagComment returns the initial moderation status for a new review: "flagged"
// when the (already-sanitized) comment contains a banned term, else "visible".
func autoFlagComment(comment string) string {
	lc := strings.ToLower(comment)
	for _, w := range bannedReviewTerms {
		if strings.Contains(lc, w) {
			return "flagged"
		}
	}
	return "visible"
}

// maskEmail masks the local part of an email for support/rider views (SEC-009):
// "amara.obi@gmail.com" → "am****@gmail.com". Non-emails are returned fully masked.
func maskEmail(s string) string {
	at := strings.IndexByte(s, '@')
	if at <= 0 {
		return maskTail(s, 0)
	}
	local, domain := s[:at], s[at:]
	keep := min(len(local), 2)
	return local[:keep] + "****" + domain
}

// maskPhone keeps the last 3 digits of a phone number (SEC-009):
// "08031234567" → "********567".
func maskPhone(s string) string {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, s)
	if len(digits) <= 3 {
		return strings.Repeat("*", len(digits))
	}
	return strings.Repeat("*", len(digits)-3) + digits[len(digits)-3:]
}

// maskDeliveryAddress redacts a customer's precise address for OFFERED (not-yet-assigned)
// riders (SEC-009 PII minimization): only the assigned rider sees the full address. It
// keeps the last comma-separated segment (the area/city) and masks the street detail —
// "12b Adeola St, Victoria Island, Lagos" → "…, Victoria Island, Lagos".
func maskDeliveryAddress(s string) string {
	parts := strings.Split(s, ",")
	if len(parts) <= 1 {
		return "…" // no structure to keep — hide entirely
	}
	// keep the last up-to-2 segments (area, city).
	keep := min(len(parts), 2)
	tail := parts[len(parts)-keep:]
	for i := range tail {
		tail[i] = strings.TrimSpace(tail[i])
	}
	return "…, " + strings.Join(tail, ", ")
}

// maskTail keeps `keep` leading chars and masks the rest.
func maskTail(s string, keep int) string {
	if len(s) <= keep {
		return strings.Repeat("*", len(s))
	}
	return s[:keep] + strings.Repeat("*", len(s)-keep)
}
