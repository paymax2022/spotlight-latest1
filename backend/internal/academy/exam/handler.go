package exam

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the exam-arena + CBT surface over Gin.
//   - member: arena/blueprint reads, attempt lifecycle, UTME combinations.
//   - admin : arena/blueprint/combination CRUD under RBAC academy.exam.
type Handler struct {
	svc *Service
}

// NewHandler constructs the exam handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated learner. Mirrors the assessment package: finance/
// connect groups mirror the auth user into c.Set("user_id", ...); fall back to the
// auth context if absent.
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
	case errors.Is(err, ErrNotEntitled):
		c.JSON(http.StatusForbidden, gin.H{"error": "not_entitled", "message": err.Error()})
	case errors.Is(err, ErrPauseNotAllowed), errors.Is(err, ErrInvalidInput), errors.Is(err, ErrAlreadyFinal):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterAcademyExam wires the exam routes. Mirrors RegisterAcademyAssessment:
// it builds its own service from the pool and gates admin routes with
// middleware.RequirePermission(rbac, "academy.exam").
//
//	member: /exam/arenas[...], /exam/attempts[...], /exam/utme/combinations
//	admin : /exam/arenas, /exam/blueprints, /exam/combinations CRUD under RBAC academy.exam
func RegisterAcademyExam(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	svc := NewService(pool)
	h := NewHandler(svc)

	// ── Member ──
	member.GET("/exam/arenas", h.ListArenas)
	member.GET("/exam/arenas/:id", h.GetArena)
	member.GET("/exam/arenas/:id/blueprints", h.ListBlueprints)
	member.POST("/exam/attempts", h.BeginAttempt)
	member.POST("/exam/attempts/:id/pause", h.PauseAttempt)
	member.POST("/exam/attempts/:id/resume", h.ResumeAttempt)
	member.POST("/exam/attempts/:id/submit", h.SubmitAttempt)
	member.GET("/exam/attempts/:id", h.GetAttempt)
	member.GET("/exam/attempts/:id/result", h.GetAttemptResult)
	member.GET("/exam/utme/combinations", h.GetCombinations)

	// ── Admin (academy.exam) ──
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	ex := admin.Group("/exam")
	ex.GET("/arenas", guard("academy.exam"), h.AdminListArenas)
	ex.GET("/blueprints", guard("academy.exam"), h.AdminListBlueprints)
	ex.GET("/combinations", guard("academy.exam"), h.AdminListCombinations)
	ex.POST("/arenas", guard("academy.exam"), h.AdminCreateArena)
	ex.PUT("/arenas/:id", guard("academy.exam"), h.AdminUpdateArena)
	ex.POST("/arenas/:id/blueprints", guard("academy.exam"), h.AdminCreateBlueprint)
	ex.PUT("/blueprints/:id", guard("academy.exam"), h.AdminUpdateBlueprint)
	ex.POST("/combinations", guard("academy.exam"), h.AdminCreateCombination)
	ex.PUT("/combinations/:id", guard("academy.exam"), h.AdminUpdateCombination)
	ex.DELETE("/combinations/:id", guard("academy.exam"), h.AdminDeleteCombination)
}

// ── Member handlers ─────────────────────────────────────────────────────────────

func (h *Handler) ListArenas(c *gin.Context) {
	out, err := h.svc.ListArenas(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetArena(c *gin.Context) {
	out, err := h.svc.GetArena(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListBlueprints(c *gin.Context) {
	out, err := h.svc.ListBlueprints(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// BeginAttempt runs created→started with a server-authoritative deadline. Idempotent
// on the Idempotency-Key header.
func (h *Handler) BeginAttempt(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req BeginAttemptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	idem := c.GetHeader("Idempotency-Key")
	out, err := h.svc.Begin(c.Request.Context(), u, req.BlueprintID, req.OfflineOrigin, idem)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) PauseAttempt(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.Pause(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ResumeAttempt(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.Resume(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// SubmitAttempt freezes responses, scores, and is idempotent on the Idempotency-Key.
func (h *Handler) SubmitAttempt(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req SubmitAttemptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	idem := c.GetHeader("Idempotency-Key")
	out, err := h.svc.Submit(c.Request.Context(), u, c.Param("id"), req.Responses, req.Integrity, idem)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetAttempt(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.GetAttempt(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetAttemptResult returns the stored score/result projection for a submitted/scored
// attempt the caller owns (subjects/overall/grade/late + readiness + predicted). Same
// {data} envelope as the other exam reads; 404 if not owned or not yet scored.
func (h *Handler) GetAttemptResult(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.GetAttemptResult(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetCombinations returns UTME course→subject-set rules. ?course= filters; ?arena=
// overrides the arena (defaults to none → all arenas' rules).
func (h *Handler) GetCombinations(c *gin.Context) {
	out, err := h.svc.GetCombinations(c.Request.Context(), c.Query("arena"), c.Query("course"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── Admin handlers ──────────────────────────────────────────────────────────────

// AdminListArenas returns all arenas (admin-scoped; mirrors the member arena list).
func (h *Handler) AdminListArenas(c *gin.Context) {
	out, err := h.svc.ListArenas(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminListBlueprints returns every blueprint across all arenas (admin flat list).
func (h *Handler) AdminListBlueprints(c *gin.Context) {
	out, err := h.svc.ListAllBlueprints(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminListCombinations returns UTME/arena course→subject-set rules (admin-scoped;
// mirrors the member combinations read). ?arena= / ?course= optionally filter.
func (h *Handler) AdminListCombinations(c *gin.Context) {
	out, err := h.svc.GetCombinations(c.Request.Context(), c.Query("arena"), c.Query("course"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminCreateArena(c *gin.Context) {
	var req CreateArenaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateArena(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminUpdateArena(c *gin.Context) {
	var req UpdateArenaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpdateArena(c.Request.Context(), uid(c), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminCreateBlueprint(c *gin.Context) {
	var req CreateBlueprintRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateBlueprint(c.Request.Context(), uid(c), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminUpdateBlueprint(c *gin.Context) {
	var req UpdateBlueprintRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpdateBlueprint(c.Request.Context(), uid(c), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminCreateCombination(c *gin.Context) {
	var req CombinationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateCombination(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminUpdateCombination(c *gin.Context) {
	var req CombinationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpdateCombination(c.Request.Context(), uid(c), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminDeleteCombination(c *gin.Context) {
	if err := h.svc.DeleteCombination(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
}
