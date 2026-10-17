package top5events

// Likes and follows (events-social). The rules live here; SQL lives in
// social_store.go. No ledger posting and no Idempotency-Key: nothing moves money.

import (
	"context"
	"fmt"

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
// unknown organiser returns ErrNotFound. Repeating it returns the current state.
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
// self-follow is a validation error, and an unknown organiser is not found.
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
	ok, err := organiserExists(ctx, s.db, organiserID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}
