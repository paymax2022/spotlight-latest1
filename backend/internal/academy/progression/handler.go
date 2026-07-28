package progression

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the progression surface over Gin.
//   - member: build/read learning paths, advance steps, adaptive practice, recommendations.
//   - admin : adaptive_config get/upsert.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated learner (mirrors the assessment package).
func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_transition", "message": err.Error()})
	case errors.Is(err, ErrNotMastered):
		c.JSON(http.StatusConflict, gin.H{"error": "not_mastered", "message": err.Error()})
	case errors.Is(err, ErrInvalidInput), errors.Is(err, ErrNoObjectives):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterAcademyProgression wires the progression routes. Mirrors
// RegisterAcademyAssessment: it builds its own service from the pool and gates
// admin routes with middleware.RequirePermission(rbac, perm). Member routes are
// BARE subpaths (the aggregator passes a /api/finance/academy base group).
//
//	member: GET  /progression/paths/:subjectId
//	        POST /progression/paths
//	        POST /progression/steps/:objectiveId/advance
//	        POST /progression/practice/adaptive
//	        GET  /progression/recommendations
//	admin : GET/PUT /progression/adaptive-config under RBAC academy.assessment|academy.curriculum
func RegisterAcademyProgression(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	svc := NewService(pool)
	h := NewHandler(svc)

	// ── Member (learner) ──
	member.GET("/progression/paths/:subjectId", h.GetPath)
	member.POST("/progression/paths", h.BuildPath)
	member.POST("/progression/steps/:objectiveId/advance", h.AdvanceStep)
	member.POST("/progression/practice/adaptive", h.AdaptivePractice)
	member.GET("/progression/recommendations", h.GetRecommendations)

	// ── Admin (adaptive config) ──
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	ac := admin.Group("/progression")
	ac.GET("/adaptive-config", guard("academy.assessment"), h.AdminGetAdaptiveConfig)
	ac.PUT("/adaptive-config", guard("academy.curriculum"), h.AdminUpsertAdaptiveConfig)
}

// ── Member handlers ─────────────────────────────────────────────────────────────

func (h *Handler) GetPath(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.GetPath(c.Request.Context(), u, c.Param("subjectId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) BuildPath(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req BuildPathRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.BuildPath(c.Request.Context(), u, u, req.SubjectID, req.ClassID)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdvanceStep(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.AdvanceStep(c.Request.Context(), u, u, c.Param("objectiveId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdaptivePractice(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req AdaptivePracticeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.AdaptivePractice(c.Request.Context(), u, req.SubjectID, req.ObjectiveIDs, req.Limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetRecommendations(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.Recommendations(c.Request.Context(), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── Admin handlers ──────────────────────────────────────────────────────────────

func (h *Handler) AdminGetAdaptiveConfig(c *gin.Context) {
	if key := c.Query("key"); key != "" {
		out, err := h.svc.GetAdaptiveConfig(c.Request.Context(), key)
		if err != nil {
			h.fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": out})
		return
	}
	out, err := h.svc.ListAdaptiveConfig(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminUpsertAdaptiveConfig(c *gin.Context) {
	var req UpsertAdaptiveConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpsertAdaptiveConfig(c.Request.Context(), uid(c), req.Key, req.Value)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
