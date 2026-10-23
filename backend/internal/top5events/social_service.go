package top5events

// Likes and follows (events-social). The rules live here; SQL lives in
// social_store.go. No ledger posting and no Idempotency-Key: nothing moves money.

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// publicForLike reports whether an event state is visible to the public, and so
// likeable. DRAFT, SUBMITTED, SUSPENDED (and the rest) are not: they behave as if
// the event does not exist, so a caller cannot probe for unpublished events.
func publicForLike(state string) bool {
	switch EventState(state) {
	case EventLive, EventApproved, EventClosed:
		return true
	}
	return false
}

// LikeEvent records the caller's like. Repeating it returns the current state.
// A missing or non-public event returns ErrNotFound.
func (s *Service) LikeEvent(ctx context.Context, userID, eventID string) (LikeState, error) {
	if userID == "" {
		return LikeState{}, fmt.Errorf("%w: events: user required", ErrValidation)
	}
	if _, err := uuid.Parse(eventID); err != nil {
		return LikeState{}, ErrNotFound
	}
	state, _, found, err := eventLikeContext(ctx, s.db, userID, eventID)
	if err != nil {
		return LikeState{}, err
	}
	if !found || !publicForLike(state) {
		return LikeState{}, ErrNotFound
	}
	return insertLike(ctx, s.db, userID, eventID)
}

// UnlikeEvent removes the caller's like. Unliking an event that is not liked
// returns the current state with the count untouched. A missing event returns
// ErrNotFound; a non-public event does too unless the caller already holds a like
// on it (so a like on an event that was later suspended can still be withdrawn,
// without confirming the existence of events the caller has no tie to).
func (s *Service) UnlikeEvent(ctx context.Context, userID, eventID string) (LikeState, error) {
	if userID == "" {
		return LikeState{}, fmt.Errorf("%w: events: user required", ErrValidation)
	}
	if _, err := uuid.Parse(eventID); err != nil {
		return LikeState{}, ErrNotFound
	}
	state, liked, found, err := eventLikeContext(ctx, s.db, userID, eventID)
	if err != nil {
		return LikeState{}, err
	}
	if !found || (!publicForLike(state) && !liked) {
		return LikeState{}, ErrNotFound
	}
	return deleteLike(ctx, s.db, userID, eventID)
}

// FollowOrganiser records the caller's follow, creating the organiser's profile
// row if needed. Self-follow is rejected (ErrValidation) before any write. An
// unknown account, or one with no event (not an organiser), returns ErrNotFound. Repeating it returns the current state.
func (s *Service) FollowOrganiser(ctx context.Context, userID, organiserID string) (FollowState, error) {
	if err := s.checkFollowTarget(ctx, userID, organiserID); err != nil {
		return FollowState{}, err
	}
	return insertFollow(ctx, s.db, userID, organiserID)
}

// UnfollowOrganiser removes the caller's follow. Unfollowing an organiser who is
// not followed returns the current state with the count untouched.
func (s *Service) UnfollowOrganiser(ctx context.Context, userID, organiserID string) (FollowState, error) {
	if err := s.checkFollowTarget(ctx, userID, organiserID); err != nil {
		return FollowState{}, err
	}
	return deleteFollow(ctx, s.db, userID, organiserID)
}

// checkFollowTarget validates a follow/unfollow request without writing: a
// self-follow is a validation error, and an account that is not an organiser (no
// event of its own, ruling R41) is not found.
func (s *Service) checkFollowTarget(ctx context.Context, userID, organiserID string) error {
	if userID == "" {
		return fmt.Errorf("%w: events: user required", ErrValidation)
	}
	orgUUID, err := uuid.Parse(organiserID)
	if err != nil {
		return ErrNotFound
	}
	if usrUUID, perr := uuid.Parse(userID); perr == nil && usrUUID == orgUUID {
		return fmt.Errorf("%w: events: you cannot follow yourself", ErrValidation)
	}
	// R41: only an account with at least one event can be followed. Checked
	// before insertFollow, so a non-organiser never gets a profile row.
	ok, err := isOrganiser(ctx, s.db, organiserID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

// ListFollowingEvents is the Following feed: upcoming LIVE or APPROVED events of
// the organisers userID follows, ordered by starts_at. limit must be 1..100 and
// offset >= 0, otherwise ErrValidation (422). A user who follows nobody gets an
// empty (non-nil) list.
func (s *Service) ListFollowingEvents(ctx context.Context, userID string, limit, offset int) ([]Event, error) {
	if _, err := uuid.Parse(userID); err != nil {
		return nil, fmt.Errorf("%w: events: user required", ErrValidation)
	}
	if limit < 1 || limit > followingFeedMax {
		return nil, fmt.Errorf("%w: events: limit must be between 1 and %d", ErrValidation, followingFeedMax)
	}
	if offset < 0 {
		return nil, fmt.Errorf("%w: events: offset must be 0 or more", ErrValidation)
	}
	return listFollowingEvents(ctx, s.db, userID, limit, offset)
}

// followingPage parses the limit and offset query values of the Following feed
// (defaults 20 and 0). Anything non-numeric or out of range is ErrValidation. The
// route handler calls it, then ListFollowingEvents.
func followingPage(limitQ, offsetQ string) (limit, offset int, err error) {
	limit, offset = 20, 0
	if limitQ != "" {
		if limit, err = strconv.Atoi(limitQ); err != nil || limit < 1 || limit > followingFeedMax {
			return 0, 0, fmt.Errorf("%w: events: limit must be between 1 and %d", ErrValidation, followingFeedMax)
		}
	}
	if offsetQ != "" {
		if offset, err = strconv.Atoi(offsetQ); err != nil || offset < 0 {
			return 0, 0, fmt.Errorf("%w: events: offset must be 0 or more", ErrValidation)
		}
	}
	return limit, offset, nil
}

// checkVenueCoords range-checks venue coordinates that are present: latitude in
// [-90, 90] and longitude in [-180, 180]. A nil value (absent or null) passes.
func checkVenueCoords(lat, lng *float64) error {
	if lat != nil && (math.IsNaN(*lat) || *lat < -90 || *lat > 90) {
		return fmt.Errorf("%w: events: venue_lat must be between -90 and 90", ErrValidation)
	}
	if lng != nil && (math.IsNaN(*lng) || *lng < -180 || *lng > 180) {
		return fmt.Errorf("%w: events: venue_lng must be between -180 and 180", ErrValidation)
	}
	return nil
}

// normPlaceID trims a venue place id; blank becomes nil (stored as NULL).
func normPlaceID(v *string) *string {
	if v == nil {
		return nil
	}
	t := strings.TrimSpace(*v)
	if t == "" {
		return nil
	}
	return &t
}

// prepareNewEvent strips what a client must not set on create: banner_url (no
// event banner writer exists yet, ruling R40), like_count and liked (server
// counters). With the social flag off the venue coordinates are not stored, so
// they are dropped too and never echoed. With it on they are range-checked.
func prepareNewEvent(e Event, social bool) (Event, error) {
	e.BannerURL = nil
	e.LikeCount = 0
	e.Liked = false
	if !social {
		e.VenueLat, e.VenueLng, e.VenuePlaceID = nil, nil, nil
		return e, nil
	}
	if err := checkVenueCoords(e.VenueLat, e.VenueLng); err != nil {
		return e, err
	}
	e.VenuePlaceID = normPlaceID(e.VenuePlaceID)
	return e, nil
}
