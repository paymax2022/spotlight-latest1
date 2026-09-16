package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrAccountUnavailable is returned when the lockout gate refuses a step-up.
var ErrAccountUnavailable = errors.New("account unavailable")

// SessionMinter issues a session for a user whose second factor has just been
// proved. It is the login step-up's other half.
//
// ⚠️ Whatever holds this interface can log in as anyone whose address it names.
// The ONLY legitimate caller is the OTP verify path for purpose=login, and that
// path is reachable only for a code that the PASSWORD-verified login flow issued
// — see handlers.OTPHandler.RequestOTP, which refuses to issue login codes to
// the public.
type SessionMinter interface {
	// MintSession returns a session for email, or (nil, nil) when there is no
	// usable account. A nil map with a nil error is the "no account" case and
	// must be answered identically to success by the caller.
	MintSession(ctx context.Context, email string) (map[string]any, error)
}

// PasswordSetter completes a code-based password reset.
type PasswordSetter interface {
	// SetPassword replaces the password for email. Reports (false, nil) when no
	// account exists — an ordinary outcome, since the reset endpoint accepts any
	// address on purpose.
	SetPassword(ctx context.Context, email, newPassword string) (bool, error)
}

// otpAuthBridge implements both against the same authService, so the lockout
// gate, the platform_users lookup and the Supabase client are the ones login
// already uses rather than a second copy that can drift from them.
type otpAuthBridge struct {
	svc *authService
	db  *pgxpool.Pool

	// sessions/sessionHardening mirror AuthHandler's own fields (see
	// AuthHandler.WithSessions). Nil/false is a valid, common configuration —
	// not every deployment runs with session hardening on — and every use below
	// checks both before touching SessionService.
	sessions         SessionService
	sessionHardening bool
}

// NewOTPAuthBridge adapts an AuthService for the OTP flows. Returns nil unless
// every dependency is present, so a caller can treat nil as "not available"
// instead of discovering it at a user's first step-up.
func NewOTPAuthBridge(auth AuthService, db *pgxpool.Pool) *otpAuthBridge {
	svc, ok := auth.(*authService)
	if !ok || svc == nil || svc.supabase == nil || !svc.supabase.Enabled() || db == nil {
		return nil
	}
	return &otpAuthBridge{svc: svc, db: db}
}

// WithSessions wires SessionService into the bridge, the same way
// AuthHandler.WithSessions does for the password-login path. Call this from
// the same place that builds the AuthHandler's session wiring, with the same
// service instance and the same feature flag — a step-up session that is
// tracked by a DIFFERENT SessionService instance than /api/auth/me validates
// against would fail exactly the way the untracked session did before this.
func (b *otpAuthBridge) WithSessions(sessions SessionService, enabled bool) *otpAuthBridge {
	b.sessions = sessions
	b.sessionHardening = enabled
	return b
}

// gate re-runs the lockout checks and returns the platform user.
//
// Re-run rather than trusted from the password step: minutes can pass between
// the two factors, and an account suspended in between must not complete a
// login that started before it. The password path is not the authority on
// whether an account is still allowed in at the moment a session is issued.
func (b *otpAuthBridge) gate(email string) (*platformUser, error) {
	user, err := b.svc.findPlatformUserByEmail(email)
	if err != nil {
		// The lookup itself failed (REST/network) — distinct from the zero-rows
		// case below. Unchanged: propagate as-is, same as before this fix.
		return nil, err
	}
	if user == nil {
		// AUTH-014: zero platform_users rows for an email completing a step-up.
		// This used to be treated as "the gate only applies when a row exists"
		// and let the step-up through with zero enforcement of suspension/lock —
		// the same bug LoginUser had. The RBAC identity-bridge trigger
		// (20260904000000_rbac_identity_bridge.sql) mirrors auth.users into
		// platform_users SYNCHRONOUSLY within account creation, so a normal
		// account always has a row by the time any login step is reachable. A
		// missing row is anomalous, not a legitimate race — refuse it the same
		// way a suspended/locked account is refused.
		return nil, fmt.Errorf("%w: platform user not found", ErrAccountUnavailable)
	}
	if err := b.svc.validateLoginStatus(user); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrAccountUnavailable, err)
	}
	return user, nil
}

func (b *otpAuthBridge) MintSession(ctx context.Context, email string) (map[string]any, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return nil, nil
	}
	user, err := b.gate(email)
	if err != nil {
		return nil, err
	}
	session, err := b.svc.supabase.MintSessionByEmail(ctx, email)
	if err != nil {
		return nil, err
	}
	// AUTH-009: a session minted here was, until this call, NEVER registered
	// with SessionService — only the password-login path (AuthHandler.Login)
	// did that, after its own GoTrue mint. With FEATURE_SESSION_HARDENING_ENABLED
	// on, RequireAuthContextWithSessions looks every token up in SessionService
	// and fails closed on a miss, so a step-up session was valid at GoTrue and
	// rejected everywhere else as "session revoked". Registering it here, using
	// the tokens GoTrue just returned, is the missing half of the same pattern
	// Login already uses.
	b.trackSession(user, session)
	return session, nil
}

// trackSession registers a freshly minted step-up session with SessionService,
// mirroring the `h.sessionHardening && h.sessions != nil` guard in
// AuthHandler.Login. A no-op — never an error — when session hardening is off
// or unwired, or when there is no platform_users row to attribute the session
// to (the same case Login itself skips: see loginUserID != "" there).
func (b *otpAuthBridge) trackSession(user *platformUser, session map[string]any) {
	if !b.sessionHardening || b.sessions == nil || user == nil {
		return
	}
	tokens := IssuedTokens{
		AccessToken:  asOTPBridgeString(session["access_token"]),
		RefreshToken: asOTPBridgeString(session["refresh_token"]),
		ExpiresIn:    asOTPBridgeInt(session["expires_in"]),
	}
	if tokens.RefreshToken == "" {
		return
	}
	// No IP/user-agent: MintSession's context.Context is derived from the
	// request but does not carry them, and the SessionMinter interface (its
	// only caller, handlers.OTPHandler.completeStepUpLogin) does not pass them
	// either. IssueSession accepts an empty LoginContext — the fields are used
	// for suspicious-login heuristics, not for whether the session is valid.
	_, _ = b.sessions.IssueSession(user.ID, tokens, LoginContext{})
}

func asOTPBridgeString(v any) string {
	s, _ := v.(string)
	return s
}

func asOTPBridgeInt(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}

func (b *otpAuthBridge) SetPassword(ctx context.Context, email, newPassword string) (bool, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || newPassword == "" {
		return false, nil
	}
	// The lockout gate applies here too. A suspended account must not be able to
	// take a new password and walk back in.
	if _, err := b.gate(email); err != nil {
		return false, err
	}

	id, _, err := authUserByEmail(ctx, b.db, email)
	if err != nil {
		return false, err
	}
	if id == "" {
		return false, nil // no account — an ordinary outcome
	}
	if err := b.svc.supabase.AdminSetPassword(ctx, id, newPassword); err != nil {
		return false, err
	}
	return true, nil
}

// SetOTPOperational tells the auth service that server-issued OTP is not merely
// flagged on but actually wired, so registration may use the silent admin
// creation path.
//
// A no-op on any other AuthService implementation, and false by default, so the
// fail-safe direction is /auth/v1/signup — which always sends a confirmation
// email the user can act on.
func SetOTPOperational(auth AuthService, operational bool) {
	if svc, ok := auth.(*authService); ok && svc != nil {
		svc.otpOperational = operational
	}
}
