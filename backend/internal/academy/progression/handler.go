package progression

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

const keyUnauthenticated = "unauthenticated"

const keyMessage = "message"

const keyInvalidInput = "invalid_input"

const keyError = "error"

// Handler exposes the progression surface over Gin.
//   - member: build/read learning paths, advance steps, adaptive practice, recommendations.
//   - admin : adaptive_config get/upsert.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated learner (mirrors the assessment package).
// authUserID adapts middleware.GetAuthenticatedUser to ginutil.UserID’s
// fallback signature for contexts missing the "user_id" key.
func authUserID(c *gin.Context) string {
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{keyError: "not_found", keyMessage: httperr.Msg(c, http.StatusNotFound, err)})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{keyError: "illegal_transition", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrNotMastered):
		c.JSON(http.StatusConflict, gin.H{keyError: "not_mastered", keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrInvalidInput), errors.Is(err, ErrNoObjectives):
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: "internal", keyMessage: httperr.Msg(c, http.StatusInternalServerError, err)})
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

	member.GET("/progression/paths/:subjectId", h.GetPath)
	member.POST("/progression/paths", h.BuildPath)
	member.POST("/progression/steps/:objectiveId/advance", h.AdvanceStep)
	member.POST("/progression/practice/adaptive", h.AdaptivePractice)
	member.GET("/progression/recommendations", h.GetRecommendations)

	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	ac := admin.Group("/progression")
	ac.GET("/adaptive-config", guard("academy.assessment"), h.AdminGetAdaptiveConfig)
	ac.PUT("/adaptive-config", guard("academy.curriculum"), h.AdminUpsertAdaptiveConfig)
}

func (h *Handler) GetPath(c *gin.Context) {
	u := ginutil.UserID(c, authUserID)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
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
	u := ginutil.UserID(c, authUserID)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	var req BuildPathRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
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
	u := ginutil.UserID(c, authUserID)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
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
	u := ginutil.UserID(c, authUserID)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	var req AdaptivePracticeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
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
	u := ginutil.UserID(c, authUserID)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	out, err := h.svc.Recommendations(c.Request.Context(), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

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
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.UpsertAdaptiveConfig(c.Request.Context(), ginutil.UserID(c, authUserID), req.Key, req.Value)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
