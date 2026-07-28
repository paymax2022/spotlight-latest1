package identity

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the academy identity-bridge over Gin. Member routes resolve the
// caller from gin context (c.GetString("user_id"), set by the auth middleware).
// Admin routes are guarded by RBAC permission "academy.identity".
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// RegisterAcademyIdentity mounts the identity-bridge routes.
//
//	member: /academy/me, /academy/roles, /academy/profile, /academy/guardians/*
//	admin:  /academy/admin/users/:id, /academy/admin/guardians/:id/revoke
func RegisterAcademyIdentity(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		return
	}
	h := NewHandler(NewService(pool))
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }

	if member != nil {
		mg := member.Group("/academy")
		mg.GET("/me", h.GetMe)
		mg.POST("/roles", h.GrantRole)
		mg.PUT("/profile", h.UpsertProfile)
		mg.POST("/guardians/link", h.LinkGuardian)
		mg.POST("/guardians/:minorId/consent", h.RecordConsent)
	}

	if admin != nil {
		ag := admin.Group("/academy")
		ag.GET("/admin/users/:id", guard("academy.identity"), h.AdminLookup)
		ag.POST("/admin/guardians/:id/revoke", guard("academy.identity"), h.AdminRevokeGuardian)
	}
}

// uid resolves the authenticated user from gin context; aborts 401 if absent.
func (h *Handler) uid(c *gin.Context) (string, bool) {
	id := c.GetString("user_id")
	if id == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication_required"})
		return "", false
	}
	return id, true
}

// fail maps domain errors to HTTP statuses with stable snake_case codes.
func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_transition"})
	case errors.Is(err, ErrInvalidRole):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_role"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// ── Member handlers ───────────────────────────────────────────────────────────

func (h *Handler) GetMe(c *gin.Context) {
	uid, ok := h.uid(c)
	if !ok {
		return
	}
	me, err := h.svc.GetMe(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, me)
}

func (h *Handler) GrantRole(c *gin.Context) {
	uid, ok := h.uid(c)
	if !ok {
		return
	}
	var req GrantRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	if err := h.svc.GrantRole(c.Request.Context(), uid, req.Role); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "role": req.Role})
}

func (h *Handler) UpsertProfile(c *gin.Context) {
	uid, ok := h.uid(c)
	if !ok {
		return
	}
	var req UpsertProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	p, err := h.svc.UpsertProfile(c.Request.Context(), uid, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) LinkGuardian(c *gin.Context) {
	uid, ok := h.uid(c)
	if !ok {
		return
	}
	var req LinkGuardianRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	// The authenticated caller is the guardian creating the link.
	gl, err := h.svc.LinkGuardian(c.Request.Context(), uid, req.MinorUserID)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gl)
}

func (h *Handler) RecordConsent(c *gin.Context) {
	uid, ok := h.uid(c)
	if !ok {
		return
	}
	minorID := c.Param("minorId")
	var req RecordConsentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	// The authenticated caller is the guardian granting consent; they are also the actor.
	consentID, err := h.svc.RecordConsent(c.Request.Context(), uid, minorID, req.Scope, uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"consent_id": consentID, "status": "active"})
}

// ── Admin handlers ────────────────────────────────────────────────────────────

func (h *Handler) AdminLookup(c *gin.Context) {
	me, err := h.svc.AdminLookup(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, me)
}

func (h *Handler) AdminRevokeGuardian(c *gin.Context) {
	actorID := c.GetString("user_id")
	gl, err := h.svc.RevokeGuardianLink(c.Request.Context(), c.Param("id"), actorID)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gl)
}
