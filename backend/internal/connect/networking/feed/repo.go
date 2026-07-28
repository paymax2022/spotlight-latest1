package connectfeed

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository holds parameterized pgx queries for the content/feed tables.
type Repository struct{ db *pgxpool.Pool }

// NewRepository builds a feed repository over the service-role pgx pool.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

const postCols = `id, author_type, author_id, body, media_refs, hashtags,
	reshare_of_post_id, linked_outcome_type, visible, created_at`

func scanPost(row pgx.Row, p *Post) error {
	return row.Scan(&p.ID, &p.AuthorType, &p.AuthorID, &p.Body, &p.MediaRefs, &p.Hashtags,
		&p.ReshareOfPostID, &p.LinkedOutcomeType, &p.Visible, &p.CreatedAt)
}

// InsertPostIfNew composes a post idempotently on idempotency_key. A retried key
// returns the already-persisted post (no duplicate), so compose is safe to retry.
func (r *Repository) InsertPostIfNew(ctx context.Context, authorType, authorID, body string,
	media, hashtags []string, reshareOf, outcomeType, outcomeRef *string, idemKey string) (*Post, error) {

	const ins = `INSERT INTO connect_posts
		(author_type, author_id, body, media_refs, hashtags, reshare_of_post_id,
		 linked_outcome_type, linked_outcome_ref, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING ` + postCols
	p := &Post{}
	err := scanPost(r.db.QueryRow(ctx, ins, authorType, authorID, body, media, hashtags,
		reshareOf, outcomeType, outcomeRef, idemKey), p)
	if err == nil {
		return p, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("connect: insert post: %w", err)
	}
	// Key already used → return the existing post (idempotent replay).
	const sel = `SELECT ` + postCols + ` FROM connect_posts WHERE idempotency_key=$1`
	if err := scanPost(r.db.QueryRow(ctx, sel, idemKey), p); err != nil {
		return nil, fmt.Errorf("connect: load idempotent post: %w", err)
	}
	return p, nil
}

// GetPost loads a single post with its aggregate counts.
func (r *Repository) GetPost(ctx context.Context, id string) (*Post, error) {
	const q = `SELECT ` + postCols + `,
		(SELECT count(*) FROM connect_reactions x WHERE x.post_id=p.id),
		(SELECT count(*) FROM connect_comments  c WHERE c.post_id=p.id),
		(SELECT count(*) FROM connect_posts     s WHERE s.reshare_of_post_id=p.id)
		FROM connect_posts p WHERE p.id=$1`
	p := &Post{}
	err := r.db.QueryRow(ctx, q, id).Scan(&p.ID, &p.AuthorType, &p.AuthorID, &p.Body,
		&p.MediaRefs, &p.Hashtags, &p.ReshareOfPostID, &p.LinkedOutcomeType, &p.Visible,
		&p.CreatedAt, &p.ReactionCount, &p.CommentCount, &p.ReshareCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("connect: get post: %w", err)
	}
	return p, nil
}

// ToggleReaction applies react semantics with the UNIQUE(post_id,user_id) guarantee:
//   - no existing reaction        → insert (reacted=true)
//   - existing, same type         → delete (toggle off, reacted=false)
//   - existing, different type    → update reaction_type (reacted=true)
//
// Exactly one row can ever exist per (post,user).
func (r *Repository) ToggleReaction(ctx context.Context, postID, userID, reactionType string) (*ReactResult, error) {
	var existing string
	err := r.db.QueryRow(ctx,
		`SELECT reaction_type FROM connect_reactions WHERE post_id=$1 AND user_id=$2`,
		postID, userID).Scan(&existing)
	hasExisting := true
	if errors.Is(err, pgx.ErrNoRows) {
		hasExisting = false
	} else if err != nil {
		return nil, fmt.Errorf("connect: react lookup: %w", err)
	}

	switch reactionAction(existing, hasExisting, reactionType) {
	case reactInsert:
		if _, err := r.db.Exec(ctx,
			`INSERT INTO connect_reactions (post_id, user_id, reaction_type)
			 VALUES ($1,$2,$3)
			 ON CONFLICT (post_id, user_id) DO UPDATE SET reaction_type=EXCLUDED.reaction_type`,
			postID, userID, reactionType); err != nil {
			return nil, fmt.Errorf("connect: react insert: %w", err)
		}
		return r.reactResult(ctx, postID, reactionType, true)
	case reactDelete:
		if _, err := r.db.Exec(ctx,
			`DELETE FROM connect_reactions WHERE post_id=$1 AND user_id=$2`, postID, userID); err != nil {
			return nil, fmt.Errorf("connect: react toggle-off: %w", err)
		}
		return r.reactResult(ctx, postID, "", false)
	default: // reactUpdate
		if _, err := r.db.Exec(ctx,
			`UPDATE connect_reactions SET reaction_type=$3 WHERE post_id=$1 AND user_id=$2`,
			postID, userID, reactionType); err != nil {
			return nil, fmt.Errorf("connect: react update: %w", err)
		}
		return r.reactResult(ctx, postID, reactionType, true)
	}
}

func (r *Repository) reactResult(ctx context.Context, postID, reactionType string, reacted bool) (*ReactResult, error) {
	var count int
	if err := r.db.QueryRow(ctx,
		`SELECT count(*) FROM connect_reactions WHERE post_id=$1`, postID).Scan(&count); err != nil {
		return nil, fmt.Errorf("connect: react count: %w", err)
	}
	return &ReactResult{PostID: postID, ReactionType: reactionType, Reacted: reacted, ReactionCount: count}, nil
}

// InsertCommentIfNew adds a (optionally threaded) comment idempotently on idem key.
func (r *Repository) InsertCommentIfNew(ctx context.Context, postID, authorID, body string, parent *string, idemKey string) (*Comment, error) {
	const ins = `INSERT INTO connect_comments (post_id, author_user_id, body, parent_comment_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id, post_id, author_user_id, body, parent_comment_id, created_at`
	c := &Comment{}
	err := r.db.QueryRow(ctx, ins, postID, authorID, body, parent, idemKey).Scan(
		&c.ID, &c.PostID, &c.AuthorUserID, &c.Body, &c.ParentCommentID, &c.CreatedAt)
	if err == nil {
		return c, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("connect: insert comment: %w", err)
	}
	const sel = `SELECT id, post_id, author_user_id, body, parent_comment_id, created_at
		FROM connect_comments WHERE idempotency_key=$1`
	if err := r.db.QueryRow(ctx, sel, idemKey).Scan(
		&c.ID, &c.PostID, &c.AuthorUserID, &c.Body, &c.ParentCommentID, &c.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: load idempotent comment: %w", err)
	}
	return c, nil
}

// PostExists reports whether a post id exists (used to validate parent/target).
func (r *Repository) PostExists(ctx context.Context, id string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM connect_posts WHERE id=$1)`, id).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("connect: post exists: %w", err)
	}
	return ok, nil
}

// ListComments returns a post's comments in thread order (parents before replies).
func (r *Repository) ListComments(ctx context.Context, postID string) ([]Comment, error) {
	const q = `SELECT id, post_id, author_user_id, body, parent_comment_id, created_at
		FROM connect_comments WHERE post_id=$1
		ORDER BY COALESCE(parent_comment_id, id), created_at`
	rows, err := r.db.Query(ctx, q, postID)
	if err != nil {
		return nil, fmt.Errorf("connect: list comments: %w", err)
	}
	defer rows.Close()
	var out []Comment
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.PostID, &c.AuthorUserID, &c.Body, &c.ParentCommentID, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// SetVisible flips a post's visibility (admin moderation, ADM-CN-01).
func (r *Repository) SetVisible(ctx context.Context, postID string, visible bool) (bool, error) {
	ct, err := r.db.Exec(ctx, `UPDATE connect_posts SET visible=$2 WHERE id=$1`, postID, visible)
	if err != nil {
		return false, fmt.Errorf("connect: set visible: %w", err)
	}
	return ct.RowsAffected() == 1, nil
}

// FeedCandidates returns up to `limit` visible posts with their aggregate counts and
// verified-outcome signals, DB-ordered by a score that ALREADY weights verified
// outcomes above raw engagement (PN-3). The exact ranking is re-applied in Go via
// the pure RankScore; this query narrows the candidate set and mirrors the formula.
//
//	verifiedTier = author_verified + author_passed_assessment + links_completed_outcome
//	rank_score   = verifiedTier * BandVerifiedOutcome
//	             + LEAST(reactions*1 + comments*2 + reshares*3, EngagementCap)
//
// If `hashtag` is non-empty the feed is filtered to posts carrying that tag.
func (r *Repository) FeedCandidates(ctx context.Context, hashtag string, limit int) ([]rankable, error) {
	const q = `
WITH base AS (
  SELECT p.id, p.author_type, p.author_id, p.body, p.media_refs, p.hashtags,
         p.reshare_of_post_id, p.linked_outcome_type, p.visible, p.created_at,
         (SELECT count(*) FROM connect_reactions x WHERE x.post_id=p.id) AS reactions,
         (SELECT count(*) FROM connect_comments  c WHERE c.post_id=p.id) AS comments,
         (SELECT count(*) FROM connect_posts     s WHERE s.reshare_of_post_id=p.id) AS reshares,
         COALESCE(pp.verification_status = 'verified', false)      AS author_verified,
         COALESCE(sig.has_passed_assessment, false)               AS author_assessment,
         (p.linked_outcome_type IS NOT NULL)                      AS links_outcome,
         EXTRACT(EPOCH FROM (now() - p.created_at)) / 3600.0       AS age_hours
  FROM connect_posts p
  LEFT JOIN connect_professional_profiles pp
         ON p.author_type = 'user' AND pp.user_id = p.author_id
  LEFT JOIN connect_author_signals sig
         ON sig.user_id = p.author_id
  WHERE p.visible = true
    AND ($1 = '' OR p.hashtags @> ARRAY[$1]::text[])
)
SELECT id, author_type, author_id, body, media_refs, hashtags, reshare_of_post_id,
       linked_outcome_type, visible, created_at, reactions, comments, reshares,
       author_verified, author_assessment, links_outcome, age_hours,
       ( ((author_verified::int + author_assessment::int + links_outcome::int) * 100000.0)
         + LEAST(reactions*1 + comments*2 + reshares*3, 10000) ) AS rank_score
FROM base
ORDER BY rank_score DESC, created_at DESC
LIMIT $2`
	rows, err := r.db.Query(ctx, q, hashtag, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: feed candidates: %w", err)
	}
	defer rows.Close()

	var out []rankable
	for rows.Next() {
		var (
			p         Post
			sig       RankSignals
			ageHours  float64
			rankScore float64
			verified  bool
			assessed  bool
			outcome   bool
		)
		if err := rows.Scan(&p.ID, &p.AuthorType, &p.AuthorID, &p.Body, &p.MediaRefs,
			&p.Hashtags, &p.ReshareOfPostID, &p.LinkedOutcomeType, &p.Visible, &p.CreatedAt,
			&p.ReactionCount, &p.CommentCount, &p.ReshareCount,
			&verified, &assessed, &outcome, &ageHours, &rankScore); err != nil {
			return nil, err
		}
		sig = RankSignals{
			ReactionCount:          p.ReactionCount,
			CommentCount:           p.CommentCount,
			ReshareCount:           p.ReshareCount,
			AuthorVerified:         verified,
			AuthorPassedAssessment: assessed,
			LinksCompletedOutcome:  outcome,
			AgeHours:               ageHours,
		}
		out = append(out, rankable{item: FeedItem{Post: p}, signals: sig})
	}
	return out, rows.Err()
}
