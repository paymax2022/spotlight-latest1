package top5events

// SQL for event likes and organiser follows (events-social, spec "Decisions" 3).
//
// Counters (events.like_count, organiser_profiles.follower_count) are stored, not
// counted on read, and move in the SAME transaction as the row they describe.
// Each counter moves only when the row write actually changed something
// (RowsAffected() == 1), so a repeat like/follow and an unlike/unfollow of a row
// that is not there leave the counter alone. The decrement is also clamped with
// GREATEST(count - 1, 0) as a second guard.
//
// Likes and follows move no money: no ledger posting, no idempotency key.
// Rules (state checks, self-follow) live in social_service.go, not here.

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// LikeState is the caller's like state for one event plus its stored total.
type LikeState struct {
	Liked     bool `json:"liked"`
	LikeCount int  `json:"like_count"`
}

// FollowState is the caller's follow state for one organiser plus the stored total.
type FollowState struct {
	Following     bool `json:"following"`
	FollowerCount int  `json:"follower_count"`
}

// eventLikeContext reports whether the event exists, its state, and whether the
// caller currently has a like on it. found is false for an unknown event.
func eventLikeContext(ctx context.Context, db *pgxpool.Pool, userID, eventID string) (state string, liked, found bool, err error) {
	const q = `
		SELECT e.state,
		       EXISTS (SELECT 1 FROM event_likes l WHERE l.event_id = e.id AND l.user_id = $2)
		  FROM events e
		 WHERE e.id = $1`
	if err := db.QueryRow(ctx, q, eventID, userID).Scan(&state, &liked); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, false, nil
		}
		return "", false, false, fmt.Errorf("events: like context: %w", err)
	}
	return state, liked, true, nil
}

// organiserExists reports whether organiserID is a known account (the FK target
// of organiser_follows.organiser_id and organiser_profiles.organiser_id).
func organiserExists(ctx context.Context, db *pgxpool.Pool, organiserID string) (bool, error) {
	var ok bool
	if err := db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = $1)`, organiserID).Scan(&ok); err != nil {
		return false, fmt.Errorf("events: organiser lookup: %w", err)
	}
	return ok, nil
}

// insertLike records the like and bumps events.like_count in one transaction.
// A repeat like inserts nothing, bumps nothing, and returns the current state.
func insertLike(ctx context.Context, db *pgxpool.Pool, userID, eventID string) (LikeState, error) {
	st := LikeState{Liked: true}
	err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`INSERT INTO event_likes (event_id, user_id) VALUES ($1, $2) ON CONFLICT (event_id, user_id) DO NOTHING`,
			eventID, userID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 1 {
			return tx.QueryRow(ctx,
				`UPDATE events SET like_count = like_count + 1 WHERE id = $1 RETURNING like_count`,
				eventID).Scan(&st.LikeCount)
		}
		return tx.QueryRow(ctx, `SELECT like_count FROM events WHERE id = $1`, eventID).Scan(&st.LikeCount)
	})
	return st, mapSocialErr("like", err)
}

// deleteLike removes the like and decrements events.like_count in one
// transaction, only when a row was actually removed.
func deleteLike(ctx context.Context, db *pgxpool.Pool, userID, eventID string) (LikeState, error) {
	st := LikeState{Liked: false}
	err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM event_likes WHERE event_id = $1 AND user_id = $2`, eventID, userID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 1 {
			return tx.QueryRow(ctx,
				`UPDATE events SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1 RETURNING like_count`,
				eventID).Scan(&st.LikeCount)
		}
		return tx.QueryRow(ctx, `SELECT like_count FROM events WHERE id = $1`, eventID).Scan(&st.LikeCount)
	})
	return st, mapSocialErr("unlike", err)
}

// insertFollow upserts the organiser's profile row, records the follow, and bumps
// organiser_profiles.follower_count in one transaction. The profile row must exist
// before the counter update, otherwise a first follow has no counter to move.
func insertFollow(ctx context.Context, db *pgxpool.Pool, followerID, organiserID string) (FollowState, error) {
	st := FollowState{Following: true}
	err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`INSERT INTO organiser_profiles (organiser_id) VALUES ($1) ON CONFLICT (organiser_id) DO NOTHING`,
			organiserID); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx,
			`INSERT INTO organiser_follows (organiser_id, follower_id) VALUES ($1, $2) ON CONFLICT (organiser_id, follower_id) DO NOTHING`,
			organiserID, followerID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 1 {
			return tx.QueryRow(ctx,
				`UPDATE organiser_profiles SET follower_count = follower_count + 1 WHERE organiser_id = $1 RETURNING follower_count`,
				organiserID).Scan(&st.FollowerCount)
		}
		return tx.QueryRow(ctx,
			`SELECT follower_count FROM organiser_profiles WHERE organiser_id = $1`,
			organiserID).Scan(&st.FollowerCount)
	})
	return st, mapSocialErr("follow", err)
}

// deleteFollow removes the follow and decrements follower_count in one
// transaction, only when a row was actually removed. An organiser with no profile
// row reports a count of zero.
func deleteFollow(ctx context.Context, db *pgxpool.Pool, followerID, organiserID string) (FollowState, error) {
	st := FollowState{Following: false}
	err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`DELETE FROM organiser_follows WHERE organiser_id = $1 AND follower_id = $2`,
			organiserID, followerID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 1 {
			err = tx.QueryRow(ctx,
				`UPDATE organiser_profiles SET follower_count = GREATEST(follower_count - 1, 0) WHERE organiser_id = $1 RETURNING follower_count`,
				organiserID).Scan(&st.FollowerCount)
		} else {
			err = tx.QueryRow(ctx,
				`SELECT follower_count FROM organiser_profiles WHERE organiser_id = $1`,
				organiserID).Scan(&st.FollowerCount)
		}
		if errors.Is(err, pgx.ErrNoRows) {
			st.FollowerCount = 0 // no profile row yet: nothing to count
			return nil
		}
		return err
	})
	return st, mapSocialErr("unfollow", err)
}

// mapSocialErr turns a foreign-key violation (the event or organiser vanished
// between the pre-check and the write) into ErrNotFound, and wraps anything else.
func mapSocialErr(op string, err error) error {
	if err == nil {
		return nil
	}
	var st sqlStater
	if errors.As(err, &st) && st.SQLState() == "23503" {
		return ErrNotFound
	}
	return fmt.Errorf("events: %s: %w", op, err)
}
