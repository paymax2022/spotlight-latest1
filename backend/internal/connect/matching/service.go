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

// ErrBlocked is returned when a like/match is refused because a block exists
// between the two users in either direction (EC-004 / safety invariant 3: block
// is absolute — a blocked pair can never like, match, or be recommended).
var ErrBlocked = errors.New("connect: blocked")

// ErrIneligibleTarget is returned when a like is refused because the target is not
// eligible for dating (DM-007 / safety invariant 1: minor protection). It is
// deliberately generic so the response never reveals that the target is a minor.
var ErrIneligibleTarget = errors.New("connect: target not available")

// ErrRestricted is returned when the acting user is suspended/banned and therefore
// cannot like or match (TS-009 / invariant 6: moderation actions are enforced).
var ErrRestricted = errors.New("connect: account restricted")

// ErrNeedsCredits is returned when a super-like is refused because the user has no
// super-like credit (PAY-003 premium gating — prompt an upsell). Fail-closed: any
// credit-consume error blocks the super-like rather than granting it for free.
var ErrNeedsCredits = errors.New("connect: no super-like credits")

// CreditConsumer spends a consumable credit (super-like). Optional dependency set
// via SetCreditConsumer so existing constructors/tests (nil consumer) are
// unaffected — when unset, super-likes are not credit-gated.
type CreditConsumer interface {
	Consume(ctx context.Context, userID, creditType, idempotencyKey string, amount int64, reason string) error
}

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
	db      *pgxpool.Pool
	credits CreditConsumer // optional; set via SetCreditConsumer (PAY-003)
}

// NewService builds the matching service.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// SetCreditConsumer wires super-like credit gating (PAY-003). Nil ⇒ ungated.
func (s *Service) SetCreditConsumer(c CreditConsumer) { s.credits = c }

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

	// DM-014 / EC-008 exactly-once: serialize concurrent likes for THIS pair on a
	// canonical key BEFORE the reciprocal check. Under READ COMMITTED, two
	// simultaneous reciprocal likes would each fail to see the other's uncommitted
	// like and create NO match (a missed match). The transaction-scoped advisory
	// lock (keyed on the canonical, direction-independent pair) forces the second
	// like to wait for the first to commit, so it observes the reciprocal like and
	// forms the match exactly once. Same key both directions ⇒ no deadlock. The
	// lock releases automatically at commit/rollback.
	lockA, lockB := orderPair(fromProfile, toProfileID)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, lockA, lockB); err != nil {
		return nil, fmt.Errorf("connect: lock pair: %w", err)
	}

	// Target must exist.
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM connect_profiles WHERE id = $1)`, toProfileID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("connect: check target: %w", err)
	}
	if !exists {
		return nil, fmt.Errorf("connect: target profile not found")
	}

	// EC-004 / safety invariant 3: block is absolute. Refuse the like (and thus any
	// match) when either user has blocked the other. Fail-closed — a block-check
	// error aborts the like rather than letting it through. connect_blocks keys on
	// auth user ids, so resolve the target profile's user_id to compare.
	var blocked bool
	const blockQ = `SELECT EXISTS(
		SELECT 1 FROM connect_blocks b
		JOIN connect_profiles tp ON tp.id = $2
		WHERE (b.blocker_id = $1::uuid AND b.blocked_id = tp.user_id)
		   OR (b.blocked_id = $1::uuid AND b.blocker_id = tp.user_id))`
	if err := tx.QueryRow(ctx, blockQ, fromUserID, toProfileID).Scan(&blocked); err != nil {
		return nil, fmt.Errorf("connect: block check: %w", err)
	}
	if blocked {
		return nil, ErrBlocked
	}

	// DM-007 / safety invariant 1: minor protection, fail-closed. Refuse the like
	// (so no match can form) if the target is flagged underage (not admin-cleared)
	// or their on-profile DOB proves they are under 18. Defense-in-depth against a
	// client liking a profile id that never surfaced in the (age-filtered) deck.
	var minorTarget bool
	const minorQ = `SELECT EXISTS(
		SELECT 1 FROM connect_profiles p
		WHERE p.id = $1
		  AND ( EXISTS (SELECT 1 FROM connect_underage_flags uf
		                WHERE uf.user_id = p.user_id AND uf.status <> 'cleared')
		     OR (p.dob IS NOT NULL AND p.dob > (CURRENT_DATE - INTERVAL '18 years')) ))`
	if err := tx.QueryRow(ctx, minorQ, toProfileID).Scan(&minorTarget); err != nil {
		return nil, fmt.Errorf("connect: minor check: %w", err)
	}
	if minorTarget {
		return nil, ErrIneligibleTarget
	}

	// TS-009 / invariant 6: a suspended/banned actor cannot like or match. Also
	// refuse if the TARGET is restricted, so a banned user can neither reach nor be
	// reached. Fail-closed — a check error aborts the like.
	var restricted bool
	const restrictQ = `SELECT EXISTS(
		SELECT 1 FROM connect_account_restrictions r
		WHERE r.active AND (r.expires_at IS NULL OR r.expires_at > now())
		  AND ( r.user_id = $1::uuid
		     OR r.user_id = (SELECT user_id FROM connect_profiles WHERE id = $2) ))`
	if err := tx.QueryRow(ctx, restrictQ, fromUserID, toProfileID).Scan(&restricted); err != nil {
		return nil, fmt.Errorf("connect: restriction check: %w", err)
	}
	if restricted {
		return nil, ErrRestricted
	}

	// PAY-003 premium gating: a super-like spends one super-like credit. Consumed
	// BEFORE recording the like and keyed by the canonical pair, so a double-tap /
	// retry spends at most one credit (idempotent) and an out-of-credits user is
	// blocked (fail-closed) with an upsell rather than getting a free super-like.
	if s.credits != nil && kind == KindSuper {
		// lockA/lockB are the canonical pair computed for the advisory lock above.
		if err := s.credits.Consume(ctx, fromUserID, "super_like",
			"connect:superlike:"+lockA+":"+lockB, 1, "super_like"); err != nil {
			return nil, ErrNeedsCredits
		}
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
