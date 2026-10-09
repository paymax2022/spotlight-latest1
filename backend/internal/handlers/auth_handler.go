package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/otp"
	"spotlight/backend/internal/services"
)

type AuthHandler struct {
	attributeReferral ReferralAttributor
	auth              services.AuthService
	rbac              services.RBACService
	audit             services.AuditService

	// Optional session-hardening collaborators (#19). Nil unless wired and the
	// feature flag is on; Login degrades gracefully when absent.
	sessions         services.SessionService
	sessionHardening bool

	// Optional server-issued OTP. Nil unless FEATURE_OTP_EMAIL_ENABLED is on and
	// fully configured; Register behaves exactly as before when absent.
	issueOTP OTPIssuer

	// loginMFA turns a successful password check into a second-factor challenge
	// instead of a session. Off unless FEATURE_OTP_LOGIN_MFA_ENABLED is on AND an
	// issuer exists — a challenge nobody can be sent a code for would lock every
	// user out.
	loginMFA bool

	// verifyOTP and setPassword complete a code-based password reset. Nil leaves
	// ResetPassword refusing, which is what it should have been doing all along.
	verifyOTP   OTPVerifier
	setPassword services.PasswordSetter

	// signupGate replaces GoTrue's sign_in_sign_ups limit, which the admin
	// creation path does not enforce. Nil when registration still goes through
	// /auth/v1/signup, where GoTrue applies it itself.
	signupGate SignupGate
}

func NewAuthHandler(auth services.AuthService, rbac services.RBACService, audit services.AuditService) *AuthHandler {
	return &AuthHandler{auth: auth, rbac: rbac, audit: audit}
}

// ReferralAttributor attributes a freshly-created account to a referrer (or to
// the house). Injected as a function because the referral service needs the pgx
// pool, which is built AFTER this handler — the same reason WithSessions exists.
type ReferralAttributor func(ctx context.Context, userID, referralCode string) error

// WithReferralAttribution wires signup attribution. Without it registration still
// works and simply does not attribute, which is how it behaved before.
func (h *AuthHandler) WithReferralAttribution(fn ReferralAttributor) *AuthHandler {
	h.attributeReferral = fn
	return h
}

// WithSessions enables session issuance + suspicious-login evaluation on Login.
func (h *AuthHandler) WithSessions(sessions services.SessionService, enabled bool) *AuthHandler {
	h.sessions = sessions
	h.sessionHardening = enabled
	return h
}

// OTPIssuer sends a verification code to a freshly-registered address.
// A function rather than the otp.Service itself, for the same reason
// ReferralAttributor is: the service needs the shared pgx pool, which is built
// after this handler.
type OTPIssuer func(ctx context.Context, email, name, purpose string, ip string) error

// WithOTPIssuer makes Register send our own verification code.
// Without it Register is unchanged and verification stays entirely with Supabase
// Auth, which is the shipped behaviour.
func (h *AuthHandler) WithOTPIssuer(fn OTPIssuer) *AuthHandler {
	h.issueOTP = fn
	return h
}

// SignupGate reports whether another registration may be attempted from ip.
// It stands in for GoTrue's sign_in_sign_ups budget, which /auth/v1/admin/users
// does not apply. Backed by Postgres rather than the in-process
// middleware.AuthRateLimiter that also guards this route: that one is per
// PROCESS, so every replica grants the full allowance independently, which is
// not what the limit it replaces did.
type SignupGate func(ctx context.Context, ip string) (allowed bool, err error)

// WithSignupGate wires the cross-replica signup budget.
func (h *AuthHandler) WithSignupGate(g SignupGate) *AuthHandler {
	h.signupGate = g
	return h
}

// OTPVerifier redeems a code. Injected for the same ordering reason as
// OTPIssuer.
type OTPVerifier func(ctx context.Context, email, purpose, code, ip string) error

// WithOTPVerifier wires code redemption into the password-reset completion.
func (h *AuthHandler) WithOTPVerifier(fn OTPVerifier) *AuthHandler {
	h.verifyOTP = fn
	return h
}

// WithLoginMFA makes a correct password produce a code challenge rather than a
// session. Ignored without an issuer: a challenge with no way to receive a code
// is a locked door for every user at once.
func (h *AuthHandler) WithLoginMFA(enabled bool) *AuthHandler {
	h.loginMFA = enabled
	return h
}

// WithPasswordSetter enables the code-based half of password reset.
func (h *AuthHandler) WithPasswordSetter(p services.PasswordSetter) *AuthHandler {
	h.setPassword = p
	return h
}

// mfaActive reports whether Login should challenge instead of returning tokens.
func (h *AuthHandler) mfaActive() bool { return h.loginMFA && h.issueOTP != nil }

func asStr(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func asIntFromAny(v any) int {
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

// deviceFingerprint derives a stable, non-PII device hint from request headers.
func deviceFingerprint(c *gin.Context) string {
	ua := strings.TrimSpace(c.Request.UserAgent())
	if fp := strings.TrimSpace(c.GetHeader("X-Device-Fingerprint")); fp != "" {
		return fp
	}
	if ua == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(ua))
	return hex.EncodeToString(sum[:])[:32]
}

func (h *AuthHandler) Register(c *gin.Context) {
	var in domain.RegisterRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	// Signup budget. Only present when registration takes the admin path — on
	// /auth/v1/signup GoTrue applies its own, and a second one here would halve
	// the shipped allowance.
	// Checked BEFORE the account is created, and fails CLOSED: a limiter that
	// answers "allowed" when its store is unreachable reports protection it is
	// not providing.
	if h.signupGate != nil {
		allowed, gerr := h.signupGate(c.Request.Context(), c.ClientIP())
		if gerr != nil {
			log.Printf("[auth] register: signup budget could not be evaluated, refusing: %v", gerr)
			c.JSON(http.StatusTooManyRequests, gin.H{
				"success": false, "code": "signup_rate_limited",
				"error": "Too many registration attempts. Please try again shortly.",
			})
			return
		}
		if !allowed {
			h.audit.LogAction("", "", "register.rate_limited", "auth", "user", "", nil,
				map[string]any{"ip": c.ClientIP()}, c.ClientIP(), c.Request.UserAgent(), "medium")
			c.JSON(http.StatusTooManyRequests, gin.H{
				"success": false, "code": "signup_rate_limited",
				"error": "Too many registration attempts. Please try again shortly.",
			})
			return
		}
	}

	res, err := h.auth.RegisterUser(c.Request.Context(), in)
	if err != nil {
		h.audit.LogAction("", "", "register.failed", "auth", "user", "", nil, map[string]any{"email": in.Email}, c.ClientIP(), c.Request.UserAgent(), "medium")

		// Signups-closed is a project-wide policy, not a fact about this
		// address, so saying so leaks nothing. Every other failure stays generic
		// and unconditional — confirming "already registered" would let anyone
		// test which addresses have accounts — while pointing at the real next
		// steps (sign in / reset password) without confirming either applies.
		if errors.Is(err, services.ErrSignupDisabled) {
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"code":    "signup_disabled",
				"error":   "New registrations are currently closed. Please try again later.",
			})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "We couldn't create this account. Try signing in if you have one, or use Forgot Password — otherwise, double-check your details and try again."})
		return
	}

	// A decoy result means the address already has an account (the service
	// detected GoTrue's email_exists answer). The response below must stay
	// indistinguishable from a fresh unverified signup — any difference is an
	// account-existence oracle — so it is rendered by the same code. Only the
	// side effects differ: no referral attribution against a fabricated user id,
	// and an honest audit action instead of "register.success". The verification
	// code still goes out — the message claims one was emailed, and a real owner
	// who forgot they registered can redeem it to get in.
	if res.AlreadyExisted {
		h.audit.LogAction("", "", "register.duplicate", "auth", "user", "", nil,
			map[string]any{"email": in.Email, "userType": in.UserTypeOrDefault()}, c.ClientIP(), c.Request.UserAgent(), "medium")
	} else {
		// Attribution never blocks signup: the account exists, and a referral credit is
		// not worth failing a registration over. Idempotent on referred_user_id, so a
		// retry is safe.
		if h.attributeReferral != nil && res.UserID != "" {
			if err := h.attributeReferral(c.Request.Context(), res.UserID, in.ReferralCode); err != nil {
				log.Printf("[auth] register: referral attribution failed for %s: %v", res.UserID, err)
			}
		}

		h.audit.LogAction(res.UserID, res.UserID, "register.success", "auth", "user", res.UserID, nil,
			map[string]any{"email": in.Email, "userType": in.UserTypeOrDefault()}, c.ClientIP(), c.Request.UserAgent(), "info")
	}

	needsVerification := res.NeedsVerification()
	message := "Registration successful. Enter the code we emailed you to verify your account."
	if !needsVerification {
		message = "Registration successful."
	}

	// Best-effort, exactly like referral attribution above: THE ACCOUNT ALREADY
	// EXISTS. Failing the response here would send the user back to a register
	// form that answers "registration failed" for an account that is genuinely
	// theirs — the worst outcome available. A user who receives no code can ask
	// for one at POST /api/auth/otp/request, which is rate-limited the same way.
	// ⚠️ While Supabase's own confirmation mailer is enabled on the project, a
	// registering user receives TWO codes from two systems, and each is redeemed
	// at a different endpoint. Turning that mailer off is a prerequisite for
	// enabling FEATURE_OTP_EMAIL_ENABLED anywhere real — see
	// docs/runbooks/otp-email-brevo.md.
	if needsVerification && h.issueOTP != nil {
		if err := h.issueOTP(c.Request.Context(), in.Email, in.FullNameOrJoin(), otp.PurposeVerifyEmail, c.ClientIP()); err != nil {
			// No address in the log line: an access log of addresses is a user list.
			log.Printf("[auth] register: verification code could not be issued for user %s: %v", res.UserID, err)
		}
	}

	// The session is carried in THREE shapes on purpose, exactly as Login does:
	// each existing client reads it differently and none should have to change.
	//   session.access_token  — the prod mobile app
	//   tokens.accessToken    — the web gateway's historic shape
	//   access_token          — apps/mobile-starter, which reads it alongside user
	body := gin.H{
		"success":           true,
		"message":           message,
		"needsVerification": needsVerification,
		"user":              gin.H{"id": res.UserID, "email": res.Email, "fullName": in.FullNameOrJoin()},
		"session":           gin.H{"access_token": res.AccessToken, "refresh_token": res.RefreshToken},
		"tokens":            gin.H{"accessToken": res.AccessToken, "refreshToken": res.RefreshToken},
		"access_token":      res.AccessToken,
		"refresh_token":     res.RefreshToken,
	}
	c.JSON(http.StatusCreated, body)
}

func (h *AuthHandler) Login(c *gin.Context) {
	var in domain.LoginRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	out, err := h.auth.LoginUser(c.Request.Context(), in)
	if err != nil {
		// LoginUser wraps its errors with the identity it resolved before
		// failing — a phone identifier becomes the account email, and the
		// platform user id is attached once platform_users has answered — so
		// the login_activity row is attributable even on a refusal
		// (E2E-AUTH-007). Falling back to in.Email preserves direct-email
		// callers whose identifier was never resolved.
		failUserID, failEmail := "", in.Email
		if fail, ok := errors.AsType[*services.LoginFailureError](err); ok {
			failUserID = fail.UserID
			if fail.Email != "" {
				failEmail = fail.Email
			}
		}
		// Correct password, unverified address. Answered distinctly so the client
		// can route the user to enter their code instead of reporting a wrong
		// password. See ErrEmailNotConfirmed for why this does not leak account
		// existence.
		if errors.Is(err, services.ErrEmailNotConfirmed) {
			h.audit.LogLogin(failUserID, failEmail, "failed", "email_not_confirmed", c.ClientIP(), c.Request.UserAgent(), map[string]any{})
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"code":    "email_not_confirmed",
				"error":   "Your email address has not been verified yet.",
			})
			return
		}
		// GoTrue was unreachable/degraded — the service never reached a
		// credential verdict and counted NO strike. This must not look like a
		// wrong password (E2E-FR-049). The row is written too — an outage window
		// is exactly what forensics needs to reconstruct — but with the honest
		// "upstream_error" reason rather than a false invalid_credentials
		// (failure_reason is free text; only status is CHECK-constrained).
		if errors.Is(err, services.ErrAuthUnavailable) {
			h.audit.LogLogin(failUserID, failEmail, "failed", "upstream_error", c.ClientIP(), c.Request.UserAgent(), map[string]any{})
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"success": false,
				"code":    "auth_unavailable",
				"error":   "Sign-in is temporarily unavailable. Please try again shortly.",
			})
			return
		}
		h.audit.LogLogin(failUserID, failEmail, "failed", "invalid_credentials", c.ClientIP(), c.Request.UserAgent(), map[string]any{})
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "invalid credentials"})
		return
	}

	// Strip the internal hints BEFORE any branch can return `out` to a client —
	// they must never reach the caller regardless of which flags are on.
	loginUserID, _ := out["__user_id"].(string)
	resolvedEmail, _ := out["__email"].(string)
	delete(out, "__user_id")
	delete(out, "__email")

	// Success is attributed the same way the failure paths are: the resolved
	// account identity, not the raw request fields — identifier logins carry
	// no email (E2E-AUTH-007).
	h.audit.LogLogin(loginUserID, resolvedEmail, "success", "", c.ClientIP(), c.Request.UserAgent(), map[string]any{})

	// Second factor. The password was correct, so GoTrue already minted a
	// session in `out` — it is DISCARDED and a fresh one is minted on code
	// redemption (parking it would mean persisting live tokens while waiting
	// on an email). Fails CLOSED: if the code cannot be sent, no session is
	// returned — an email outage is a total login outage. See the runbook.
	if h.mfaActive() {
		if resolvedEmail == "" {
			// Nothing to send to. Refusing beats returning a session that the
			// second factor was supposed to gate.
			log.Printf("[auth] login: MFA is on but no account email was resolved")
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"success": false, "code": "mfa_send_failed",
				"error": "We could not send your sign-in code. Please try again shortly.",
			})
			return
		}
		if err := h.issueOTP(c.Request.Context(), resolvedEmail, "", otp.PurposeLogin, c.ClientIP()); err != nil {
			log.Printf("[auth] login: second-factor code could not be issued: %v", err)
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"success": false,
				"code":    "mfa_send_failed",
				"error":   "We could not send your sign-in code. Please try again shortly.",
			})
			return
		}
		// No tokens in this response, deliberately: a client that reads
		// access_token opportunistically must not find one here.
		c.JSON(http.StatusOK, gin.H{
			"success":     true,
			"mfaRequired": true,
			"purpose":     otp.PurposeLogin,
			"message":     "Enter the code we emailed you to finish signing in.",
		})
		return
	}

	// Session hardening (#19): issue a tracked session + run suspicious-login
	// detection. Gated by the feature flag; never blocks a valid login.
	if h.sessionHardening && h.sessions != nil {
		userID := loginUserID
		lc := services.LoginContext{
			IPAddress:         c.ClientIP(),
			UserAgent:         c.Request.UserAgent(),
			DeviceFingerprint: deviceFingerprint(c),
		}
		if userID != "" {
			// Evaluate suspicious signals BEFORE recording this device as known.
			_, _ = h.sessions.EvaluateLogin(userID, in.Email, lc)
			tokens := services.IssuedTokens{
				AccessToken:  asStr(out["access_token"]),
				RefreshToken: asStr(out["refresh_token"]),
				ExpiresIn:    asIntFromAny(out["expires_in"]),
			}
			_, _ = h.sessions.IssueSession(userID, tokens, lc)
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "session": out})
}

func (h *AuthHandler) Me(c *gin.Context) {
	u, ok := middleware.GetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "user": u})
}

// Logout revokes the caller's session server-side (E2E-SEC-055): the bearer
// token goes to GoTrue's /auth/v1/logout so the session stops validating, and
// the tracked auth_sessions row is revoked when session hardening is on (it is
// the enforcement gate for locally-verified tokens). A GoTrue outage still
// answers 200 — the client's local logout must not depend on upstream health —
// but the failure is logged and carried in the audit row.
func (h *AuthHandler) Logout(c *gin.Context) {
	u, ok := middleware.GetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	token := c.GetString(middleware.AuthTokenContextKey)
	if token == "" {
		if ah := strings.TrimSpace(c.GetHeader("Authorization")); strings.HasPrefix(strings.ToLower(ah), "bearer ") {
			token = strings.TrimSpace(ah[7:])
		}
	}
	revoked := false
	if token != "" {
		if err := h.auth.LogoutUser(token); err != nil {
			log.Printf("[auth] logout: GoTrue session revoke failed for user %s: %v", u.ID, err)
		} else {
			revoked = true
		}
		if h.sessionHardening && h.sessions != nil {
			if sess, err := h.sessions.ValidateAccess(c.Request.Context(), token); err == nil && sess != nil {
				_ = h.sessions.RevokeOne(u.ID, u.ID, sess.ID, "logout")
			}
		}
	}
	h.audit.LogAction(u.ID, u.ID, "logout", "auth", "session", "", nil,
		map[string]any{"upstream_revoked": revoked}, c.ClientIP(), c.Request.UserAgent(), "info")
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Logged out"})
}

func (h *AuthHandler) RequestPasswordReset(c *gin.Context) {
	var in struct {
		Email string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&in); err == nil {
		if err := h.auth.RequestPasswordReset(c.Request.Context(), in.Email); err != nil {
			// Log the address NEVER — only that the upstream failed. The response
			// below is byte-identical either way, because varying it would reveal
			// which addresses have accounts.
			log.Printf("[auth] password reset upstream failed: %v", err)
		}
		// Our own code, ALONGSIDE Supabase's reset link rather than instead of it,
		// so no existing client that completes a reset through the link breaks.
		// ⚠️ The cost is that a user asking to reset gets TWO emails offering two
		// different mechanisms. That is a deliberate, temporary state — see
		// docs/runbooks/otp-email-brevo.md.
		// Best-effort and silent: the response must not vary, and the link has
		// already been sent, so a code failure still leaves the user a way in.
		if h.issueOTP != nil {
			if err := h.issueOTP(c.Request.Context(), in.Email, "", otp.PurposePasswordReset, c.ClientIP()); err != nil {
				log.Printf("[auth] password reset: code could not be issued: %v", err)
			}
		}
	}
	// Always the same answer, whether or not the account exists.
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "If your email exists, reset instructions were sent."})
}

// ResetPassword completes a reset with an emailed CODE.
// The legacy {token, newPassword} form is REFUSED rather than answered with a
// false success — no service method can honor a bare token here; web and mobile
// complete resets through Supabase's own recovery session.
func (h *AuthHandler) ResetPassword(c *gin.Context) {
	var in struct {
		Email       string `json:"email"`
		Code        string `json:"code"`
		Token       string `json:"token"`
		NewPassword string `json:"newPassword" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}

	email := strings.ToLower(strings.TrimSpace(in.Email))
	code := strings.TrimSpace(in.Code)
	if email == "" || code == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "A verification code is required. Request one at /api/auth/request-password-reset, or complete the reset through the emailed link.",
		})
		return
	}
	if h.verifyOTP == nil || h.setPassword == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false, "error": "feature_disabled", "feature": "otp_email",
		})
		return
	}

	if err := h.verifyOTP(c.Request.Context(), email, otp.PurposePasswordReset, code, c.ClientIP()); err != nil {
		switch {
		case errors.Is(err, otp.ErrTooManyAttempts), errors.Is(err, otp.ErrRateLimited):
			c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "error": "too many attempts, request a new code"})
		case errors.Is(err, otp.ErrExpired):
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "code expired, request a new code"})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid code"})
		}
		return
	}

	// The code is consumed. From here the caller must be told the truth about
	// whether their password actually changed.
	changed, err := h.setPassword.SetPassword(c.Request.Context(), email, in.NewPassword)
	if err != nil {
		if errors.Is(err, services.ErrAccountUnavailable) {
			c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "account unavailable"})
			return
		}
		log.Printf("[auth] reset-password: could not set password: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false, "error": "could not reset your password, please request a new code"})
		return
	}
	// changed == false means no account for that address. Answered as success:
	// the request endpoint deliberately does not disclose whether an account
	// exists, and neither does this one.
	_ = changed

	h.audit.LogAction("", "", "password.reset", "auth", "user", "", nil, nil, c.ClientIP(), c.Request.UserAgent(), "high")
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Password reset successful"})
}

func (h *AuthHandler) ChangePassword(c *gin.Context) {
	u, ok := middleware.GetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	var in struct {
		CurrentPassword string `json:"currentPassword" binding:"required,min=8"`
		NewPassword     string `json:"newPassword" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	authz := c.GetHeader("Authorization")
	if len(authz) < 8 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "missing bearer token"})
		return
	}
	if err := h.auth.ChangePassword(c.Request.Context(), authz[7:], in.CurrentPassword, in.NewPassword); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	h.audit.LogAction(u.ID, u.ID, "password.change", "auth", "user", u.ID, nil, nil, c.ClientIP(), c.Request.UserAgent(), "high")
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Password changed"})
}

func (h *AuthHandler) CompleteProfile(c *gin.Context) {
	u, ok := middleware.GetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	var in struct {
		ProfileType string         `json:"profileType" binding:"required"`
		Metadata    map[string]any `json:"metadata"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if err := h.auth.CompleteProfile(c.Request.Context(), u.ID, in.ProfileType, in.Metadata); err != nil {
		// ErrProfileStoreFailed wraps the raw PostgREST error body — table,
		// column and constraint names, which must never reach a client. The
		// detail goes to the log; the client gets a generic failure.
		if errors.Is(err, services.ErrProfileStoreFailed) {
			log.Printf("[auth] complete-profile: profile write failed for %s: %v", u.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "internal server error"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	h.audit.LogAction(u.ID, u.ID, "profile.complete", "auth", "profile", u.ID, nil, map[string]any{"profileType": in.ProfileType}, c.ClientIP(), c.Request.UserAgent(), "info")
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// SessionHandler exposes the self-service + admin session-management surface.
// Every route is gated behind FEATURE_SESSION_HARDENING_ENABLED (default OFF):
// when the flag is off, handlers return 503 feature-disabled (deny-by-default).
type SessionHandler struct {
	sessions services.SessionService
	audit    services.AuditService
	cfg      config.Config
}

func NewSessionHandler(sessions services.SessionService, audit services.AuditService, cfg config.Config) *SessionHandler {
	return &SessionHandler{sessions: sessions, audit: audit, cfg: cfg}
}

func (h *SessionHandler) featureGuard(c *gin.Context) bool {
	if !h.cfg.FeatureSessionHardeningEnabled {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": "feature_disabled", "feature": "session_hardening"})
		return false
	}
	return true
}

// ListMySessions handles GET /api/auth/sessions — list the caller's own active sessions.
func (h *SessionHandler) ListMySessions(c *gin.Context) {
	// Auth BEFORE the flag check: answering feature_disabled first let an
	// unauthenticated probe learn whether session hardening is enabled.
	u, ok := middleware.GetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	if !h.featureGuard(c) {
		return
	}
	list, err := h.sessions.ListMySessions(u.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load sessions"})
		return
	}
	out := make([]gin.H, 0, len(list))
	for _, s := range list {
		out = append(out, gin.H{
			"id":              s.ID,
			"device":          s.DeviceFingerprint,
			"ip":              s.IPAddress,
			"userAgent":       s.UserAgent,
			"rotationCounter": s.RotationCounter,
			"lastSeenAt":      s.LastSeenAt,
			"expiresAt":       s.ExpiresAt,
			"createdAt":       s.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "sessions": out})
}

// RevokeMySession handles DELETE /api/auth/sessions/:id — revoke one of the caller's own sessions.
func (h *SessionHandler) RevokeMySession(c *gin.Context) {
	u, ok := middleware.GetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	if !h.featureGuard(c) {
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	if err := h.sessions.RevokeOne(u.ID, u.ID, id, "self_revoke"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "session revoked"})
}

// RevokeMyAllSessions handles POST /api/auth/sessions/revoke-all — revoke all of the caller's sessions.
func (h *SessionHandler) RevokeMyAllSessions(c *gin.Context) {
	u, ok := middleware.GetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	if !h.featureGuard(c) {
		return
	}
	n, err := h.sessions.RevokeAll(u.ID, u.ID, "self_revoke_all")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not revoke sessions"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "revoked": n})
}

// AdminForceLogout handles POST /api/admin/users/:id/force-logout — admin revokes all of a user's sessions.
func (h *SessionHandler) AdminForceLogout(c *gin.Context) {
	actor, ok := middleware.GetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	if !h.featureGuard(c) {
		return
	}
	target := strings.TrimSpace(c.Param("id"))
	if target == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "user id required"})
		return
	}
	n, err := h.sessions.AdminForceLogout(actor.ID, target, "admin_force_logout")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not force logout"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "revoked": n})
}

// AdminForcePasswordReset handles POST /api/admin/users/:id/force-password-reset — admin forces a reset + revoke.
func (h *SessionHandler) AdminForcePasswordReset(c *gin.Context) {
	actor, ok := middleware.GetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	if !h.featureGuard(c) {
		return
	}
	target := strings.TrimSpace(c.Param("id"))
	if target == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "user id required"})
		return
	}
	if err := h.sessions.AdminForcePasswordReset(actor.ID, target, "admin_force_reset"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not force password reset"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "password reset enforced; sessions revoked"})
}
