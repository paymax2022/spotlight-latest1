package services

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

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

type SessionService interface {
	// IssueSession persists a session for a fresh login. Returns the family id.
	IssueSession(userID string, tokens IssuedTokens, lc LoginContext) (string, error)
	// RotateRefresh exchanges an old refresh token for a new one. Reuse of an
	// already-rotated token revokes the whole family and returns an error.
	RotateRefresh(oldRefreshToken string, tokens IssuedTokens, lc LoginContext) (*Session, error)
	// ValidateAccess returns the active session bound to an access token, or an
	// error if revoked/expired/unknown (fail-closed).
	ValidateAccess(ctx context.Context, accessToken string) (*Session, error)
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
		return "", errors.New("user and refresh token required")
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
		return nil, errors.New("refresh tokens required")
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
		return nil, errors.New("refresh token reuse detected: session family revoked")
	}

	sess, err := s.store.GetByRefreshHash(oldHash)
	if err != nil {
		return nil, err
	}
	if sess == nil {
		return nil, errors.New("session not found")
	}
	if !sess.Active(now) {
		return nil, errors.New("session revoked or expired")
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

func (s *sessionService) ValidateAccess(ctx context.Context, accessToken string) (*Session, error) {
	if strings.TrimSpace(accessToken) == "" {
		return nil, errors.New("access token required")
	}
	sess, err := s.store.GetByAccessHash(HashToken(accessToken))
	if err != nil {
		return nil, err
	}
	if sess == nil {
		return nil, errors.New("session not found")
	}
	if !sess.Active(time.Now().UTC()) {
		return nil, errors.New("session revoked or expired")
	}
	_ = s.store.TouchLastSeen(sess.ID, time.Now().UTC())
	return sess, nil
}

func (s *sessionService) ListMySessions(userID string) ([]Session, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("user required")
	}
	return s.store.ListActiveByUser(userID)
}

func (s *sessionService) RevokeOne(actorUserID, userID, sessionID, reason string) error {
	if strings.TrimSpace(sessionID) == "" {
		return errors.New("session id required")
	}
	// Object-level authz: confirm the session belongs to the caller (unless the
	// caller is acting on themselves the handler already checked perms for admin).
	sess, err := s.store.GetSessionByID(sessionID)
	if err != nil {
		return err
	}
	if sess == nil {
		return errors.New("session not found")
	}
	if strings.TrimSpace(userID) != "" && sess.UserID != userID {
		return errors.New("forbidden: session does not belong to user")
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
		return 0, errors.New("user required")
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
		return errors.New("user required")
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

// EmailVerifier turns "this person controls this mailbox" into "this account is
// confirmed".
// It exists as a seam so the otp package never learns about Supabase, and so the
// OTP handler can be tested without a GoTrue instance.
type EmailVerifier interface {
	// ConfirmEmail marks the account for this address confirmed.
	// Returns (false, nil) when there is NO account for the address. That is not
	// an error: the OTP endpoints deliberately accept any address, so proving
	// control of a mailbox with no account behind it is an ordinary outcome, and
	// the caller must answer identically either way or the endpoint becomes a
	// user-enumeration oracle.
	ConfirmEmail(ctx context.Context, email string) (bool, error)
}

// supabaseEmailVerifier reads the user id straight from auth.users and writes the
// confirmation through GoTrue's admin API.
// The read is SQL because GoTrue's admin list endpoint filters differently across
// versions and PostgREST cannot reach the auth schema; the write is the admin API
// because GoTrue owns that schema (see AdminConfirmEmail).
type supabaseEmailVerifier struct {
	db       *pgxpool.Pool
	supabase *integrations.SupabaseRestClient
}

// NewSupabaseEmailVerifier returns nil when either dependency is missing, so a
// caller can treat nil as "confirmation is not available here" rather than
// discovering it at the first verification.
func NewSupabaseEmailVerifier(db *pgxpool.Pool, supabase *integrations.SupabaseRestClient) EmailVerifier {
	if db == nil || supabase == nil || !supabase.Enabled() {
		return nil
	}
	return &supabaseEmailVerifier{db: db, supabase: supabase}
}

func (v *supabaseEmailVerifier) ConfirmEmail(ctx context.Context, email string) (bool, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return false, nil
	}

	id, alreadyConfirmed, err := authUserByEmail(ctx, v.db, email)
	if err != nil {
		return false, err
	}
	if id == "" {
		return false, nil // no account — an ordinary outcome, not a failure
	}
	if alreadyConfirmed {
		// Re-confirming is harmless, but skipping the round trip means a user who
		// verifies twice does not depend on GoTrue being reachable the second time.
		return true, nil
	}
	if err := v.supabase.AdminConfirmEmail(ctx, id); err != nil {
		return false, err
	}
	return true, nil
}

// authUserByEmail resolves a GoTrue user id from a lowercased address via SQL —
// this pool runs as service_role, which cannot read auth.users, and
// platform_users.id mirrors auth.users.id 1:1 (rbac_identity_bridge migration).
// One shared copy exists because a second "how we find a user" implementation
// is how the lowercasing drifts and mixed-case addresses silently report "no
// account". email_verified_at is platform_users' own confirmation timestamp.
// Returns ("", false, nil) when there is no such user.
func authUserByEmail(ctx context.Context, db *pgxpool.Pool, email string) (string, bool, error) {
	var confirmed bool
	var err error

	var id string

	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || db == nil {
		return "", false, nil
	}
	err = db.QueryRow(ctx, `
		SELECT id::text, email_verified_at IS NOT NULL
		  FROM public.platform_users
		 WHERE lower(email) = $1
		   AND deleted_at IS NULL
		 LIMIT 1`, email).Scan(&id, &confirmed)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return id, confirmed, nil
}

// resendNotifier delivers suspicious-login alerts via Resend, fire-and-forget.
// Matches the project's email policy (CLAUDE.md): no queue, failures are silent.
// PII discipline: the email body contains the event TYPE and coarse signals
// only — never tokens, passwords, or full device fingerprints.
type resendNotifier struct {
	cfg      config.Config
	supabase *integrations.SupabaseRestClient
	http     *http.Client
}

// NewResendNotifier returns a SecurityNotifier. When the Resend key is empty the
// notifier is a no-op (still satisfies the interface) so the rest of the flow
// continues to function in environments without email configured.
func NewResendNotifier(cfg config.Config, supabase *integrations.SupabaseRestClient) SecurityNotifier {
	return &resendNotifier{cfg: cfg, supabase: supabase, http: &http.Client{Timeout: 5 * time.Second}}
}

func (n *resendNotifier) NotifySuspiciousLogin(userID, email, eventType string, signals map[string]any) {
	// Fire-and-forget: never block login on notification delivery.
	go n.deliver(userID, email, eventType)
}

func (n *resendNotifier) deliver(userID, email, eventType string) {
	defer func() { _ = recover() }() // never let a notification panic crash the request goroutine

	to := strings.TrimSpace(email)
	if to == "" && n.supabase != nil && n.supabase.Enabled() && strings.TrimSpace(userID) != "" {
		to = n.lookupEmail(context.Background(), userID)
	}
	if to == "" || strings.TrimSpace(n.cfg.ResendAPIKey) == "" {
		return // nothing we can do; stay silent
	}

	subject := "Security alert on your Paymax account"
	body := fmt.Sprintf(
		"We detected a security event (%s) on your account. If this was you, no action is needed. "+
			"If you do not recognise this activity, reset your password and review your active sessions immediately.",
		humanizeEvent(eventType),
	)
	payload := map[string]any{
		"from":    n.cfg.ResendFromEmail,
		"to":      []string{to},
		"subject": subject,
		"text":    body,
	}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(b))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+n.cfg.ResendAPIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.http.Do(req)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}

func (n *resendNotifier) lookupEmail(ctx context.Context, userID string) string {
	var rows []struct {
		Email string `json:"email"`
	}
	if err := n.supabase.REST(ctx, http.MethodGet, "platform_users", map[string]string{"select": "email", "id": "eq." + userID, "limit": "1"}, nil, &rows); err != nil || len(rows) == 0 { //nolint:goconst // PostgREST select key; literal is self-describing
		return ""
	}
	return rows[0].Email
}

func humanizeEvent(eventType string) string {
	switch eventType {
	case EventNewDevice:
		return "sign-in from a new device"
	case EventNewIP:
		return "sign-in from a new location"
	case EventImpossibleTravel:
		return "sign-in from an unexpected location"
	case EventFailedSpike:
		return "multiple failed sign-in attempts"
	case EventTokenReuse:
		return "a session security violation"
	case EventForcedReset:
		return "a required password reset"
	default:
		return "unusual account activity"
	}
}
