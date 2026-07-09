package feesschool

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the EdTech School onboarding + verification surface over Gin.
//   - member: create draft school, list my schools, get, update, export (verified only).
//   - admin  (RBAC academy.fees.school.verify / platform_edtech_admin): verify tier,
//     directory list.
//
// The router will mount member routes under /internal/edtech-fees/schools (per build-spec
// §6). Wiring into RegisterAcademy is owned by the QA/integration task — see
// RegisterFeesSchool below for the exact groups this package expects.
type Handler struct {
	svc *Service
}

// NewHandler builds the school handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated user (RequireAuthContext sets c.Set("user_id", …)).
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

// fail maps sentinel errors to stable snake_case codes + HTTP statuses (mirrors edupay).
func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden", "message": err.Error()})
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrInvalidTier):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_verification_tier", "message": err.Error()})
	case errors.Is(err, ErrIllegalTierMove):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_verification_tier_transition", "message": err.Error()})
	case errors.Is(err, ErrSchoolNotVerified):
		c.JSON(http.StatusForbidden, gin.H{"error": "school_not_verified", "message": err.Error()})
	case errors.Is(err, ErrMissingName):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_name", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterFeesSchool wires the school routes. member routes use the /schools subpath on
// the passed member group; admin routes are grouped under /schools/admin and RBAC-gated.
// nil pool / groups are skipped. The QA/integration task calls this from RegisterAcademy.
//
//	member: POST /schools                 create draft school (owner = caller)
//	        GET  /schools                 list my schools
//	        GET  /schools/:id             get a school
//	        PATCH/schools/:id             update descriptive fields (owner only)
//	        GET  /schools/:id/export      SF-10 roster+fees export (verified schools only)
//	admin : POST /schools/admin/:id/verify   advance verification tier (platform admin)
//	        GET  /schools/admin             platform school directory (SU-01)
func RegisterFeesSchool(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) *Handler {
	if pool == nil {
		return nil
	}
	h := NewHandler(NewService(pool))

	if member != nil {
		mg := member.Group("/schools")
		mg.POST("", h.Create)
		mg.GET("", h.ListMine)
		mg.GET("/:schoolId", h.Get)
		mg.PATCH("/:schoolId", h.Update)
		mg.GET("/:schoolId/export", h.Export)
	}

	if admin != nil {
		ag := admin.Group("/schools/admin")
		ag.Use(middleware.RequirePermission(rbac, "academy.fees.school.verify"))
		ag.POST("/:schoolId/verify", h.Verify)
		ag.GET("", h.AdminList)
	}
	return h
}

// ── Member handlers ─────────────────────────────────────────────────────────────

func (h *Handler) Create(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req CreateSchoolRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.Create(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) ListMine(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.ListMine(c.Request.Context(), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Get(c *gin.Context) {
	out, err := h.svc.Get(c.Request.Context(), c.Param("schoolId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Update(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req UpdateSchoolRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.Update(c.Request.Context(), u, c.Param("schoolId"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Export(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.Export(c.Request.Context(), u, c.Param("schoolId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── Admin handlers (RBAC academy.fees.school.verify / platform_edtech_admin) ─────

func (h *Handler) Verify(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req VerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.Verify(c.Request.Context(), u, c.Param("schoolId"), VerificationTier(req.Tier))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminList(c *gin.Context) {
	out, err := h.svc.ListAll(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
