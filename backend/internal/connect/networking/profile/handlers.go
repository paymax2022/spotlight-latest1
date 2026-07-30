package connectnetprofile

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }

// idemKey reads the client idempotency token so a retried create is a no-op.
func idemKey(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

// fail maps domain errors to HTTP status codes (deny-by-default: unknown → 500).
func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrSelfReco), errors.Is(err, ErrSelfRequest):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotSubject), errors.Is(err, ErrNotAuthor):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrBadTransition):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// ─────────────────────────────── Experience ──────────────────────────────────

func (h *Handler) ListExperience(c *gin.Context) {
	out, err := h.svc.ListExperience(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AddExperience(c *gin.Context) {
	var in ExperienceInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	e, err := h.svc.AddExperience(c.Request.Context(), uid(c), in, idemKey(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": e})
}

func (h *Handler) UpdateExperience(c *gin.Context) {
	var in ExperienceInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	e, err := h.svc.UpdateExperience(c.Request.Context(), uid(c), c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": e})
}

func (h *Handler) DeleteExperience(c *gin.Context) {
	if err := h.svc.DeleteExperience(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
}

// ─────────────────────────────── Education ───────────────────────────────────

func (h *Handler) ListEducation(c *gin.Context) {
	out, err := h.svc.ListEducation(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AddEducation(c *gin.Context) {
	var in EducationInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	e, err := h.svc.AddEducation(c.Request.Context(), uid(c), in, idemKey(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": e})
}

func (h *Handler) UpdateEducation(c *gin.Context) {
	var in EducationInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	e, err := h.svc.UpdateEducation(c.Request.Context(), uid(c), c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": e})
}

func (h *Handler) DeleteEducation(c *gin.Context) {
	if err := h.svc.DeleteEducation(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"deleted": true}})
}

// ─────────────────────────────────── About ───────────────────────────────────

func (h *Handler) GetAbout(c *gin.Context) {
	a, err := h.svc.GetAbout(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

func (h *Handler) SetAbout(c *gin.Context) {
	var in AboutInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	a, err := h.svc.SetAbout(c.Request.Context(), uid(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

// ──────────────────────── Profile strength (PR-11) ───────────────────────────

// Strength — GET /network/strength. Returns only a coarse band + missing sections
// (PN-1: no raw numeric trust score is ever serialized).
func (h *Handler) Strength(c *gin.Context) {
	view, err := h.svc.Strength(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": view})
}

// ──────────────────────────── Recommendations ────────────────────────────────

// WriteRecommendation — POST /network/recommendations (RC-01).
func (h *Handler) WriteRecommendation(c *gin.Context) {
	var in WriteRecommendationInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.WriteRecommendation(c.Request.Context(), uid(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": rec})
}

// SendRecommendation — PATCH /network/recommendations/:id/send (author, DRAFTED→SENT).
func (h *Handler) SendRecommendation(c *gin.Context) {
	rec, err := h.svc.SendRecommendation(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rec})
}

// AcceptRecommendation — PATCH /network/recommendations/:id/accept (SUBJECT ONLY, PN-4).
func (h *Handler) AcceptRecommendation(c *gin.Context) {
	rec, err := h.svc.AcceptRecommendation(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rec})
}

// DeclineRecommendation — PATCH /network/recommendations/:id/decline (SUBJECT ONLY, PN-4).
func (h *Handler) DeclineRecommendation(c *gin.Context) {
	rec, err := h.svc.DeclineRecommendation(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rec})
}

// Inbox — GET /network/recommendations/inbox (RC-02, subject's pending).
func (h *Handler) Inbox(c *gin.Context) {
	out, err := h.svc.Inbox(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Authored — GET /network/recommendations/authored (caller's own written).
func (h *Handler) Authored(c *gin.Context) {
	out, err := h.svc.Authored(c.Request.Context(), uid(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// PublicRecommendations — GET /network/users/:userId/recommendations (RC-03,
// public accepted-only). PN-4: only accepted_visible rows are returned.
func (h *Handler) PublicRecommendations(c *gin.Context) {
	out, err := h.svc.PublicRecommendations(c.Request.Context(), c.Param("userId"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// RequestRecommendation — POST /network/recommendations/requests (RC-04).
func (h *Handler) RequestRecommendation(c *gin.Context) {
	var in RequestRecommendationInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req, err := h.svc.RequestRecommendation(c.Request.Context(), uid(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": req})
}

// ─────────────────────────────────── Admin ───────────────────────────────────

// AdminListRecommendations — GET /network/recommendations?state=&limit= (moderation).
func (h *Handler) AdminListRecommendations(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.AdminListRecommendations(c.Request.Context(), c.Query("state"), limit)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminHideRecommendation — POST /network/recommendations/:id/hide (moderation).
func (h *Handler) AdminHideRecommendation(c *gin.Context) {
	rec, err := h.svc.AdminHideRecommendation(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rec})
}

// Register wires the Phase 6C/6E network-profile module onto the shared Connect
// member + admin groups. Both groups already carry RequireAuthContext + the
// c.Set("user_id", …) mirror; the parent enforces the Connect feature gate. Admin
// routes add per-route RBAC (connect.network.*). NON-CASH: no money path is
// registered here.
func Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, audit Auditor) {
	svc := NewService(NewRepository(pool), audit)
	h := NewHandler(svc)

	g := member.Group("/networking")

	// Experience (PR-07).
	g.GET("/experience", h.ListExperience)
	g.POST("/experience", h.AddExperience)
	g.PATCH("/experience/:id", h.UpdateExperience)
	g.DELETE("/experience/:id", h.DeleteExperience)

	// Education (PR-08).
	g.GET("/education", h.ListEducation)
	g.POST("/education", h.AddEducation)
	g.PATCH("/education/:id", h.UpdateEducation)
	g.DELETE("/education/:id", h.DeleteEducation)

	// About (PR-09).
	g.GET("/about", h.GetAbout)
	g.PUT("/about", h.SetAbout)

	// Profile strength (PR-11).
	g.GET("/strength", h.Strength)

	// Recommendations (RC-01..RC-04, PN-4).
	g.POST("/recommendations", h.WriteRecommendation) // RC-01
	g.GET("/recommendations/inbox", h.Inbox)          // RC-02
	g.GET("/recommendations/authored", h.Authored)
	g.PATCH("/recommendations/:id/send", h.SendRecommendation)     // DRAFTED→SENT (author)
	g.PATCH("/recommendations/:id/accept", h.AcceptRecommendation) // SENT→ACCEPTED_VISIBLE (subject)
	g.PATCH("/recommendations/:id/decline", h.DeclineRecommendation)
	g.POST("/recommendations/requests", h.RequestRecommendation) // RC-04
	// RC-03 — public accepted-only recommendations on a profile.
	g.GET("/users/:userId/recommendations", h.PublicRecommendations)

	// Admin moderation (per-route RBAC).
	ag := admin.Group("/networking")
	ag.GET("/recommendations",
		middleware.RequirePermission(rbac, "connect.network.view"), h.AdminListRecommendations)
	ag.POST("/recommendations/:id/hide",
		middleware.RequirePermission(rbac, "connect.network.moderate"), h.AdminHideRecommendation)
}
