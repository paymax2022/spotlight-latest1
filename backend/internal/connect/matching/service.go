package connectmatching

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNoProfile is returned when the acting user has no Connect profile yet.
var ErrNoProfile = errors.New("connect: no profile for user")

// ErrSelfLike is returned when a user tries to like their own profile.
var ErrSelfLike = errors.New("connect: cannot like your own profile")

// orderPair returns the two profile ids in canonical (a<b) order so a match pair
// is identical regardless of who liked first — backing the UNIQUE(a,b) constraint.
func orderPair(x, y string) (string, string) {
	if x < y {
		return x, y
	}
	return y, x
}

// Service records likes/super-likes and creates mutual matches.
type Service struct {
	db *pgxpool.Pool
}

// NewService builds the matching service.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// profileIDForUser resolves the caller's profile id (object-level authz anchor).
func (s *Service) profileIDForUser(ctx context.Context, q pgx.Row) (string, error) {
	var id string
	err := q.Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNoProfile
	}
	return id, err
}

// Like records a like/super-like from the authed user to a target profile and, if
// the target has already liked back, creates the mutual match — all in one tx.
//
// Idempotency: the (from,to) row is upserted with ON CONFLICT DO NOTHING, so a
// retried/double-submitted like is a no-op. A match is created only when the
// reciprocal like exists, and the match insert itself is ON CONFLICT DO NOTHING
// (mutual-only + idempotent). The whole operation is safe to replay.
func (s *Service) Like(ctx context.Context, fromUserID, toProfileID, kind string) (*LikeResult, error) {
	if kind == "" {
		kind = KindLike
	}
	if !ValidKind(kind) {
		return nil, fmt.Errorf("connect: invalid like kind %q", kind)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect: begin like tx: %w", err)
	}
	defer tx.Rollback(ctx)

	fromProfile, err := s.profileIDForUser(ctx, tx.QueryRow(ctx,
		`SELECT id FROM connect_profiles WHERE user_id = $1`, fromUserID))
	if err != nil {
		return nil, err
	}
	if fromProfile == toProfileID {
		return nil, ErrSelfLike
	}

	// Target must exist.
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM connect_profiles WHERE id = $1)`, toProfileID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("connect: check target: %w", err)
	}
	if !exists {
		return nil, fmt.Errorf("connect: target profile not found")
	}

	// Idempotent insert of the like.
	const insLike = `INSERT INTO connect_likes (from_profile, to_profile, kind)
		VALUES ($1,$2,$3)
		ON CONFLICT (from_profile, to_profile) DO NOTHING
		RETURNING id`
	var likeID string
	replayed := false
	if err := tx.QueryRow(ctx, insLike, fromProfile, toProfile(toProfileID), kind).Scan(&likeID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			replayed = true // like already existed — no-op
		} else {
			return nil, fmt.Errorf("connect: insert like: %w", err)
		}
	}

	res := &LikeResult{Liked: true, Kind: kind, Replayed: replayed}

	// Mutual check: does the target already like the actor back?
	var reciprocal bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM connect_likes WHERE from_profile = $1 AND to_profile = $2)`,
		toProfileID, fromProfile).Scan(&reciprocal); err != nil {
		return nil, fmt.Errorf("connect: reciprocal check: %w", err)
	}

	if reciprocal {
		a, b := orderPair(fromProfile, toProfileID)
		const insMatch = `INSERT INTO connect_matches (profile_a, profile_b, status)
			VALUES ($1,$2,'matched')
			ON CONFLICT (profile_a, profile_b) DO UPDATE SET profile_a = EXCLUDED.profile_a
			RETURNING id`
		// The DO UPDATE no-op lets RETURNING yield the id whether inserted or pre-existing.
		var matchID string
		if err := tx.QueryRow(ctx, insMatch, a, b).Scan(&matchID); err != nil {
			return nil, fmt.Errorf("connect: create match: %w", err)
		}
		res.Matched = true
		res.MatchID = matchID
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("connect: commit like: %w", err)
	}
	return res, nil
}

// toProfile is a tiny helper kept for call-site readability.
func toProfile(id string) string { return id }

// ListMatches returns the authed user's active matches, newest first, with the
// "other" participant resolved.
func (s *Service) ListMatches(ctx context.Context, userID string, limit int) ([]Match, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT m.id, m.status, m.reason, m.matched_at,
		       other.id, other.user_id, other.display_name
		FROM connect_matches m
		JOIN connect_profiles me    ON me.id IN (m.profile_a, m.profile_b) AND me.user_id = $1
		JOIN connect_profiles other ON other.id IN (m.profile_a, m.profile_b) AND other.id <> me.id
		WHERE m.status = 'matched'
		ORDER BY m.matched_at DESC
		LIMIT $2`
	rows, err := s.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: list matches: %w", err)
	}
	defer rows.Close()

	var out []Match
	for rows.Next() {
		var m Match
		var reason []byte
		if err := rows.Scan(&m.ID, &m.Status, &reason, &m.MatchedAt, &m.OtherProfile, &m.OtherUserID, &m.OtherName); err != nil {
			return nil, err
		}
		if len(reason) > 0 {
			_ = jsonUnmarshal(reason, &m.Reason)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
