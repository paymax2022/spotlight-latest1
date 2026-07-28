// Package connectfeed implements Paymax Connect Phase 6B — the professional-network
// Content / Feed layer: posts, reactions, comments and a PN-3-compliant ranked feed.
//
// INVARIANT PN-3 (docs/connect/PAYMAX-CONNECT-PHASE6-PROFESSIONAL-NETWORK.md §7):
// feed ranking MUST weight VERIFIED OUTCOMES (author verified, author passed a skill
// assessment, post links to a completed booking/mentorship) at least as heavily as
// raw engagement (reaction/comment/reshare counts). Raw engagement volume alone is
// NEVER the sole ranking input. The scoring function (RankScore, ranking.go) is PURE
// and unit-tested so PN-3 is asserted, not merely code-reviewed.
package connectfeed

import "time"

// Post is a feed post authored by a user or a company page.
type Post struct {
	ID               string    `json:"id"`
	AuthorType       string    `json:"authorType"` // user | company_page
	AuthorID         string    `json:"authorId"`
	Body             string    `json:"body"`
	MediaRefs        []string  `json:"mediaRefs"`
	Hashtags         []string  `json:"hashtags"`
	ReshareOfPostID  *string   `json:"reshareOfPostId,omitempty"`
	LinkedOutcomeType *string  `json:"linkedOutcomeType,omitempty"` // booking | mentorship | assessment
	Visible          bool      `json:"visible"`
	CreatedAt        time.Time `json:"createdAt"`

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

// --- Request DTOs (camelCase to match mobile networking/api.ts) ---

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
