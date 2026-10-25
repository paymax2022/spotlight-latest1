package supportimpersonation

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"spotlight/backend/internal/services"
)

// Permission is the dedicated RBAC slug (seeded by
// 20271068003010_support_impersonation.sql, NOT granted to any admin role).
const Permission = "support.impersonate"

// Duration bounds. The DB CHECK caps a session at 60 minutes as well.
const (
	DefaultDuration = 15 * time.Minute
	MaxDuration     = 60 * time.Minute
)

// ClampMax normalises the configured ceiling into (0, MaxDuration].
func ClampMax(d time.Duration) time.Duration {
	switch {
	case d <= 0:
		return 30 * time.Minute
	case d > MaxDuration:
		return MaxDuration
	}
	return d
}

// protectedTargetRoles may never be viewed-as: a support agent must not be
// able to read an administrator's (or another agent's) surface.
var protectedTargetRoles = []string{"super-admin", "system-admin", "support-impersonation-agent"}

// Validation / policy errors (mapped to 4xx by the handler).
var (
	ErrInvalidTarget    = errors.New("supportimpersonation: target_user_id must be a valid user id")
	ErrSelf             = errors.New("supportimpersonation: cannot impersonate yourself")
	ErrReasonRequired   = errors.New("supportimpersonation: reason must be 10-500 characters")
	ErrTicketRequired   = errors.New("supportimpersonation: ticket_ref must be 3-64 characters")
	ErrDuration         = errors.New("supportimpersonation: duration_minutes out of range")
	ErrTargetNotFound   = errors.New("supportimpersonation: target user not found")
	ErrTargetProtected  = errors.New("supportimpersonation: target account cannot be impersonated")
	ErrSessionNotFound  = errors.New("supportimpersonation: no open session with that id for this caller")
	ErrServiceUnwired   = errors.New("supportimpersonation: not available")
	ErrTargetRolesCheck = errors.New("supportimpersonation: could not verify target roles")
)

// RoleLookup is the slice of services.RBACService the policy needs.
type RoleLookup interface {
	GetUserRoles(ctx context.Context, userID string) ([]string, error)
}

// SessionStore is the persistence the service needs (PostgresStore).
type SessionStore interface {
	TargetStatus(ctx context.Context, userID string) (bool, string, error)
	Start(ctx context.Context, p StartParams) (Session, error)
	Stop(ctx context.Context, sessionID, actorUserID, ip, ua string) (Session, bool, error)
	Active(ctx context.Context, actorUserID string) (*Session, error)
	ListForTarget(ctx context.Context, targetUserID string, limit int) ([]Session, error)
}

// Service applies the start/stop policy.
type Service struct {
	store    SessionStore
	roles    RoleLookup
	audit    services.AuditSink
	notifier services.SecurityNotifier
	max      time.Duration
}

// NewService wires the service. audit/notifier may be nil (the DB event rows
// are the authoritative, fail-closed audit; these are extra channels).
func NewService(store SessionStore, roles RoleLookup, audit services.AuditSink, notifier services.SecurityNotifier, maxDuration time.Duration) *Service {
	return &Service{store: store, roles: roles, audit: audit, notifier: notifier, max: ClampMax(maxDuration)}
}

// Actor is the authenticated support agent.
type Actor struct {
	UserID    string
	Token     string
	IPAddress string
	UserAgent string
}

// StartRequest is the client body.
type StartRequest struct {
	TargetUserID    string `json:"target_user_id"`
	Reason          string `json:"reason"`
	TicketRef       string `json:"ticket_ref"`
	DurationMinutes int    `json:"duration_minutes"`
}

func (s *Service) ready() bool { return s != nil && s.store != nil && s.roles != nil }

// Start validates the request against policy and opens the session.
func (s *Service) Start(ctx context.Context, a Actor, req StartRequest) (Session, error) {
	if !s.ready() {
		return Session{}, ErrServiceUnwired
	}
	target := strings.TrimSpace(req.TargetUserID)
	reason := strings.TrimSpace(req.Reason)
	ticket := strings.TrimSpace(req.TicketRef)
	switch {
	case !IsUUID(target):
		return Session{}, ErrInvalidTarget
	case strings.EqualFold(target, a.UserID):
		return Session{}, ErrSelf
	case len(reason) < 10 || len(reason) > 500:
		return Session{}, ErrReasonRequired
	case len(ticket) < 3 || len(ticket) > 64:
		return Session{}, ErrTicketRequired
	}
	d := DefaultDuration
	if req.DurationMinutes != 0 {
		d = time.Duration(req.DurationMinutes) * time.Minute
	}
	if d > s.max {
		d = s.max
	}
	if req.DurationMinutes < 0 || d < time.Minute {
		return Session{}, ErrDuration
	}

	exists, status, err := s.store.TargetStatus(ctx, target)
	if err != nil {
		return Session{}, fmt.Errorf("supportimpersonation: target lookup: %w", err)
	}
	if !exists || status == "deleted" {
		return Session{}, ErrTargetNotFound
	}
	roles, err := s.roles.GetUserRoles(ctx, target)
	if err != nil {
		return Session{}, ErrTargetRolesCheck // fail closed
	}
	for _, r := range roles {
		if slices.Contains(protectedTargetRoles, strings.ToLower(strings.TrimSpace(r))) {
			return Session{}, ErrTargetProtected
		}
	}

	sess, err := s.store.Start(ctx, StartParams{
		ActorUserID:    a.UserID,
		ActorTokenHash: services.HashToken(a.Token),
		TargetUserID:   target,
		Reason:         reason,
		TicketRef:      ticket,
		Duration:       d,
		IPAddress:      a.IPAddress,
		UserAgent:      a.UserAgent,
	})
	if err != nil {
		return Session{}, err
	}
	meta := map[string]any{"session_id": sess.ID, "reason": reason, "ticket_ref": ticket, "expires_at": sess.ExpiresAt.Format(time.RFC3339), "mode": sess.Mode}
	if s.audit != nil {
		s.audit.LogAction(a.UserID, target, "support.impersonation.start", "support", "impersonation_session", sess.ID, nil, meta, a.IPAddress, a.UserAgent, "critical")
	}
	if s.notifier != nil {
		s.notifier.NotifySuspiciousLogin(target, "", services.EventSupportAccess, map[string]any{"session_id": sess.ID, "ticket_ref": ticket})
	}
	return sess, nil
}

// Stop ends the actor's own session.
func (s *Service) Stop(ctx context.Context, a Actor, sessionID string) (Session, error) {
	if !s.ready() {
		return Session{}, ErrServiceUnwired
	}
	sess, ok, err := s.store.Stop(ctx, strings.TrimSpace(sessionID), a.UserID, a.IPAddress, a.UserAgent)
	if err != nil {
		return Session{}, err
	}
	if !ok {
		return Session{}, ErrSessionNotFound
	}
	if s.audit != nil {
		s.audit.LogAction(a.UserID, sess.TargetUserID, "support.impersonation.stop", "support", "impersonation_session", sess.ID, nil,
			map[string]any{"end_reason": sess.EndReason}, a.IPAddress, a.UserAgent, "high")
	}
	return sess, nil
}

// Active returns the actor's live session (nil when none).
func (s *Service) Active(ctx context.Context, actorUserID string) (*Session, error) {
	if !s.ready() {
		return nil, ErrServiceUnwired
	}
	return s.store.Active(ctx, actorUserID)
}

// NoticesFor lists support accesses to the user's own account.
func (s *Service) NoticesFor(ctx context.Context, userID string) ([]Session, error) {
	if !s.ready() {
		return nil, ErrServiceUnwired
	}
	return s.store.ListForTarget(ctx, userID, 50)
}
