package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

type AuthHandler struct {
	auth  services.AuthService
	rbac  services.RBACService
	audit services.AuditService
}

func NewAuthHandler(auth services.AuthService, rbac services.RBACService, audit services.AuditService) *AuthHandler {
	return &AuthHandler{auth: auth, rbac: rbac, audit: audit}
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
