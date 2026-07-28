package content

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the academy content CMS over Gin.
//   - member: live-content reads (lessons for an objective, live bundles, manifest).
//   - admin : publish transitions, the production board CRUD + advance, and
//     localization CRUD — all gated by RBAC academy.content.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated caller from gin context (set by auth middleware).
func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

// fail maps domain errors to HTTP statuses with stable snake_case codes.
func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_transition", "message": err.Error()})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterAcademyContent wires the content routes. Mirrors RegisterAcademyAssessment:
// it builds its own service from the pool and gates admin routes with
// middleware.RequirePermission(rbac, "academy.content").
//
//	member: /content/lessons/:objectiveId, /content/bundles, /content/bundles/:id/manifest
//	admin : /content/lessons/:id/publish, /content/bundles/:id/publish,
//	        /content/productions[/:id][/advance], /content/localizations
func RegisterAcademyContent(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		return
	}
	svc := NewService(pool)
	h := NewHandler(svc)

	// ── Member (learner) — live content only ──
	if member != nil {
		member.GET("/content/lessons/:objectiveId", h.GetLiveLessons)
		member.GET("/content/bundles", h.GetLiveBundles)
		member.GET("/content/bundles/:id/manifest", h.GetBundleManifest)
	}

	// ── Admin — academy.content capability ──
	if admin != nil {
		guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
		ag := admin.Group("/content", guard("academy.content"))

		// Publish transitions.
		ag.POST("/lessons/:id/publish", h.AdminTransitionLesson)
		ag.POST("/bundles/:id/publish", h.AdminTransitionBundle)

		// Production board.
		ag.GET("/productions", h.AdminListProductions)
		ag.POST("/productions", h.AdminCreateProduction)
		ag.GET("/productions/:id", h.AdminGetProduction)
		ag.PUT("/productions/:id", h.AdminUpdateProduction)
		ag.POST("/productions/:id/advance", h.AdminAdvanceProduction)

		// Localizations.
		ag.GET("/localizations", h.AdminListLocalizations)
		ag.POST("/localizations", h.AdminUpsertLocalization)
		ag.DELETE("/localizations", h.AdminDeleteLocalization)
	}
}

// ── Member handlers ───────────────────────────────────────────────────────────

func (h *Handler) GetLiveLessons(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.LiveLessonsForObjective(c.Request.Context(), c.Param("objectiveId"), limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetLiveBundles(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.LiveBundles(c.Request.Context(), limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetBundleManifest(c *gin.Context) {
	// Only live bundles expose a manifest to learners.
	b, err := h.svc.GetBundle(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	if b.Status != StatusLive {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "bundle not live"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": b.Manifest})
}

// ── Admin handlers: publish ─────────────────────────────────────────────────────

func (h *Handler) AdminTransitionLesson(c *gin.Context) {
	var req TransitionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.TransitionLesson(c.Request.Context(), uid(c), c.Param("id"), req.To)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminTransitionBundle(c *gin.Context) {
	var req TransitionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.TransitionBundle(c.Request.Context(), uid(c), c.Param("id"), req.To)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── Admin handlers: productions ─────────────────────────────────────────────────

func (h *Handler) AdminCreateProduction(c *gin.Context) {
	var req CreateProductionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateProduction(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminUpdateProduction(c *gin.Context) {
	var req UpdateProductionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpdateProduction(c.Request.Context(), uid(c), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminAdvanceProduction(c *gin.Context) {
	var req AdvanceProductionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.AdvanceProduction(c.Request.Context(), uid(c), c.Param("id"), req.To)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminGetProduction(c *gin.Context) {
	out, err := h.svc.GetProduction(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminListProductions(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	out, err := h.svc.ListProductions(c.Request.Context(), ProductionFilter{
		Stage:  c.Query("stage"),
		Status: c.Query("status"),
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── Admin handlers: localizations ───────────────────────────────────────────────

func (h *Handler) AdminUpsertLocalization(c *gin.Context) {
	var req UpsertLocalizationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpsertLocalization(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminListLocalizations(c *gin.Context) {
	out, err := h.svc.ListLocalizations(c.Request.Context(), c.Query("entity_type"), c.Query("entity_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminDeleteLocalization(c *gin.Context) {
	entityType := c.Query("entity_type")
	entityID := c.Query("entity_id")
	lang := c.Query("lang")
	if err := h.svc.DeleteLocalization(c.Request.Context(), uid(c), entityType, entityID, lang); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
