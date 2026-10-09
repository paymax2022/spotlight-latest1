package connectfeed

import (
	"context"
	"errors"
	"math"
	"net/http"
	"sort"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/ptr"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

const keyError = "error"

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
	var authorID string
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
// Feed returns the main ranked feed for `viewerID`. Posts by users the viewer has
// blocked (or who blocked the viewer) are excluded — PN-011 / safety invariant 3.
func (s *Service) Feed(ctx context.Context, viewerID string, limit int) ([]FeedItem, error) {
	return s.rankedFeed(ctx, viewerID, "", limit)
}

// HashtagFeed returns the ranked feed filtered to a single hashtag/topic (PN-3),
// block-filtered for `viewerID` (PN-011 / safety invariant 3).
func (s *Service) HashtagFeed(ctx context.Context, viewerID, tag string, limit int) ([]FeedItem, error) {
	tag = normalizeTag(tag)
	if tag == "" {
		return nil, ErrInvalidInput
	}
	return s.rankedFeed(ctx, viewerID, tag, limit)
}

func (s *Service) rankedFeed(ctx context.Context, viewerID, tag string, limit int) ([]FeedItem, error) {
	if limit <= 0 || limit > maxFeedLimit {
		limit = defaultFeedLimit
	}
	cands, err := s.repo.FeedCandidates(ctx, viewerID, tag, limit)
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

// Reaction toggle decisions — pure, so the "one reaction per user/post" invariant
// is unit-testable without a database. The DB UNIQUE(post_id,user_id) constraint is
// the hard guarantee; this function decides which single-row mutation to apply so
// that at most one row can ever exist for a (post,user) pair.
const (
	reactInsert = "insert" // no prior reaction → create one
	reactDelete = "delete" // same reaction again → toggle it off
	reactUpdate = "update" // different reaction → change the single row in place
)

func reactionAction(existing string, hasExisting bool, requested string) string {
	switch {
	case !hasExisting:
		return reactInsert
	case existing == requested:
		return reactDelete
	default:
		return reactUpdate
	}
}

// ThreadNode is a top-level comment with its direct replies (single-level threading,
// matching parent_comment_id). Pure projection of a flat comment list.
type ThreadNode struct {
	Comment

	Replies []Comment `json:"replies"`
}

// BuildThreads groups a flat, chronologically-ordered comment slice into threads:
// top-level comments (parent_comment_id == nil) with their replies attached in order.
// Replies whose parent is absent from the slice are treated as top-level (defensive).
func BuildThreads(comments []Comment) []ThreadNode {
	index := make(map[string]int) // comment id → position in nodes
	var nodes []ThreadNode

	// First pass: create nodes for top-level comments.
	for _, c := range comments {
		if c.ParentCommentID == nil {
			index[c.ID] = len(nodes)
			nodes = append(nodes, ThreadNode{Comment: c})
		}
	}
	// Second pass: attach replies to their parent (or promote orphans to top-level).
	for _, c := range comments {
		if c.ParentCommentID == nil {
			continue
		}
		if pos, ok := index[*c.ParentCommentID]; ok {
			nodes[pos].Replies = append(nodes[pos].Replies, c)
		} else {
			index[c.ID] = len(nodes)
			nodes = append(nodes, ThreadNode{Comment: c})
		}
	}
	return nodes
}

// Post is a feed post authored by a user or a company page.
type Post struct {
	ID                string    `json:"id"`
	AuthorType        string    `json:"authorType"` // user | company_page
	AuthorID          string    `json:"authorId"`
	Body              string    `json:"body"`
	MediaRefs         []string  `json:"mediaRefs"`
	Hashtags          []string  `json:"hashtags"`
	ReshareOfPostID   *string   `json:"reshareOfPostId,omitempty"`
	LinkedOutcomeType *string   `json:"linkedOutcomeType,omitempty"` // booking | mentorship | assessment
	Visible           bool      `json:"visible"`
	CreatedAt         time.Time `json:"createdAt"`

	// Aggregates (populated on read paths).
	ReactionCount int `json:"reactionCount"`
	CommentCount  int `json:"commentCount"`
	ReshareCount  int `json:"reshareCount"`
}

// FeedItem is a ranked post plus the score the ranker assigned. The individual
// verified-outcome signal flags are NOT exposed (PN-1: no public trust numbers) —
// only the opaque rank score is returned for debugging/ordering.
type FeedItem struct {
	Post

	Score float64 `json:"score"`
}

// Reaction is a single reactor's reaction to a post (one per user/post).
type Reaction struct {
	ID           string    `json:"id"`
	PostID       string    `json:"postId"`
	UserID       string    `json:"userId"`
	ReactionType string    `json:"reactionType"`
	CreatedAt    time.Time `json:"createdAt"`
}

// ReactResult reports the outcome of a react toggle.
type ReactResult struct {
	PostID        string `json:"postId"`
	ReactionType  string `json:"reactionType,omitempty"`
	Reacted       bool   `json:"reacted"` // false = toggled off / removed
	ReactionCount int    `json:"reactionCount"`
}

// Comment is a (optionally threaded) comment on a post.
type Comment struct {
	ID              string    `json:"id"`
	PostID          string    `json:"postId"`
	AuthorUserID    string    `json:"authorUserId"`
	Body            string    `json:"body"`
	ParentCommentID *string   `json:"parentCommentId,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
}

// ComposePostInput is the compose-post request body.
type ComposePostInput struct {
	AuthorType        string   `json:"authorType"` // defaults to "user"
	AuthorID          string   `json:"authorId"`   // for company_page authorship
	Body              string   `json:"body"`
	MediaRefs         []string `json:"mediaRefs"`
	Hashtags          []string `json:"hashtags"`
	ReshareOfPostID   *string  `json:"reshareOfPostId"`
	LinkedOutcomeType *string  `json:"linkedOutcomeType"`
	LinkedOutcomeRef  *string  `json:"linkedOutcomeRef"`
}

// ReactInput is the react request body.
type ReactInput struct {
	ReactionType string `json:"reactionType"`
}

// CommentInput is the add-comment request body.
type CommentInput struct {
	Body            string  `json:"body"`
	ParentCommentID *string `json:"parentCommentId"`
}

// ModerationInput is the admin content-moderation request (ADM-CN-01).
type ModerationInput struct {
	Visible bool   `json:"visible"`
	Reason  string `json:"reason"`
}

// RankSignals is the full set of ranking inputs for a single post. It is the ONLY
// input to RankScore — a pure, deterministic function — so PN-3 is unit-testable.
type RankSignals struct {
	// Raw engagement (must NEVER be the sole ranking input, PN-3).
	ReactionCount int
	CommentCount  int
	ReshareCount  int

	// Verified-outcome signals (the PN-3 primary weight).
	AuthorVerified         bool // Connect professional verification (verified badge)
	AuthorPassedAssessment bool // author has a passed, timestamped skill assessment (PN-5)
	LinksCompletedOutcome  bool // post links to a completed booking/mentorship

	// Recency (minor tiebreaker only; bounded well below one engagement unit-band).
	AgeHours float64
}

// Ranking weights. PN-3 REQUIRES verified-outcome weight >= engagement weight.
// The score is banded so the invariant is *structural*, not coincidental:
//
//	verifiedTier  = #{authorVerified, passedAssessment, linksOutcome}   // 0..3
//
// Because engagement is capped at EngagementCap and recency <= WeightRecency, and
// BandVerifiedOutcome > EngagementCap + WeightRecency, a post with even ONE verified
// signal (verifiedTier >= 1) always outranks a post with ZERO verified signals no
// matter how large its engagement. That is exactly PN-3: "raw engagement volume
// alone must never be a ranking input", and each verified weight (BandVerifiedOutcome)
// dominates the entire engagement weight range.
const (
	WeightReaction = 1.0
	WeightComment  = 2.0 // a comment is heavier signal than a like
	WeightReshare  = 3.0 // a reshare is the heaviest engagement signal

	// EngagementCap saturates raw engagement so it can never cross a verified band.
	EngagementCap = 10000.0

	// BandVerifiedOutcome is the per-signal verified weight. It is strictly greater
	// than the entire engagement range (EngagementCap + WeightRecency), which is what
	// makes verified outcomes weigh >= engagement (PN-3).
	BandVerifiedOutcome = 100000.0

	WeightRecency        = 500.0 // < EngagementCap: recency is only a tiebreaker
	RecencyHalfLifeHours = 48.0
)

// RankScore computes a post's feed score from its signals. PURE: no I/O, no clock,
// no globals — deterministic in its input. This is the single source of truth the
// PN-3 tests assert against.
func RankScore(s RankSignals) float64 {
	engagementRaw := WeightReaction*float64(s.ReactionCount) +
		WeightComment*float64(s.CommentCount) +
		WeightReshare*float64(s.ReshareCount)
	engagement := math.Min(engagementRaw, EngagementCap)

	age := s.AgeHours
	if age < 0 {
		age = 0
	}
	recency := WeightRecency * math.Pow(0.5, age/RecencyHalfLifeHours)

	verifiedTier := 0.0
	if s.AuthorVerified {
		verifiedTier++
	}
	if s.AuthorPassedAssessment {
		verifiedTier++
	}
	if s.LinksCompletedOutcome {
		verifiedTier++
	}

	return verifiedTier*BandVerifiedOutcome + engagement + recency
}

// VerifiedWeight and EngagementWeight expose the two weight regimes so PN-3 can be
// asserted directly: a single verified signal must weigh at least as much as the
// entire engagement contribution.
func VerifiedWeight() float64   { return BandVerifiedOutcome }
func EngagementWeight() float64 { return EngagementCap }

// rankable pairs a post with its precomputed signals for sorting.
type rankable struct {
	item    FeedItem
	signals RankSignals
}

// RankFeed sorts posts by descending RankScore (verified outcomes first, PN-3),
// stamping each returned item's Score. Ties break by recency then id for stability.
func RankFeed(items []rankable) []FeedItem {
	sort.SliceStable(items, func(i, j int) bool {
		si, sj := RankScore(items[i].signals), RankScore(items[j].signals)
		if si != sj {
			return si > sj
		}
		return items[i].item.CreatedAt.After(items[j].item.CreatedAt)
	})
	out := make([]FeedItem, len(items))
	for i := range items {
		it := items[i].item
		it.Score = RankScore(items[i].signals)
		out[i] = it
	}
	return out
}

// Handler exposes the content/feed endpoints over HTTP.
type Handler struct{ svc *Service }

// NewHandler builds a feed handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
	case errors.Is(err, ErrMissingIdem):
		c.JSON(http.StatusBadRequest, gin.H{keyError: "Idempotency-Key header required"})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

// Compose — POST /networking/posts (member, Idempotency-Key required).
func (h *Handler) Compose(c *gin.Context) {
	var in ComposePostInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	p, err := h.svc.Compose(c.Request.Context(), ginutil.UserID(c), ginutil.IdempotencyKey(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": p})
}

// PostDetail — GET /networking/posts/:id (member).
func (h *Handler) PostDetail(c *gin.Context) {
	p, err := h.svc.Post(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	comments, err := h.svc.Comments(c.Request.Context(), p.ID)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"post": p, "comments": comments}})
}

// React — POST /networking/posts/:id/reactions (member, Idempotency-Key required).
func (h *Handler) React(c *gin.Context) {
	var in ReactInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	res, err := h.svc.React(c.Request.Context(), ginutil.UserID(c), ginutil.IdempotencyKey(c), c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

// Comment — POST /networking/posts/:id/comments (member, Idempotency-Key required).
func (h *Handler) Comment(c *gin.Context) {
	var in CommentInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	cm, err := h.svc.Comment(c.Request.Context(), ginutil.UserID(c), ginutil.IdempotencyKey(c), c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": cm})
}

// Feed — GET /networking/posts/feed?limit= (member). Main PN-3-ranked content
// feed. Namespaced under /posts so it does not collide with the people-discovery
// feed at /networking/feed (Phases 1–5), which returns profiles, not posts.
func (h *Handler) Feed(c *gin.Context) {
	out, err := h.svc.Feed(c.Request.Context(), ginutil.UserID(c), ptr.DerefZero(ginutil.IntParam(c, "limit")))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// HashtagFeed — GET /networking/topics/:tag?limit= (member). PN-3-ranked, filtered.
func (h *Handler) HashtagFeed(c *gin.Context) {
	out, err := h.svc.HashtagFeed(c.Request.Context(), ginutil.UserID(c), c.Param("tag"), ptr.DerefZero(ginutil.IntParam(c, "limit")))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Moderate — POST /networking/posts/:id/moderation (admin, ADM-CN-01).
func (h *Handler) Moderate(c *gin.Context) {
	var in ModerationInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	p, err := h.svc.Moderate(c.Request.Context(), ginutil.UserID(c), c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// Register wires the content/feed module onto the shared Connect member + admin
// groups. Member routes live under /networking; the admin content-moderation
// endpoint (ADM-CN-01) is gated by RequirePermission(rbac,"connect.moderation.manage").
func Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, audit Auditor) {
	svc := NewService(NewRepository(pool), audit)
	h := NewHandler(svc)

	g := member.Group("/networking")
	g.POST("/posts", h.Compose) // Idempotency-Key required
	g.GET("/posts/:id", h.PostDetail)
	g.POST("/posts/:id/reactions", h.React)  // Idempotency-Key required
	g.POST("/posts/:id/comments", h.Comment) // Idempotency-Key required
	g.GET("/posts/feed", h.Feed)             // main ranked CONTENT feed (PN-3); distinct from people-discovery /networking/feed
	g.GET("/topics/:tag", h.HashtagFeed)     // hashtag/topic feed (PN-3)

	ag := admin.Group("/networking")
	ag.POST("/posts/:id/moderation",
		middleware.RequirePermission(rbac, "connect.moderation.manage"), h.Moderate)
}
