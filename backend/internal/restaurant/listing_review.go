package restaurant

import (
	"context"
	"fmt"
	"strings"
)

// ── Listing review (foodhub A6 / §6.3) ──────────────────────────────────────
//
// Today a restaurant's public face — its name, description, address and menu —
// goes live the instant an owner saves it. There is no review of any kind. For a
// consumer marketplace that is a standing trust problem: nothing stands between
// an owner's text and a customer's screen.
//
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
//
// APPROVED is deliberately NOT terminal: a listing that has gone bad must be
// pullable without deleting the restaurant, and an owner editing an approved
// listing must be able to put it back into review.
var allowedListingTransitions = map[ListingReviewStatus]map[ListingReviewStatus]bool{
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
	return allowedListingTransitions[from][to]
}

// IsPubliclyListable reports whether a listing may appear in discovery.
//
// Only APPROVED. In particular an EMPTY status is not listable — a row whose
// status could not be read must not default to public.
func IsPubliclyListable(status ListingReviewStatus) bool {
	return status == ListingApproved
}

// ListingDecisionNeedsReason reports whether a reviewer must say why.
//
// Rejecting or asking for changes without a reason leaves the owner with nothing
// to act on, and support with nothing to explain.
func ListingDecisionNeedsReason(to ListingReviewStatus) bool {
	return to == ListingRejected || to == ListingChangesRequested
}

// ─── Service operations ─────────────────────────────────────────────────────

// SubmitListingForReview puts an owner's listing in front of a reviewer and
// snapshots exactly what is being reviewed.
//
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
//
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
