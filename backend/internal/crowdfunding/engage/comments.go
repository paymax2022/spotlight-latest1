package engage

// Campaign comments and Q&A.
//
// The mobile screen and its API client existed long before any of this: it called
// four endpoints that were never built, so the page 404'd on load and the only
// comments anyone saw came from a mock array. The contract below is the one the
// client already expects (CampaignComment / CommentReply), not a new one.
//
// Two rules are enforced here rather than in the database, because both need to
// know about the campaign and neither is expressible as a column constraint:
//   - a reply may not itself be replied to (depth is capped at one, which is what
//     the feed shape assumes);
//   - only the campaign's creator may reply to a comment on it, which is what
//     makes the "Creator" badge on a reply mean something.

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const maxCommentBody = 2000

var (
	// ErrCommentNotFound is returned for a missing, deleted, or invisible comment.
	ErrCommentNotFound = errors.New("comment not found")
	// ErrCampaignNotFound keeps a comment on a non-existent campaign from looking
	// like a server fault.
	ErrCampaignNotFound = errors.New("campaign not found")
	// ErrEmptyBody rejects whitespace-only posts before they reach the CHECK.
	ErrEmptyBody = errors.New("comment body is required")
	// ErrBodyTooLong mirrors the column's own limit so the caller gets a 400 with a
	// reason rather than a constraint violation.
	ErrBodyTooLong = errors.New("comment body is too long")
	// ErrReplyToReply enforces the one-level depth the client renders.
	ErrReplyToReply = errors.New("a reply cannot be replied to")
	// ErrNotCampaignCreator gates replies to the campaign owner.
	ErrNotCampaignCreator = errors.New("only the campaign creator can reply")
	// ErrUnauthenticated is returned when the caller has no user id.
	ErrUnauthenticated = errors.New("authentication required")
)

// CommentReply matches the client CommentReply.
type CommentReply struct {
	ID         string `json:"id"`
	AuthorName string `json:"authorName"`
	Body       string `json:"body"`
	CreatedAt  string `json:"createdAt"`
	IsCreator  bool   `json:"isCreator"`
}

// CampaignComment matches the client CampaignComment.
type CampaignComment struct {
	ID         string         `json:"id"`
	CampaignID string         `json:"campaignId"`
	AuthorName string         `json:"authorName"`
	AvatarURL  *string        `json:"avatarUrl"`
	Body       string         `json:"body"`
	CreatedAt  string         `json:"createdAt"`
	IsQuestion bool           `json:"isQuestion"`
	IsCreator  bool           `json:"isCreator"`
	Reported   bool           `json:"reported"`
	Replies    []CommentReply `json:"replies"`
}

// PostCommentInput is the POST /campaigns/:id/comments body.
type PostCommentInput struct {
	Body       string `json:"body"`
	IsQuestion bool   `json:"isQuestion"`
}

// ReplyCommentInput is the POST /comments/:id/reply body.
type ReplyCommentInput struct {
	Body string `json:"body"`
}

func cleanBody(s string) (string, error) {
	b := strings.TrimSpace(s)
	if b == "" {
		return "", ErrEmptyBody
	}
	if len([]rune(b)) > maxCommentBody {
		return "", ErrBodyTooLong
	}
	return b, nil
}

// ListComments returns a campaign's top-level comments, newest first, each with
// its replies oldest-first (a conversation reads down).
//
// viewerID may be empty — the service tolerates it and returns the feed with
// `reported` false throughout. Note this is NOT the same as the endpoint being
// anonymous: these routes hang off the authenticated finance group, which rejects
// a request with no bearer token before the handler runs, exactly as the campaign
// detail does. The tolerance is here so the service stays usable if that ever
// changes, and so tests can exercise the viewer-less shape.
//
// `reported` means "YOU reported this", not "somebody did" — the screen uses it to
// show the flag as already pulled, and a global flag would leak one user's
// moderation action to everyone.
func (s *Service) ListComments(ctx context.Context, campaignID, viewerID string) ([]CampaignComment, error) {
	if _, err := uuid.Parse(campaignID); err != nil {
		return nil, ErrCampaignNotFound
	}
	var creatorID *string
	if err := s.db.QueryRow(ctx,
		`SELECT creator_id::text FROM campaigns WHERE id = $1 AND deleted_at IS NULL`, campaignID,
	).Scan(&creatorID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCampaignNotFound
		}
		return nil, err
	}

	// One query for the whole thread. The author name comes from auth.users the
	// same way service_discovery.go resolves a creator, and the LEFT JOIN on
	// reports is scoped to the viewer so the flag is per-person.
	const q = `
		SELECT c.id::text,
		       c.parent_id::text,
		       c.author_id::text,
		       COALESCE(u.raw_user_meta_data->>'full_name', u.email, 'Backer') AS author_name,
		       u.raw_user_meta_data->>'avatar_url' AS avatar_url,
		       c.body, c.is_question, c.created_at,
		       (r.id IS NOT NULL) AS reported
		  FROM cf_campaign_comments c
		  LEFT JOIN auth.users u ON u.id = c.author_id
		  LEFT JOIN cf_comment_reports r ON r.comment_id = c.id AND r.reporter_id = NULLIF($2,'')::uuid
		 WHERE c.campaign_id = $1 AND c.deleted_at IS NULL
		 ORDER BY c.created_at DESC, c.id DESC`
	rows, err := s.db.Query(ctx, q, campaignID, viewerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type raw struct {
		id, parentID, authorID, name, body string
		avatar                             *string
		isQuestion, reported               bool
		createdAt                          time.Time
	}
	var all []raw
	for rows.Next() {
		var x raw
		var parent, author *string
		if err := rows.Scan(&x.id, &parent, &author, &x.name, &x.avatar, &x.body, &x.isQuestion, &x.createdAt, &x.reported); err != nil {
			return nil, err
		}
		if parent != nil {
			x.parentID = *parent
		}
		if author != nil {
			x.authorID = *author
		}
		all = append(all, x)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	isCreator := func(authorID string) bool {
		return creatorID != nil && authorID != "" && authorID == *creatorID
	}

	// Replies grouped by parent, restored to oldest-first: the feed query sorts
	// newest-first for the top level, but a reply thread reads in the order it
	// was written.
	repliesOf := map[string][]CommentReply{}
	for i := len(all) - 1; i >= 0; i-- {
		x := all[i]
		if x.parentID == "" {
			continue
		}
		repliesOf[x.parentID] = append(repliesOf[x.parentID], CommentReply{
			ID: x.id, AuthorName: x.name, Body: x.body,
			CreatedAt: rfc3339(x.createdAt), IsCreator: isCreator(x.authorID),
		})
	}

	// Never nil: the client maps over this, and `null` would crash an empty feed.
	out := make([]CampaignComment, 0, len(all))
	for _, x := range all {
		if x.parentID != "" {
			continue
		}
		replies := repliesOf[x.id]
		if replies == nil {
			replies = []CommentReply{}
		}
		out = append(out, CampaignComment{
			ID: x.id, CampaignID: campaignID, AuthorName: x.name, AvatarURL: x.avatar,
			Body: x.body, CreatedAt: rfc3339(x.createdAt), IsQuestion: x.isQuestion,
			IsCreator: isCreator(x.authorID), Reported: x.reported, Replies: replies,
		})
	}
	return out, nil
}

// PostComment adds a top-level comment (or question) to a campaign.
func (s *Service) PostComment(ctx context.Context, campaignID, authorID string, in PostCommentInput) (*CampaignComment, error) {
	if authorID == "" {
		return nil, ErrUnauthenticated
	}
	body, err := cleanBody(in.Body)
	if err != nil {
		return nil, err
	}
	if _, err := uuid.Parse(campaignID); err != nil {
		return nil, ErrCampaignNotFound
	}

	var creatorID string
	if err := s.db.QueryRow(ctx,
		`SELECT creator_id::text FROM campaigns WHERE id = $1 AND deleted_at IS NULL`, campaignID,
	).Scan(&creatorID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCampaignNotFound
		}
		return nil, err
	}

	var id string
	var createdAt time.Time
	if err := s.db.QueryRow(ctx, `
		INSERT INTO cf_campaign_comments (campaign_id, author_id, body, is_question)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, created_at`,
		campaignID, authorID, body, in.IsQuestion,
	).Scan(&id, &createdAt); err != nil {
		return nil, err
	}

	name, avatar := s.authorIdentity(ctx, authorID)
	return &CampaignComment{
		ID: id, CampaignID: campaignID, AuthorName: name, AvatarURL: avatar,
		Body: body, CreatedAt: rfc3339(createdAt), IsQuestion: in.IsQuestion,
		IsCreator: authorID == creatorID, Reported: false, Replies: []CommentReply{},
	}, nil
}

// ReplyComment appends a creator reply to a comment.
//
// Only the campaign's creator may reply. The screen renders replies with a
// "Creator" badge and no other affordance, so allowing anyone to reply would put
// a stranger's words behind the campaign owner's identity.
func (s *Service) ReplyComment(ctx context.Context, commentID, authorID string, in ReplyCommentInput) (*CommentReply, error) {
	if authorID == "" {
		return nil, ErrUnauthenticated
	}
	body, err := cleanBody(in.Body)
	if err != nil {
		return nil, err
	}
	if _, err := uuid.Parse(commentID); err != nil {
		return nil, ErrCommentNotFound
	}

	var campaignID, creatorID string
	var parentID *string
	if err := s.db.QueryRow(ctx, `
		SELECT c.campaign_id::text, c.parent_id::text, ca.creator_id::text
		  FROM cf_campaign_comments c
		  JOIN campaigns ca ON ca.id = c.campaign_id
		 WHERE c.id = $1 AND c.deleted_at IS NULL AND ca.deleted_at IS NULL`, commentID,
	).Scan(&campaignID, &parentID, &creatorID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCommentNotFound
		}
		return nil, err
	}
	if parentID != nil {
		return nil, ErrReplyToReply
	}
	if authorID != creatorID {
		return nil, ErrNotCampaignCreator
	}

	var id string
	var createdAt time.Time
	if err := s.db.QueryRow(ctx, `
		INSERT INTO cf_campaign_comments (campaign_id, parent_id, author_id, body, is_question)
		VALUES ($1, $2, $3, $4, false)
		RETURNING id::text, created_at`,
		campaignID, commentID, authorID, body,
	).Scan(&id, &createdAt); err != nil {
		return nil, err
	}
	name, _ := s.authorIdentity(ctx, authorID)
	return &CommentReply{ID: id, AuthorName: name, Body: body, CreatedAt: rfc3339(createdAt), IsCreator: true}, nil
}

// ReportComment flags a comment for moderation. Idempotent: reporting twice is
// the same as reporting once, which is what the unique index is for.
func (s *Service) ReportComment(ctx context.Context, commentID, reporterID string) error {
	if reporterID == "" {
		return ErrUnauthenticated
	}
	if _, err := uuid.Parse(commentID); err != nil {
		return ErrCommentNotFound
	}
	var exists bool
	if err := s.db.QueryRow(ctx,
		`SELECT true FROM cf_campaign_comments WHERE id = $1 AND deleted_at IS NULL`, commentID,
	).Scan(&exists); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrCommentNotFound
		}
		return err
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO cf_comment_reports (comment_id, reporter_id)
		VALUES ($1, $2)
		ON CONFLICT (comment_id, reporter_id) DO NOTHING`, commentID, reporterID)
	return err
}

// authorIdentity resolves a display name and avatar, tolerating a missing user
// row the same way service_discovery.go does.
func (s *Service) authorIdentity(ctx context.Context, userID string) (string, *string) {
	var name string
	var avatar *string
	if err := s.db.QueryRow(ctx, `
		SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'Backer'),
		       raw_user_meta_data->>'avatar_url'
		  FROM auth.users WHERE id = $1`, userID,
	).Scan(&name, &avatar); err != nil {
		return "Backer", nil
	}
	return name, avatar
}
