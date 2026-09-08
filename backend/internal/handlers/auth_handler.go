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
//
// A function rather than the otp.Service itself, for the same reason
// ReferralAttributor is: the service needs the shared pgx pool, which is built
// after this handler.
type OTPIssuer func(ctx context.Context, email, name, purpose string, ip string) error

// WithOTPIssuer makes Register send our own verification code.
//
// Without it Register is unchanged and verification stays entirely with Supabase
// Auth, which is the shipped behaviour.
func (h *AuthHandler) WithOTPIssuer(fn OTPIssuer) *AuthHandler {
	h.issueOTP = fn
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
	res, err := h.auth.RegisterUser(in)
	if err != nil {
		h.audit.LogAction("", "", "register.failed", "auth", "user", "", nil, map[string]any{"email": in.Email}, c.ClientIP(), c.Request.UserAgent(), "medium")

		// Signups being closed is a PROJECT-WIDE policy, not a fact about this
		// address, so saying so leaks nothing and telling the user their "details"
		// are wrong would send them round a loop they cannot win. Every other
		// failure stays deliberately generic — echoing "already registered" would
		// let anyone test which addresses have accounts.
		if errors.Is(err, services.ErrSignupDisabled) {
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"code":    "signup_disabled",
				"error":   "New registrations are currently closed. Please try again later.",
			})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Registration failed. Please check your details and try again."})
		return
	}

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

	needsVerification := res.NeedsVerification()
	message := "Registration successful. Enter the code we emailed you to verify your account."
	if !needsVerification {
		message = "Registration successful."
	}

	// Send our own verification code.
	//
	// Best-effort, exactly like referral attribution above: THE ACCOUNT ALREADY
	// EXISTS. Failing the response here would send the user back to a register
	// form that answers "registration failed" for an account that is genuinely
	// theirs — the worst outcome available. A user who receives no code can ask
	// for one at POST /api/auth/otp/request, which is rate-limited the same way.
	//
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
	out, err := h.auth.LoginUser(in)
	if err != nil {
		// Correct password, unverified address. Answered distinctly so the client
		// can send the user to enter their code instead of telling them their
		// password is wrong — which is what it used to say, leaving them stuck
		// with no route forward. See ErrEmailNotConfirmed for why this does not
		// leak account existence.
		if errors.Is(err, services.ErrEmailNotConfirmed) {
			h.audit.LogLogin("", in.Email, "failed", "email_not_confirmed", c.ClientIP(), c.Request.UserAgent(), map[string]any{})
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"code":    "email_not_confirmed",
				"error":   "Your email address has not been verified yet.",
			})
			return
		}
		h.audit.LogLogin("", in.Email, "failed", "invalid_credentials", c.ClientIP(), c.Request.UserAgent(), map[string]any{})
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "invalid credentials"})
		return
	}
	h.audit.LogLogin("", in.Email, "success", "", c.ClientIP(), c.Request.UserAgent(), map[string]any{})

	// Strip the internal hints BEFORE any branch can return `out` to a client.
	// They were previously removed only inside the session-hardening branch, so
	// with that flag off __user_id was shipped to the caller despite the comment
	// saying it never is.
	loginUserID, _ := out["__user_id"].(string)
	resolvedEmail, _ := out["__email"].(string)
	delete(out, "__user_id")
	delete(out, "__email")

	// Second factor. The password was correct, so GoTrue has already minted a
	// session in `out` — it is DISCARDED here rather than parked anywhere, and a
	// fresh one is minted by the verify step once the code is redeemed. Holding
	// it would mean writing an access and a refresh token to storage to wait for
	// an email, which is a worse trade than one extra GoTrue round trip.
	//
	// Fails CLOSED: if the code cannot be sent, no session is returned. That is
	// the opposite of Register, where the account already exists and refusing
	// would strand the user — here refusing is the whole point of the factor.
	// ⚠️ It also means an email outage is a total login outage. See the runbook.
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

func (h *AuthHandler) Logout(c *gin.Context) {
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		h.audit.LogAction(u.ID, u.ID, "logout", "auth", "session", "", nil, nil, c.ClientIP(), c.Request.UserAgent(), "info")
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Logged out"})
}

func (h *AuthHandler) RequestPasswordReset(c *gin.Context) {
	var in struct {
		Email string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&in); err == nil {
		if err := h.auth.RequestPasswordReset(in.Email); err != nil {
			// Log the address NEVER — only that the upstream failed. The response
			// below is byte-identical either way, because varying it would reveal
			// which addresses have accounts.
			log.Printf("[auth] password reset upstream failed: %v", err)
		}
		// Our own code, ALONGSIDE Supabase's reset link rather than instead of it,
		// so no existing client that completes a reset through the link breaks.
		//
		// ⚠️ The cost is that a user asking to reset gets TWO emails offering two
		// different mechanisms. That is a deliberate, temporary state — see
		// docs/runbooks/otp-email-brevo.md.
		//
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
//
// It used to accept {token, newPassword}, hand the token to a service method
// that returned nil for any non-empty string, and answer "Password reset
// successful" — for a password it had not changed. That is the same defect the
// audit removed as B4 on verify-email, still live here. Nothing called it: web
// and mobile both complete resets through Supabase's own recovery session, which
// is why nobody noticed.
//
// The token form is now REFUSED rather than answered with a false success. A
// caller relying on it was already getting nothing; the difference is that it
// now says so.
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
	if err := h.auth.ChangePassword(authz[7:], in.CurrentPassword, in.NewPassword); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
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
	if err := h.auth.CompleteProfile(u.ID, in.ProfileType, in.Metadata); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(u.ID, u.ID, "profile.complete", "auth", "profile", u.ID, nil, map[string]any{"profileType": in.ProfileType}, c.ClientIP(), c.Request.UserAgent(), "info")
	c.JSON(http.StatusOK, gin.H{"success": true})
}
