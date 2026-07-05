// Package connectlive implements Paymax Connect live streaming (PRD §6.2):
// 1:many live sessions, co-host invites, PK battles, low-bandwidth/mod controls
// and an RTC-token issuance interface (provider secrets are read from config —
// NEVER hard-coded here). It owns its own tables (connect_live_*) and reuses the
// existing Connect auth + RBAC groups and the pgx pool. No money path is involved.
package connectlive

import "time"

// Session lifecycle states (guarded transitions; deny-by-default in the service).
const (
	StatusScheduled  = "scheduled"
	StatusLive       = "live"
	StatusEnded      = "ended"
	StatusTerminated = "terminated"
)

// Participant roles + states.
const (
	RoleHost     = "host"
	RoleCohost   = "cohost"
	RoleViewer   = "viewer"
	StateActive  = "active"
	StateMuted   = "muted"
	StateKicked  = "kicked"
	StateLeft    = "left"
	StateInvited = "invited"
)

// Session is a single live broadcast (1:many) owned by a host.
type Session struct {
	ID           string     `json:"id"`
	HostID       string     `json:"host_id"`
	Title        string     `json:"title"`
	Topic        string     `json:"topic,omitempty"`
	Status       string     `json:"status"`
	LowBandwidth bool       `json:"low_bandwidth"`
	ViewerCount  int        `json:"viewer_count"`
	MaxCohosts   int        `json:"max_cohosts"`
	StartedAt    *time.Time `json:"started_at,omitempty"`
	EndedAt      *time.Time `json:"ended_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

// Participant is a viewer/co-host attached to a session.
type Participant struct {
	ID        string     `json:"id"`
	SessionID string     `json:"session_id"`
	UserID    string     `json:"user_id"`
	Role      string     `json:"role"`
	State     string     `json:"state"`
	JoinedAt  *time.Time `json:"joined_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// PKBattle is a head-to-head scoring contest between this session's host and a
// challenger session (PRD §6.2 PK battles). Scores are non-cash counters.
type PKBattle struct {
	ID            string     `json:"id"`
	SessionID     string     `json:"session_id"`
	OpponentID    string     `json:"opponent_session_id"`
	Status        string     `json:"status"`
	HostScore     int64      `json:"host_score"`
	OpponentScore int64      `json:"opponent_score"`
	StartedAt     time.Time  `json:"started_at"`
	EndedAt       *time.Time `json:"ended_at,omitempty"`
}

// RTCToken is the credential a client uses to join the realtime media channel.
// The token itself is minted by an RTCTokenIssuer implementation that reads its
// provider secret from config — this struct never carries the secret.
type RTCToken struct {
	SessionID string    `json:"session_id"`
	UserID    string    `json:"user_id"`
	Channel   string    `json:"channel"`
	Role      string    `json:"role"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

// --- Request DTOs ---

type CreateSessionInput struct {
	Title        string `json:"title" binding:"required"`
	Topic        string `json:"topic"`
	LowBandwidth bool   `json:"low_bandwidth"`
}

type CohostInput struct {
	UserID string `json:"user_id" binding:"required"`
	Accept *bool  `json:"accept"` // nil/absent = invite; true/false = invitee response
}

type PKInput struct {
	OpponentSessionID string `json:"opponent_session_id" binding:"required"`
	// Score is an optional non-cash increment for the issuing side ("host"|"opponent").
	Side  string `json:"side"`
	Delta int64  `json:"delta"`
}

type ModerateInput struct {
	TargetUserID string `json:"target_user_id" binding:"required"`
	Action       string `json:"action" binding:"required"` // mute | unmute | kick
}
