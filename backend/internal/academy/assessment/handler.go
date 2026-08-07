package assessment

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the assessment surface over Gin.
//   - member: practice serving + submit + own mastery/progress reads.
//   - admin : question-bank CRUD + lifecycle transitions + item-analysis.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated learner. The finance/connect groups mirror the
// auth user into c.Set("user_id", ...); fall back to the auth context if absent.
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
	case errors.Is(err, ErrInvalidInput), errors.Is(err, ErrNoItems):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterAcademyAssessment wires the assessment routes. Mirrors the project
// Register pattern: it builds its own service from the pool and gates admin routes
// with middleware.RequirePermission(rbac, perm).
//
//	member: /academy/practice, /academy/practice/submit, /academy/mastery, /academy/progress
//	         /academy/mock-exams/* (mock exam system)
//	admin : /academy/question-bank/* under RBAC academy.assessment[.review]
//	        /academy/mock-exams/* (admin endpoints)
func RegisterAcademyAssessment(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	svc := NewService(pool)
	h := NewHandler(svc)

	// ── Member (learner) ──
	member.GET("/practice", h.GetPractice)
	member.POST("/practice/submit", h.SubmitPractice)
	member.GET("/mastery", h.GetMastery)
	member.GET("/progress", h.GetProgress)

	// ── Admin (question bank) ──
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	qb := admin.Group("/question-bank")
	qb.GET("/items", guard("academy.assessment"), h.AdminListItems)
	qb.POST("/items", guard("academy.assessment"), h.AdminCreateItem)
	qb.GET("/items/:id", guard("academy.assessment"), h.AdminGetItem)
	qb.PUT("/items/:id", guard("academy.assessment"), h.AdminUpdateItem)
	qb.POST("/items/:id/transition", guard("academy.assessment.review"), h.AdminTransitionItem)
	qb.GET("/item-analysis", guard("academy.assessment"), h.AdminItemAnalysis)

	// ── Mock Exam Routes ──
	RegisterMockExamRoutes(member, admin, pool, rbac)
}

// ── Member handlers ─────────────────────────────────────────────────────────────

// GetPractice serves approved items for an objective. Canonical answers are
// stripped so the learner never receives the key.
func (h *Handler) GetPractice(c *gin.Context) {
	objective := c.Query("objective")
	limit, _ := strconv.Atoi(c.Query("limit"))
	items, err := h.svc.PracticeItems(c.Request.Context(), objective, limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	for i := range items {
		items[i].Answer = nil // do not leak the answer key to learners
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// SubmitPractice scores the submission server-side and runs the mastery machine.
func (h *Handler) SubmitPractice(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req PracticeSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	// examTagged could be derived from the objective's exam_tags; default false here.
	res, err := h.svc.RunMasteryCheck(c.Request.Context(), u, req.ObjectiveID, req.Answers, false)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

func (h *Handler) GetMastery(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.ListMastery(c.Request.Context(), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetProgress(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.ListProgress(c.Request.Context(), u, limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── Admin handlers ──────────────────────────────────────────────────────────────

func (h *Handler) AdminCreateItem(c *gin.Context) {
	var req CreateItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateItem(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminUpdateItem(c *gin.Context) {
	var req UpdateItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpdateItem(c.Request.Context(), uid(c), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminTransitionItem(c *gin.Context) {
	var req ReviewItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.TransitionItem(c.Request.Context(), uid(c), c.Param("id"), req.To)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminGetItem(c *gin.Context) {
	out, err := h.svc.GetItem(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminListItems(c *gin.Context) {
	out, err := h.svc.ListItems(c.Request.Context(), parseItemFilter(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminItemAnalysis(c *gin.Context) {
	out, err := h.svc.ItemAnalysis(c.Request.Context(), parseItemFilter(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func parseItemFilter(c *gin.Context) ItemFilter {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	return ItemFilter{
		SubjectID:   c.Query("subject"),
		ObjectiveID: c.Query("objective"),
		Status:      c.Query("status"),
		Difficulty:  c.Query("difficulty"),
		Tag:         c.Query("tag"),
		Limit:       limit,
		Offset:      offset,
	}
}
