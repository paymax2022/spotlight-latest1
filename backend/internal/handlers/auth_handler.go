package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

type AuthHandler struct {
	auth  services.AuthService
	rbac  services.RBACService
	audit services.AuditService

	// Optional session-hardening collaborators (#19). Nil unless wired and the
	// feature flag is on; Login degrades gracefully when absent.
	sessions         services.SessionService
	sessionHardening bool
}

func NewAuthHandler(auth services.AuthService, rbac services.RBACService, audit services.AuditService) *AuthHandler {
	return &AuthHandler{auth: auth, rbac: rbac, audit: audit}
}

// WithSessions enables session issuance + suspicious-login evaluation on Login.
func (h *AuthHandler) WithSessions(sessions services.SessionService, enabled bool) *AuthHandler {
	h.sessions = sessions
	h.sessionHardening = enabled
	return h
}

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
	if err := h.auth.RegisterUser(in); err != nil {
		h.audit.LogAction("", "", "register.failed", "auth", "user", "", nil, map[string]any{"email": in.Email}, c.ClientIP(), c.Request.UserAgent(), "medium")
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction("", "", "register.success", "auth", "user", "", nil, map[string]any{"email": in.Email, "userType": in.UserType}, c.ClientIP(), c.Request.UserAgent(), "info")
	c.JSON(http.StatusCreated, gin.H{"success": true, "message": "Registration successful. Verify your email link."})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var in domain.LoginRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	out, err := h.auth.LoginUser(in)
	if err != nil {
		h.audit.LogLogin("", in.Email, "failed", "invalid_credentials", c.ClientIP(), c.Request.UserAgent(), map[string]any{})
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "invalid credentials"})
		return
	}
	h.audit.LogLogin("", in.Email, "success", "", c.ClientIP(), c.Request.UserAgent(), map[string]any{})

	// Session hardening (#19): issue a tracked session + run suspicious-login
	// detection. Gated by the feature flag; never blocks a valid login.
	if h.sessionHardening && h.sessions != nil {
		userID, _ := out["__user_id"].(string)
		delete(out, "__user_id") // internal-only hint; never returned to client
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
		_ = h.auth.RequestPasswordReset(in.Email)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "If your email exists, reset instructions were sent."})
}

func (h *AuthHandler) ResetPassword(c *gin.Context) {
	var in struct {
		Token       string `json:"token" binding:"required"`
		NewPassword string `json:"newPassword" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if err := h.auth.ResetPassword(in.Token, in.NewPassword); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Password reset successful"})
}

func (h *AuthHandler) VerifyEmail(c *gin.Context) {
	token := c.Query("token")
	if err := h.auth.VerifyEmailToken(token); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Email verified"})
}

func (h *AuthHandler) ResendVerificationLink(c *gin.Context) {
	var in struct {
		Email string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	_ = h.auth.ResendVerificationLink(in.Email)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Verification link sent if account exists"})
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
