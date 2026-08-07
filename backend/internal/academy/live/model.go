// Package live is the Spotlight Academy Phase-3 live + community + moderation
// sub-package: scheduled/live tutor classes (streamed via an INJECTED room
// provider), moderated study groups + Q&A discussions, and a report → moderation
// queue.
//
// GOLDEN RULES enforced here (docs/prd/edtech state-machines.md, nfr.md
// child-safety, paymax-rails.md streaming):
//   - Guarded live-session state machine: scheduled→live→ended (+ scheduled→
//     cancelled). Illegal transitions are rejected AND audited.
//   - Streaming goes through an INJECTED LiveRoomProvider — NO vendor type ever
//     leaks into this package. A nil provider degrades to a deterministic stub
//     (never a fabricated real stream).
//   - Community is MODERATED: discussions can be hidden; any user can report
//     content into the moderation queue; a moderator decides hide/warn/ban/none.
//   - CHILD-SAFETY (nfr.md): NO open 1:1 messaging for minors. Community here is
//     group / subject / session Q&A only — there is no DM channel. PostDiscussion
//     rejects a minor author whose scope is anything other than the allowed
//     group/subject/session scopes (defence in depth against a future DM scope).
//   - Everything mutating is written to the existing public.audit_logs table with
//     module = "academy.live".
//
// Tables owned (match supabase/migrations/20260815001200_academy_credentials_live.sql
// EXACTLY): academy_live_sessions, academy_live_participants, academy_study_groups,
// academy_group_members, academy_discussions, academy_moderation_reports.
package live

import "time"

// ── Live-session lifecycle ─────────────────────────────────────────────────────

// SessionState mirrors academy_live_sessions.state CHECK.
type SessionState string

const (
	SessionScheduled SessionState = "scheduled"
	SessionLive      SessionState = "live"
	SessionEnded     SessionState = "ended"
	SessionCancelled SessionState = "cancelled"
)

// LiveSession is one academy_live_sessions row.
type LiveSession struct {
	ID          string       `json:"id"`
	HostID      string       `json:"host_id"`
	Title       string       `json:"title"`
	TradeTrack  *string      `json:"trade_track,omitempty"`
	SubjectID   *string      `json:"subject_id,omitempty"`
	ScheduledAt *time.Time   `json:"scheduled_at,omitempty"`
	State       SessionState `json:"state"`
	RoomRef     *string      `json:"room_ref,omitempty"`
	ReplayRef   *string      `json:"replay_ref,omitempty"`
	CreatedAt   time.Time    `json:"created_at"`
}

// ParticipantRole mirrors academy_live_participants.role CHECK.
type ParticipantRole string

const (
	RoleHost     ParticipantRole = "host"
	RoleAttendee ParticipantRole = "attendee"
)

// Participant is one academy_live_participants row.
type Participant struct {
	ID        string          `json:"id"`
	SessionID string          `json:"session_id"`
	UserID    string          `json:"user_id"`
	Role      ParticipantRole `json:"role"`
	JoinedAt  time.Time       `json:"joined_at"`
	LeftAt    *time.Time      `json:"left_at,omitempty"`
}

// ── Community ───────────────────────────────────────────────────────────────────

// Discussion scope values (academy_discussions.scope). These are the ONLY scopes a
// discussion may carry — there is intentionally no "dm" / "direct" / "1:1" scope:
// child-safety forbids open DMs (nfr.md). See isAllowedScope / isDMScope.
const (
	ScopeSubject = "subject"
	ScopeGroup   = "group"
	ScopeSession = "session"
)

// StudyGroup is one academy_study_groups row.
type StudyGroup struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Scope     *string        `json:"scope,omitempty"`
	ScopeRef  *string        `json:"scope_ref,omitempty"`
	OwnerID   string         `json:"owner_id"`
	Goal      map[string]any `json:"goal"`
	CreatedAt time.Time      `json:"created_at"`
}

// GroupMember is one academy_group_members row (PK group_id, user_id).
type GroupMember struct {
	GroupID  string    `json:"group_id"`
	UserID   string    `json:"user_id"`
	JoinedAt time.Time `json:"joined_at"`
}

// DiscussionState mirrors academy_discussions.state CHECK.
type DiscussionState string

const (
	DiscussionVisible DiscussionState = "visible"
	DiscussionHidden  DiscussionState = "hidden"
)

// Discussion is one academy_discussions row.
type Discussion struct {
	ID        string          `json:"id"`
	Scope     string          `json:"scope"`
	RefID     string          `json:"ref_id"`
	UserID    string          `json:"user_id"`
	Body      string          `json:"body"`
	ParentID  *string         `json:"parent_id,omitempty"`
	State     DiscussionState `json:"state"`
	CreatedAt time.Time       `json:"created_at"`
}

// ── Moderation ──────────────────────────────────────────────────────────────────

// ReportState mirrors academy_moderation_reports.state CHECK.
type ReportState string

const (
	ReportPending   ReportState = "pending"
	ReportActioned  ReportState = "actioned"
	ReportDismissed ReportState = "dismissed"
	// ReportTriaged / ReportEscalated are the intermediate moderation-workflow states
	// reached via the triage / escalate transitions (siblings of decide). NOTE: the
	// academy_moderation_reports.state CHECK currently permits only
	// pending|actioned|dismissed — persisting these two requires an additive migration
	// widening that CHECK (see academy_routes report / handler.go).
	ReportTriaged   ReportState = "triaged"
	ReportEscalated ReportState = "escalated"
)

// Moderation actions written to academy_moderation_reports.action.
const (
	ActionHide = "hide"
	ActionWarn = "warn"
	ActionBan  = "ban"
	ActionNone = "none"
)

// ModerationReport is one academy_moderation_reports row.
type ModerationReport struct {
	ID          string      `json:"id"`
	EntityType  string      `json:"entity_type"`
	EntityID    string      `json:"entity_id"`
	ReporterID  *string     `json:"reporter_id,omitempty"`
	Reason      string      `json:"reason"`
	State       ReportState `json:"state"`
	Action      *string     `json:"action,omitempty"`
	ModeratorID *string     `json:"moderator_id,omitempty"`
	CreatedAt   time.Time   `json:"created_at"`
	DecidedAt   *time.Time  `json:"decided_at,omitempty"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// ScheduleSessionRequest — admin POST /live/sessions (host = tutor/staff).
type ScheduleSessionRequest struct {
	Title       string     `json:"title" binding:"required"`
	TradeTrack  *string    `json:"trade_track,omitempty"`
	SubjectID   *string    `json:"subject_id,omitempty"`
	ScheduledAt *time.Time `json:"scheduled_at,omitempty"`
}

// CreateGroupRequest — member POST /community/groups.
type CreateGroupRequest struct {
	Name     string         `json:"name" binding:"required"`
	Scope    *string        `json:"scope,omitempty"`
	ScopeRef *string        `json:"scope_ref,omitempty"`
	Goal     map[string]any `json:"goal,omitempty"`
}

// PostDiscussionRequest — member POST /community/discussions.
type PostDiscussionRequest struct {
	Scope    string  `json:"scope" binding:"required"`
	RefID    string  `json:"ref_id" binding:"required"`
	Body     string  `json:"body" binding:"required"`
	ParentID *string `json:"parent_id,omitempty"`
}

// ReportContentRequest — member POST /moderation/report.
type ReportContentRequest struct {
	EntityType string `json:"entity_type" binding:"required"`
	EntityID   string `json:"entity_id" binding:"required"`
	Reason     string `json:"reason" binding:"required"`
}

// DecideReportRequest — admin POST /moderation/reports/:id/decide.
type DecideReportRequest struct {
	Action string `json:"action" binding:"required"` // hide | warn | ban | none
}

// SessionFilter selects the listing surface for ListSessions.
type SessionFilter struct {
	// View is one of "upcoming" (scheduled), "live", "replay" (ended w/ replay_ref),
	// or "" for all non-cancelled. Defaults to "upcoming".
	View  string
	Limit int
}
