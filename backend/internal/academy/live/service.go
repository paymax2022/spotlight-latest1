package live

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service implements the academy live + community + moderation domain. No money path.
// Streaming is delegated entirely to the injected LiveRoomProvider (nil → stub).
type Service struct {
	repo  *Repository
	rooms LiveRoomProvider
}

// NewService wires the service from a pool and an injected room provider. A nil
// provider degrades to a deterministic stub.
func NewService(db *pgxpool.Pool, rooms LiveRoomProvider) *Service {
	return &Service{repo: NewRepository(db), rooms: providerOrStub(rooms)}
}

// Sentinel errors mapped to HTTP statuses by the handler.
var (
	ErrIllegalTransition = errors.New("academy/live: illegal state transition")
	ErrInvalidInput      = errors.New("academy/live: invalid input")
	ErrChildSafety       = errors.New("academy/live: blocked by child-safety policy")
	ErrProvider          = errors.New("academy/live: room provider error")
)

// ── Live sessions ────────────────────────────────────────────────────────────

// ScheduleSession creates a scheduled session. host is a tutor/staff actor (the
// admin route is RBAC-gated by academy.live before this is reached).
func (s *Service) ScheduleSession(ctx context.Context, host string, req ScheduleSessionRequest) (*LiveSession, error) {
	if req.Title == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.InsertSession(ctx, host, req)
}

// StartSession moves a scheduled session live, provisioning a room via the provider
// and storing its ref. The state transition + room_ref persist atomically.
func (s *Service) StartSession(ctx context.Context, actor, sessionID string) (*LiveSession, error) {
	sess, err := s.repo.GetSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if !canSession(sess.State, SessionLive) {
		// Persist the rejection audit via the guarded repo path (re-reads under lock).
		return s.repo.TransitionSession(ctx, actor, sessionID, SessionLive, nil, nil)
	}
	roomRef, err := s.rooms.CreateRoom(ctx, sessionID)
	if err != nil {
		return nil, errors.Join(ErrProvider, err)
	}
	return s.repo.TransitionSession(ctx, actor, sessionID, SessionLive, &roomRef, nil)
}

// EndSession moves a live session to ended, storing the replay reference.
func (s *Service) EndSession(ctx context.Context, actor, sessionID, replayRef string) (*LiveSession, error) {
	var replayArg *string
	if replayRef != "" {
		replayArg = &replayRef
	}
	return s.repo.TransitionSession(ctx, actor, sessionID, SessionEnded, nil, replayArg)
}

// CancelSession moves a scheduled session to cancelled.
func (s *Service) CancelSession(ctx context.Context, actor, sessionID string) (*LiveSession, error) {
	return s.repo.TransitionSession(ctx, actor, sessionID, SessionCancelled, nil, nil)
}

// JoinSession records the member as a participant and returns a join token minted by
// the provider. Only a live session may be joined.
func (s *Service) JoinSession(ctx context.Context, userID, sessionID string) (*LiveSession, string, error) {
	if userID == "" {
		return nil, "", ErrInvalidInput
	}
	sess, err := s.repo.GetSession(ctx, sessionID)
	if err != nil {
		return nil, "", err
	}
	if sess.State != SessionLive {
		return nil, "", ErrIllegalTransition
	}
	role := RoleAttendee
	if sess.HostID == userID {
		role = RoleHost
	}
	if _, err := s.repo.JoinParticipant(ctx, sessionID, userID, role); err != nil {
		return nil, "", err
	}
	roomRef := ""
	if sess.RoomRef != nil {
		roomRef = *sess.RoomRef
	}
	token, err := s.rooms.Token(ctx, roomRef, userID, string(role))
	if err != nil {
		return nil, "", errors.Join(ErrProvider, err)
	}
	return sess, token, nil
}

// LeaveSession stamps the participant's left_at.
func (s *Service) LeaveSession(ctx context.Context, userID, sessionID string) error {
	return s.repo.LeaveParticipant(ctx, sessionID, userID)
}

// ListSessions returns the requested view (upcoming/live/replay).
func (s *Service) ListSessions(ctx context.Context, f SessionFilter) ([]LiveSession, error) {
	return s.repo.ListSessions(ctx, f)
}

// ListAllSessions returns EVERY session regardless of state (admin oversight read).
func (s *Service) ListAllSessions(ctx context.Context, limit int) ([]LiveSession, error) {
	return s.repo.ListAllSessions(ctx, limit)
}

// ListReplays returns ended sessions that have a stored replay reference (admin read;
// reuses the "replay" listing view).
func (s *Service) ListReplays(ctx context.Context, limit int) ([]LiveSession, error) {
	return s.repo.ListSessions(ctx, SessionFilter{View: "replay", Limit: limit})
}

// GetSession returns a single live session by id (public catalog read; same
// LiveSession shape as the ListSessions list item, no owner scope).
func (s *Service) GetSession(ctx context.Context, id string) (*LiveSession, error) {
	return s.repo.GetSession(ctx, id)
}

// ── Community ──────────────────────────────────────────────────────────────────

// CreateGroup creates a study group owned by (and auto-joining) the caller.
func (s *Service) CreateGroup(ctx context.Context, owner string, req CreateGroupRequest) (*StudyGroup, error) {
	if req.Name == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.InsertGroup(ctx, owner, req)
}

// JoinGroup adds the caller to a group (idempotent).
func (s *Service) JoinGroup(ctx context.Context, userID, groupID string) error {
	if groupID == "" {
		return ErrInvalidInput
	}
	if _, err := s.repo.GetGroup(ctx, groupID); err != nil {
		return err
	}
	return s.repo.JoinGroup(ctx, groupID, userID)
}

func (s *Service) ListGroups(ctx context.Context, limit int) ([]StudyGroup, error) {
	return s.repo.ListGroups(ctx, limit)
}

// PostDiscussion posts a Q&A discussion. CHILD-SAFETY: the scope must be an allowed
// community scope (group/subject/session); a minor author may never post to a DM/1:1
// scope (there is none, so this is fail-closed defence in depth). The minor check is
// only run for DM-shaped scopes — the common path stays a single guard call.
func (s *Service) PostDiscussion(ctx context.Context, userID string, req PostDiscussionRequest) (*Discussion, error) {
	if userID == "" || req.Body == "" || req.RefID == "" {
		return nil, ErrInvalidInput
	}
	// Resolve minor status only when needed (DM-shaped scope); otherwise the scope
	// allow-list alone decides and we avoid a DB round-trip on every post.
	isMinor := false
	if isDMScope(req.Scope) {
		m, err := s.repo.IsMinor(ctx, userID)
		if err != nil {
			return nil, err
		}
		isMinor = m
	}
	ok, reason := canPostDiscussion(isMinor, req.Scope)
	if !ok {
		_ = s.repo.insertAudit(ctx, userID, "discussion.post_blocked", "academy_discussion", req.RefID,
			map[string]any{"scope": req.Scope, "reason": reason}, "warning")
		if reason == "invalid_scope" {
			return nil, ErrInvalidInput
		}
		return nil, ErrChildSafety
	}
	return s.repo.InsertDiscussion(ctx, userID, req)
}

// ListDiscussions returns ONLY visible discussions for a scope/ref (hidden posts are
// never surfaced to members).
func (s *Service) ListDiscussions(ctx context.Context, scope, refID string, limit int) ([]Discussion, error) {
	if !isAllowedScope(scope) || refID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.ListVisibleDiscussions(ctx, scope, refID, limit)
}

// ── Moderation (RBAC academy.moderation for the privileged paths) ──────────────

// ReportContent files a pending report. Any user (including minors) may report.
func (s *Service) ReportContent(ctx context.Context, reporterID string, req ReportContentRequest) (*ModerationReport, error) {
	if req.EntityType == "" || req.EntityID == "" || req.Reason == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.InsertReport(ctx, reporterID, req)
}

func (s *Service) ListReports(ctx context.Context, state string, limit int) ([]ModerationReport, error) {
	if state != "" && !validReportState(state) {
		return nil, ErrInvalidInput
	}
	return s.repo.ListReports(ctx, state, limit)
}

// DecideReport resolves a pending report. action ∈ {hide,warn,ban,none}; "none"
// dismisses, anything else marks it actioned. When action=hide and the report
// targets a discussion, the discussion is hidden atomically.
func (s *Service) DecideReport(ctx context.Context, moderatorID, reportID, action string) (*ModerationReport, error) {
	if !validModerationAction(action) {
		return nil, ErrInvalidInput
	}
	toState := reportStateForAction(action)
	return s.repo.DecideReport(ctx, moderatorID, reportID, action, toState)
}

// TriageReport moves a pending report into triaged (a pre-decision workflow step;
// sibling of DecideReport). Guarded + audited via the moderation state machine.
func (s *Service) TriageReport(ctx context.Context, moderatorID, reportID string) (*ModerationReport, error) {
	if reportID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.TransitionReport(ctx, moderatorID, reportID, ReportTriaged, "moderation.triaged")
}

// EscalateReport moves a pending or triaged report into escalated (raise to senior
// moderation; sibling of DecideReport). Guarded + audited via the moderation state machine.
func (s *Service) EscalateReport(ctx context.Context, moderatorID, reportID string) (*ModerationReport, error) {
	if reportID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.TransitionReport(ctx, moderatorID, reportID, ReportEscalated, "moderation.escalated")
}

// HideContent directly hides a discussion (moderator action outside the report flow).
func (s *Service) HideContent(ctx context.Context, moderatorID, discussionID string) (*Discussion, error) {
	if discussionID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.HideDiscussion(ctx, moderatorID, discussionID)
}

func validReportState(s string) bool {
	switch ReportState(s) {
	case ReportPending, ReportActioned, ReportDismissed:
		return true
	default:
		return false
	}
}
