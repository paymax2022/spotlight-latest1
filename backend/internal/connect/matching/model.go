// Package connectmatching implements Paymax Connect Phase-1 likes/super-likes and
// the mutual-only match state machine. Two safety invariants are load-bearing:
//   - Likes are IDEMPOTENT — a UNIQUE(from_profile,to_profile) constraint plus an
//     ON CONFLICT upsert means a double-submit never double-applies.
//   - Matches are MUTUAL-ONLY — a connect_matches row is created strictly when both
//     directions of the like exist, inside the same transaction as the like.
//
// See docs/prd/dating/{data-model.md, architecture.md §26.5, acceptance.md §Phase 1}.
package connectmatching

import "time"

// Like kinds — MUST match the connect_likes.kind CHECK constraint.
const (
	KindLike  = "like"
	KindSuper = "super"
)

// ValidKind reports whether k is a known like kind.
func ValidKind(k string) bool { return k == KindLike || k == KindSuper }

// LikeResult is returned from recording a like.
type LikeResult struct {
	Liked    bool   `json:"liked"`   // the like is recorded (idempotent)
	Matched  bool   `json:"matched"` // a mutual match exists / was just created
	MatchID  string `json:"match_id,omitempty"`
	Kind     string `json:"kind"`
	Replayed bool   `json:"replayed"` // true when this was a duplicate (no-op) submit
}

// Match is a participant-facing view of a connect_matches row.
type Match struct {
	ID           string         `json:"id"`
	OtherProfile string         `json:"other_profile_id"`
	OtherUserID  string         `json:"other_user_id,omitempty"`
	OtherName    *string        `json:"other_display_name,omitempty"`
	Status       string         `json:"status"`
	Reason       map[string]any `json:"reason,omitempty"` // match-reason card
	MatchedAt    time.Time      `json:"matched_at"`
}

// LikeRequest is the member body for POST /likes. The actor is the authenticated
// user, resolved to their profile server-side — never taken from the body.
type LikeRequest struct {
	ToProfile string `json:"to_profile" binding:"required"`
	Kind      string `json:"kind"` // "like" (default) | "super"
}
