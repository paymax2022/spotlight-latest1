package connectfeed

import (
	"context"
	"errors"
	"strings"
)

var (
	ErrNotFound     = errors.New("connect: post not found")
	ErrInvalidInput = errors.New("connect: invalid input")
	ErrMissingIdem  = errors.New("connect: Idempotency-Key required")
)

// Auditor records mutation audit events (mirrors the per-package Connect interface).
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// Service owns the content/feed logic: compose, react, comment, and PN-3 ranking.
type Service struct {
	repo  *Repository
	audit Auditor
}

// NewService builds the feed service.
func NewService(repo *Repository, audit Auditor) *Service {
	return &Service{repo: repo, audit: audit}
}

const defaultFeedLimit = 50
const maxFeedLimit = 200

// Compose creates a post. Requires an Idempotency-Key (retry-safe). By default the
// author is the calling user; company_page authorship must name an authorId.
func (s *Service) Compose(ctx context.Context, userID, idemKey string, in ComposePostInput) (*Post, error) {
	if idemKey == "" {
		return nil, ErrMissingIdem
	}
	authorType := in.AuthorType
	if authorType == "" {
		authorType = "user"
	}
	authorID := userID
	switch authorType {
	case "user":
		authorID = userID
	case "company_page":
		if in.AuthorID == "" {
			return nil, ErrInvalidInput
		}
		authorID = in.AuthorID
	default:
		return nil, ErrInvalidInput
	}
	body := strings.TrimSpace(in.Body)
	if body == "" && len(in.MediaRefs) == 0 && in.ReshareOfPostID == nil {
		return nil, ErrInvalidInput // a post must carry text, media, or a reshare
	}
	if in.LinkedOutcomeType != nil {
		switch *in.LinkedOutcomeType {
		case "booking", "mentorship", "assessment":
		default:
			return nil, ErrInvalidInput
		}
	}
	media := in.MediaRefs
	if media == nil {
		media = []string{}
	}
	tags := normalizeHashtags(in.Hashtags)

	p, err := s.repo.InsertPostIfNew(ctx, authorType, authorID, body, media, tags,
		in.ReshareOfPostID, in.LinkedOutcomeType, in.LinkedOutcomeRef, idemKey)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.feed.post.compose", userID, "connect_post", p.ID,
		map[string]any{"authorType": authorType, "hashtags": tags})
	return p, nil
}

// Post returns a single post with its counts.
func (s *Service) Post(ctx context.Context, id string) (*Post, error) {
	return s.repo.GetPost(ctx, id)
}

// React toggles the caller's reaction on a post (one per user/post). Requires an
// Idempotency-Key. Reacting with the same type again removes it (toggle off).
func (s *Service) React(ctx context.Context, userID, idemKey, postID string, in ReactInput) (*ReactResult, error) {
	if idemKey == "" {
		return nil, ErrMissingIdem
	}
	rt := in.ReactionType
	if rt == "" {
		rt = "like"
	}
	switch rt {
	case "like", "celebrate", "support", "insightful", "curious":
	default:
		return nil, ErrInvalidInput
	}
	ok, err := s.repo.PostExists(ctx, postID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	res, err := s.repo.ToggleReaction(ctx, postID, userID, rt)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.feed.react", userID, "connect_post", postID,
		map[string]any{"reactionType": rt, "reacted": res.Reacted})
	return res, nil
}

// Comment adds a (optionally threaded) comment. Requires an Idempotency-Key.
func (s *Service) Comment(ctx context.Context, userID, idemKey, postID string, in CommentInput) (*Comment, error) {
	if idemKey == "" {
		return nil, ErrMissingIdem
	}
	body := strings.TrimSpace(in.Body)
	if body == "" {
		return nil, ErrInvalidInput
	}
	ok, err := s.repo.PostExists(ctx, postID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	c, err := s.repo.InsertCommentIfNew(ctx, postID, userID, body, in.ParentCommentID, idemKey)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.feed.comment", userID, "connect_post", postID,
		map[string]any{"commentId": c.ID, "threaded": in.ParentCommentID != nil})
	return c, nil
}

// Comments lists a post's comments in thread order.
func (s *Service) Comments(ctx context.Context, postID string) ([]Comment, error) {
	return s.repo.ListComments(ctx, postID)
}

// Feed returns the main ranked feed. Ranking applies the PURE RankScore (PN-3):
// verified outcomes weigh at least as heavily as raw engagement.
func (s *Service) Feed(ctx context.Context, limit int) ([]FeedItem, error) {
	return s.rankedFeed(ctx, "", limit)
}

// HashtagFeed returns the ranked feed filtered to a single hashtag/topic (PN-3).
func (s *Service) HashtagFeed(ctx context.Context, tag string, limit int) ([]FeedItem, error) {
	tag = normalizeTag(tag)
	if tag == "" {
		return nil, ErrInvalidInput
	}
	return s.rankedFeed(ctx, tag, limit)
}

func (s *Service) rankedFeed(ctx context.Context, tag string, limit int) ([]FeedItem, error) {
	if limit <= 0 || limit > maxFeedLimit {
		limit = defaultFeedLimit
	}
	cands, err := s.repo.FeedCandidates(ctx, tag, limit)
	if err != nil {
		return nil, err
	}
	// Authoritative ordering by the pure, PN-3-tested RankScore.
	return RankFeed(cands), nil
}

// Moderate hides/unhides a post (admin content moderation, ADM-CN-01). Audited.
func (s *Service) Moderate(ctx context.Context, actorID, postID string, in ModerationInput) (*Post, error) {
	ok, err := s.repo.SetVisible(ctx, postID, in.Visible)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	_ = s.audit.WriteAudit(ctx, "connect.feed.post.moderate", actorID, "connect_post", postID,
		map[string]any{"visible": in.Visible, "reason": in.Reason})
	return s.repo.GetPost(ctx, postID)
}

// --- helpers ---

func normalizeHashtags(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, t := range in {
		t = normalizeTag(t)
		if t == "" {
			continue
		}
		if _, dup := seen[t]; dup {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	return out
}

func normalizeTag(t string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(t), "#")))
}
