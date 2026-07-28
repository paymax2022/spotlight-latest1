package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

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

// GET /api/auth/sessions — list the caller's own active sessions.
func (h *SessionHandler) ListMySessions(c *gin.Context) {
	if !h.featureGuard(c) {
		return
	}
	u, ok := middleware.GetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
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

// DELETE /api/auth/sessions/:id — revoke one of the caller's own sessions.
func (h *SessionHandler) RevokeMySession(c *gin.Context) {
	if !h.featureGuard(c) {
		return
	}
	u, ok := middleware.GetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	if err := h.sessions.RevokeOne(u.ID, u.ID, id, "self_revoke"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "session revoked"})
}

// POST /api/auth/sessions/revoke-all — revoke all of the caller's sessions.
func (h *SessionHandler) RevokeMyAllSessions(c *gin.Context) {
	if !h.featureGuard(c) {
		return
	}
	u, ok := middleware.GetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	n, err := h.sessions.RevokeAll(u.ID, u.ID, "self_revoke_all")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not revoke sessions"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "revoked": n})
}

// ── Admin ────────────────────────────────────────────────────────────────────

// POST /api/admin/users/:id/force-logout — admin revokes all of a user's sessions.
func (h *SessionHandler) AdminForceLogout(c *gin.Context) {
	if !h.featureGuard(c) {
		return
	}
	actor, _ := middleware.GetAuthenticatedUser(c)
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

// POST /api/admin/users/:id/force-password-reset — admin forces a reset + revoke.
func (h *SessionHandler) AdminForcePasswordReset(c *gin.Context) {
	if !h.featureGuard(c) {
		return
	}
	actor, _ := middleware.GetAuthenticatedUser(c)
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
