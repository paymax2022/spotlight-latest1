package services

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"strings"
	"time"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/domain"
)

// ── Domain types (aliased from domain to avoid an import cycle with repos) ────

type Session = domain.Session
type LoginActivity = domain.LoginActivitySnapshot
type SecurityEvent = domain.SecurityEvent
type SessionStore = domain.SessionStore

// LoginContext carries the request-derived signals for a login attempt.
type LoginContext struct {
	IPAddress         string
	UserAgent         string
	DeviceFingerprint string
	// Latitude/Longitude are optional geo signals (0,0 = unknown).
	Latitude  float64
	Longitude float64
}

// IssuedTokens is the Supabase token bundle for a fresh/rotated session.
type IssuedTokens struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int
}

const (
	EventNewDevice        = "new_device"
	EventNewIP            = "new_ip"
	EventImpossibleTravel = "impossible_travel"
	EventFailedSpike      = "failed_login_spike"
	EventTokenReuse       = "token_reuse"
	EventForcedReset      = "forced_reset"
	EventSessionsRevoked  = "sessions_revoked"

	PolicyNotify        = "notify"
	PolicyForceReverify = "force_reverify"
	PolicyForceReset    = "force_password_reset"
)

// ── Ports (interfaces for testability) ───────────────────────────────────────

// SecurityNotifier delivers a fire-and-forget security alert to the user.
// Failures are intentionally swallowed by the service (mirrors Resend policy).
type SecurityNotifier interface {
	NotifySuspiciousLogin(userID, email, eventType string, signals map[string]any)
}

// AuditSink is the minimal slice of AuditService used here (avoids import cycle
// concerns and keeps the service unit-testable).
type AuditSink interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// ── Service ──────────────────────────────────────────────────────────────────

type SessionService interface {
	// IssueSession persists a session for a fresh login. Returns the family id.
	IssueSession(userID string, tokens IssuedTokens, lc LoginContext) (string, error)
	// RotateRefresh exchanges an old refresh token for a new one. Reuse of an
	// already-rotated token revokes the whole family and returns an error.
	RotateRefresh(oldRefreshToken string, tokens IssuedTokens, lc LoginContext) (*Session, error)
	// ValidateAccess returns the active session bound to an access token, or an
	// error if revoked/expired/unknown (fail-closed).
	ValidateAccess(accessToken string) (*Session, error)
	ListMySessions(userID string) ([]Session, error)
	RevokeOne(actorUserID, userID, sessionID, reason string) error
	RevokeAll(actorUserID, userID, reason string) (int, error)
	// EvaluateLogin runs suspicious-login detection + escalation. Returns the
	// security events raised (may be empty). Never blocks the login itself.
	EvaluateLogin(userID, email string, lc LoginContext) ([]SecurityEvent, error)
	// AdminForceLogout revokes all sessions for a target user (admin action).
	AdminForceLogout(actorUserID, userID, reason string) (int, error)
	// AdminForcePasswordReset sets the force-reset flag and revokes sessions.
	AdminForcePasswordReset(actorUserID, userID, reason string) error
}

type sessionService struct {
	store    SessionStore
	notifier SecurityNotifier
	audit    AuditSink
	cfg      config.Config
}

func NewSessionService(store SessionStore, notifier SecurityNotifier, audit AuditSink, cfg config.Config) SessionService {
	return &sessionService{store: store, notifier: notifier, audit: audit, cfg: cfg}
}

// HashToken returns the hex sha256 of a token. Raw tokens are NEVER stored.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}

func (s *sessionService) IssueSession(userID string, tokens IssuedTokens, lc LoginContext) (string, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(tokens.RefreshToken) == "" {
		return "", fmt.Errorf("user and refresh token required")
	}
	expiresIn := tokens.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 86400
	}
	now := time.Now().UTC()
	sess := Session{
		UserID:            userID,
		RefreshTokenHash:  HashToken(tokens.RefreshToken),
		AccessTokenHash:   HashToken(tokens.AccessToken),
		RotationCounter:   0,
		DeviceFingerprint: lc.DeviceFingerprint,
		IPAddress:         lc.IPAddress,
		UserAgent:         lc.UserAgent,
		ExpiresAt:         now.Add(time.Duration(expiresIn) * time.Second),
		LastSeenAt:        &now,
		CreatedAt:         now,
	}
	id, err := s.store.CreateSession(sess)
	if err != nil {
		return "", err
	}
	// The family id is the first session's own id; the store sets it when empty.
	return id, nil
}

func (s *sessionService) RotateRefresh(oldRefreshToken string, tokens IssuedTokens, lc LoginContext) (*Session, error) {
	if strings.TrimSpace(oldRefreshToken) == "" || strings.TrimSpace(tokens.RefreshToken) == "" {
		return nil, fmt.Errorf("refresh tokens required")
	}
	oldHash := HashToken(oldRefreshToken)
	now := time.Now().UTC()

	// Reuse detection: was this token already rotated away from?
	if reused, err := s.store.FindByPreviousRefreshHash(oldHash); err == nil && reused != nil {
		// Token replay → revoke the entire family, fail closed.
		_ = s.store.RevokeFamily(reused.FamilyID, "refresh_token_reuse")
		_ = s.store.RecordSecurityEvent(SecurityEvent{
			UserID:            reused.UserID,
			Email:             "",
			EventType:         EventTokenReuse,
			Severity:          "critical",
			Signals:           map[string]any{"family_id": reused.FamilyID},
			IPAddress:         lc.IPAddress,
			DeviceFingerprint: lc.DeviceFingerprint,
			UserAgent:         lc.UserAgent,
			ActionTaken:       EventSessionsRevoked,
			Notified:          false,
		})
		if s.notifier != nil {
			s.notifier.NotifySuspiciousLogin(reused.UserID, "", EventTokenReuse, map[string]any{"reason": "refresh_token_reuse"})
		}
		if s.audit != nil {
			s.audit.LogAction(reused.UserID, reused.UserID, "session.token_reuse", "auth", "session_family", reused.FamilyID, nil, nil, lc.IPAddress, lc.UserAgent, "critical")
		}
		return nil, fmt.Errorf("refresh token reuse detected: session family revoked")
	}

	sess, err := s.store.GetByRefreshHash(oldHash)
	if err != nil {
		return nil, err
	}
	if sess == nil {
		return nil, fmt.Errorf("session not found")
	}
	if !sess.Active(now) {
		return nil, fmt.Errorf("session revoked or expired")
	}

	expiresIn := tokens.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 86400
	}
	newCounter := sess.RotationCounter + 1
	newRefreshHash := HashToken(tokens.RefreshToken)
	newAccessHash := HashToken(tokens.AccessToken)
	newExpiry := now.Add(time.Duration(expiresIn) * time.Second)
	if err := s.store.RotateSession(sess.ID, newRefreshHash, oldHash, newAccessHash, newCounter, newExpiry); err != nil {
		return nil, err
	}
	sess.PreviousTokenHash = oldHash
	sess.RefreshTokenHash = newRefreshHash
	sess.AccessTokenHash = newAccessHash
	sess.RotationCounter = newCounter
	sess.ExpiresAt = newExpiry
	return sess, nil
}

func (s *sessionService) ValidateAccess(accessToken string) (*Session, error) {
	if strings.TrimSpace(accessToken) == "" {
		return nil, fmt.Errorf("access token required")
	}
	sess, err := s.store.GetByAccessHash(HashToken(accessToken))
	if err != nil {
		return nil, err
	}
	if sess == nil {
		return nil, fmt.Errorf("session not found")
	}
	if !sess.Active(time.Now().UTC()) {
		return nil, fmt.Errorf("session revoked or expired")
	}
	_ = s.store.TouchLastSeen(sess.ID, time.Now().UTC())
	return sess, nil
}

func (s *sessionService) ListMySessions(userID string) ([]Session, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, fmt.Errorf("user required")
	}
	return s.store.ListActiveByUser(userID)
}

func (s *sessionService) RevokeOne(actorUserID, userID, sessionID, reason string) error {
	if strings.TrimSpace(sessionID) == "" {
		return fmt.Errorf("session id required")
	}
	// Object-level authz: confirm the session belongs to the caller (unless the
	// caller is acting on themselves the handler already checked perms for admin).
	sess, err := s.store.GetSessionByID(sessionID)
	if err != nil {
		return err
	}
	if sess == nil {
		return fmt.Errorf("session not found")
	}
	if strings.TrimSpace(userID) != "" && sess.UserID != userID {
		return fmt.Errorf("forbidden: session does not belong to user")
	}
	if err := s.store.RevokeSession(sessionID, fallbackReason(reason, "user_revoked")); err != nil {
		return err
	}
	if s.audit != nil {
		s.audit.LogAction(actorUserID, sess.UserID, "session.revoke", "auth", "session", sessionID, nil, nil, "", "", "high")
	}
	return nil
}

func (s *sessionService) RevokeAll(actorUserID, userID, reason string) (int, error) {
	if strings.TrimSpace(userID) == "" {
		return 0, fmt.Errorf("user required")
	}
	n, err := s.store.RevokeAllForUser(userID, fallbackReason(reason, "user_revoked_all"))
	if err != nil {
		return 0, err
	}
	if s.audit != nil {
		s.audit.LogAction(actorUserID, userID, "session.revoke_all", "auth", "session", "", nil, map[string]any{"revoked": n}, "", "", "high")
	}
	return n, nil
}

func (s *sessionService) AdminForceLogout(actorUserID, userID, reason string) (int, error) {
	n, err := s.store.RevokeAllForUser(userID, fallbackReason(reason, "admin_force_logout"))
	if err != nil {
		return 0, err
	}
	_ = s.store.RecordSecurityEvent(SecurityEvent{
		UserID: userID, EventType: EventSessionsRevoked, Severity: "high",
		Signals: map[string]any{"by": actorUserID, "count": n}, ActionTaken: "revoke_sessions",
	})
	if s.audit != nil {
		s.audit.LogAction(actorUserID, userID, "session.admin_force_logout", "auth", "session", "", nil, map[string]any{"revoked": n}, "", "", "high")
	}
	return n, nil
}

func (s *sessionService) AdminForcePasswordReset(actorUserID, userID, reason string) error {
	if strings.TrimSpace(userID) == "" {
		return fmt.Errorf("user required")
	}
	if err := s.store.SetForceFlags(userID, true, false); err != nil {
		return err
	}
	if _, err := s.store.RevokeAllForUser(userID, fallbackReason(reason, "admin_force_reset")); err != nil {
		return err
	}
	_ = s.store.RecordSecurityEvent(SecurityEvent{
		UserID: userID, EventType: EventForcedReset, Severity: "critical",
		Signals: map[string]any{"by": actorUserID}, ActionTaken: PolicyForceReset,
	})
	if s.notifier != nil {
		s.notifier.NotifySuspiciousLogin(userID, "", EventForcedReset, map[string]any{"by": "admin"})
	}
	if s.audit != nil {
		s.audit.LogAction(actorUserID, userID, "session.admin_force_password_reset", "auth", "user", userID, nil, nil, "", "", "critical")
	}
	return nil
}

// EvaluateLogin runs all suspicious-login heuristics, records events, fires the
// notification, and applies the configured escalation. It is fail-closed: an
// unknown device/IP is treated as suspicious.
func (s *sessionService) EvaluateLogin(userID, email string, lc LoginContext) ([]SecurityEvent, error) {
	var events []SecurityEvent
	now := time.Now().UTC()

	// 1) New device.
	if fp := strings.TrimSpace(lc.DeviceFingerprint); fp != "" {
		known, err := s.store.HasKnownDevice(userID, fp)
		if err != nil || !known { // fail-closed: error => treat as new
			events = append(events, s.raise(userID, email, EventNewDevice, "medium", map[string]any{"device": fp}, lc))
		}
	}
	// 2) New IP.
	if ip := strings.TrimSpace(lc.IPAddress); ip != "" {
		known, err := s.store.HasKnownIP(userID, ip)
		if err != nil || !known {
			events = append(events, s.raise(userID, email, EventNewIP, "medium", map[string]any{"ip": ip}, lc))
		}
	}
	// 3) Failed-login spike.
	window := now.Add(-15 * time.Minute)
	if cnt, err := s.store.CountRecentFailedLogins(email, window); err == nil && cnt >= s.cfg.SuspiciousFailedLoginSpike {
		events = append(events, s.raise(userID, email, EventFailedSpike, "high", map[string]any{"failed_count": cnt}, lc))
	}
	// 4) Impossible travel.
	if lc.Latitude != 0 || lc.Longitude != 0 {
		if last, err := s.store.LastSuccessfulLogin(email); err == nil && last != nil && (last.Latitude != 0 || last.Longitude != 0) {
			km := haversineKm(last.Latitude, last.Longitude, lc.Latitude, lc.Longitude)
			hours := now.Sub(last.CreatedAt).Hours()
			if hours > 0 && hours < 24 {
				speed := km / hours
				if speed > float64(s.cfg.SuspiciousImpossibleKmH) {
					events = append(events, s.raise(userID, email, EventImpossibleTravel, "critical",
						map[string]any{"km": math.Round(km), "hours": math.Round(hours*100) / 100, "kmh": math.Round(speed)}, lc))
				}
			}
		}
	}

	if len(events) == 0 {
		return events, nil
	}

	// Escalation: notify always; force_* additionally revokes sessions + sets flag.
	s.applyEscalation(userID, email, events, lc)
	return events, nil
}

func (s *sessionService) applyEscalation(userID, email string, events []SecurityEvent, lc LoginContext) {
	// Always notify the user (fire-and-forget).
	if s.notifier != nil {
		s.notifier.NotifySuspiciousLogin(userID, email, events[0].EventType, map[string]any{"events": len(events)})
	}
	policy := strings.ToLower(strings.TrimSpace(s.cfg.SuspiciousEscalationPolicy))
	switch policy {
	case PolicyForceReset:
		_ = s.store.SetForceFlags(userID, true, false)
		_, _ = s.store.RevokeAllForUser(userID, "suspicious_login_force_reset")
		_ = s.store.RecordSecurityEvent(SecurityEvent{UserID: userID, Email: email, EventType: EventForcedReset, Severity: "critical", ActionTaken: PolicyForceReset, IPAddress: lc.IPAddress, DeviceFingerprint: lc.DeviceFingerprint, UserAgent: lc.UserAgent})
		if s.audit != nil {
			s.audit.LogAction(userID, userID, "session.suspicious_force_reset", "auth", "user", userID, nil, nil, lc.IPAddress, lc.UserAgent, "critical")
		}
	case PolicyForceReverify:
		_ = s.store.SetForceFlags(userID, false, true)
		_, _ = s.store.RevokeAllForUser(userID, "suspicious_login_force_reverify")
		if s.audit != nil {
			s.audit.LogAction(userID, userID, "session.suspicious_force_reverify", "auth", "user", userID, nil, nil, lc.IPAddress, lc.UserAgent, "high")
		}
	default: // notify only
		if s.audit != nil {
			s.audit.LogAction(userID, userID, "session.suspicious_notify", "auth", "user", userID, nil, nil, lc.IPAddress, lc.UserAgent, "high")
		}
	}
}

func (s *sessionService) raise(userID, email, eventType, severity string, signals map[string]any, lc LoginContext) SecurityEvent {
	ev := SecurityEvent{
		UserID: userID, Email: email, EventType: eventType, Severity: severity,
		Signals: signals, IPAddress: lc.IPAddress, DeviceFingerprint: lc.DeviceFingerprint,
		UserAgent: lc.UserAgent, ActionTaken: "notify", Notified: s.notifier != nil,
	}
	_ = s.store.RecordSecurityEvent(ev)
	return ev
}

func fallbackReason(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return strings.TrimSpace(v)
}

// haversineKm returns the great-circle distance between two lat/lon points in km.
func haversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return r * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
