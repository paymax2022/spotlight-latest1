package feestrustscore

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes School Trust Score read + admin override over Gin. Router registration into
// RegisterAcademy is owned by the QA/integration task — see RegisterFeesTrustScore.
//
// NOTE (integration wiring): this package takes a MetricsReader + OverrideStore rather than a
// pgx pool, because the metrics are aggregated across the invoice / payment / reconciliation
// packages. The integration task constructs those adapters (backed by the fees repos) and calls
// RegisterFeesTrustScore with the assembled Service.
type Handler struct {
	svc *Service
}

// NewHandler builds the trust-score handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrMissingSchool):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_school", "message": err.Error()})
	case errors.Is(err, ErrMissingReason):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_override_reason", "message": err.Error()})
	case errors.Is(err, ErrInvalidScore):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_score", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterFeesTrustScore wires trust-score routes onto the passed admin group using an
// already-assembled Service (the integration task builds the MetricsReader/OverrideStore
// adapters). nil svc/group is skipped. Routes should be gated by the integration task with
// middleware.RequirePermission(rbac, "academy.fees.trustscore.*").
//
//	admin: GET  /trust-score/:schoolId            compute (+ active override) a school's score
//	       POST /trust-score/:schoolId/override    admin override (records actor + reason)
func RegisterFeesTrustScore(admin *gin.RouterGroup, svc *Service, rbac services.RBACService) *Handler {
	if svc == nil {
		return nil
	}
	h := NewHandler(svc)
	if admin != nil {
		tg := admin.Group("/trust-score")
		tg.GET("/:schoolId", h.Compute)
		tg.POST("/:schoolId/override", h.Override)
	}
	_ = rbac
	return h
}

// ── Handlers ────────────────────────────────────────────────────────────────────

func (h *Handler) Compute(c *gin.Context) {
	out, err := h.svc.Compute(c.Request.Context(), c.Param("schoolId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Override(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req OverrideRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	req.SchoolID = c.Param("schoolId")
	out, err := h.svc.Override(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
