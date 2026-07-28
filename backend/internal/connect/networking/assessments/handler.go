package connectassess

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler is the Gin HTTP surface for skill assessments.
type Handler struct{ svc *Service }

// NewHandler builds the handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }

func fail(c *gin.Context, err error) {
	var cool *CooldownError
	switch {
	case errors.As(err, &cool):
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error": cool.Error(), "cooldownUntil": cool.Until,
		})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrMissingIdem):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInactive):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// Catalogue — GET /assessments (SA-01).
func (h *Handler) Catalogue(c *gin.Context) {
	out, err := h.svc.Catalogue(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// StartAttempt — POST /assessments/:id/attempts (SA-02). Idempotency-Key required.
func (h *Handler) StartAttempt(c *gin.Context) {
	if c.GetHeader("Idempotency-Key") == "" {
		fail(c, ErrMissingIdem)
		return
	}
	out, err := h.svc.Start(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// Submit — PATCH /assessments/:id/attempts/:attemptId/submit (SA-03).
// Idempotency-Key required.
func (h *Handler) Submit(c *gin.Context) {
	idem := c.GetHeader("Idempotency-Key")
	if idem == "" {
		fail(c, ErrMissingIdem)
		return
	}
	var body struct {
		Answers []Answer `json:"answers"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.Submit(c.Request.Context(), uid(c), c.Param("id"), c.Param("attemptId"), body.Answers, idem)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// MyBadges — GET /assessment-badges (SA-03 profile surface).
func (h *Handler) MyBadges(c *gin.Context) {
	out, err := h.svc.Badges(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminList — GET /assessments (admin, ADM-SA-01).
func (h *Handler) AdminList(c *gin.Context) {
	out, err := h.svc.AdminList(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminUpsert — POST /assessments (admin, ADM-SA-01).
func (h *Handler) AdminUpsert(c *gin.Context) {
	var in UpsertInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	a, err := h.svc.AdminUpsert(c.Request.Context(), uid(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

// Register wires Phase 6F onto the shared Connect member + admin route groups
// (both already have RequireAuthContext + user_id set). Admin routes add per-route
// RBAC connect.assessment.review (ADM-SA-01). This package does NOT edit any shared
// route file — the orchestrator calls this Register.
//
//	Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool,
//	         rbac services.RBACService, loyalty LoyaltyAwarder, audit Auditor)
func Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, loyalty LoyaltyAwarder, audit Auditor) {
	svc := NewService(NewRepository(pool), NewQuizScorer(pool), loyalty, audit)
	h := NewHandler(svc)

	g := member.Group("/networking/assessments")
	g.GET("", h.Catalogue)                                // SA-01
	g.POST("/:id/attempts", h.StartAttempt)               // SA-02 (Idempotency-Key)
	g.PATCH("/:id/attempts/:attemptId/submit", h.Submit)  // SA-03 (Idempotency-Key)

	// Badges live on a distinct path (not /assessments/badges) so the static child
	// never conflicts with the /:id param child in Gin's route tree.
	member.GET("/networking/assessment-badges", h.MyBadges) // SA-03 profile badges

	ag := admin.Group("/networking/assessments")
	ag.GET("", middleware.RequirePermission(rbac, "connect.assessment.review"), h.AdminList)
	ag.POST("", middleware.RequirePermission(rbac, "connect.assessment.review"), h.AdminUpsert)
}
