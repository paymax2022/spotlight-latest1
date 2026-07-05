package schools

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the academy schools (B2B2C) surface over Gin.
//   - admin (RBAC academy.schools): institutions CRUD, licences issue/suspend/
//     reactivate/expire, class groups CRUD, bulk-enroll, billing generate/charge, overview.
//   - member (school-admin lite): the institutions the caller administers + per-institution
//     overview.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated user (finance/connect groups mirror it into c).
func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

// idemKey reads the Idempotency-Key header (required for money-path mutations).
func idemKey(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

// fail maps sentinel errors to stable snake_case codes + HTTP statuses.
func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrLicenceNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "licence_not_found", "message": err.Error()})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_transition", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyKeyReused):
		c.JSON(http.StatusConflict, gin.H{"error": "idempotency_key_reused", "message": err.Error()})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount", "message": err.Error()})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
	case errors.Is(err, ErrInstitutionInactive):
		c.JSON(http.StatusConflict, gin.H{"error": "institution_inactive", "message": err.Error()})
	case errors.Is(err, ErrNoActiveLicence):
		c.JSON(http.StatusConflict, gin.H{"error": "no_active_licence", "message": err.Error()})
	case errors.Is(err, ErrSeatLimitExceeded):
		c.JSON(http.StatusConflict, gin.H{"error": "seat_limit_exceeded", "message": err.Error()})
	case errors.Is(err, ErrBillingNotOpen):
		c.JSON(http.StatusConflict, gin.H{"error": "billing_not_open", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterAcademySchools wires the schools routes. Mirrors the project Register pattern
// (commerce/edupay): builds its own service from the pool + INJECTED BillingRail, and
// gates admin routes with middleware.RequirePermission(rbac, "academy.schools"). A nil
// rail falls back to the deterministic dev stub; nil pool / member / admin groups are
// skipped (nil-safe stub).
//
// Member routes use BARE subpaths — the aggregator passes the /api/finance/academy base
// group. Admin routes are grouped under /schools/admin on the admin base.
//
//	member: GET /schools/mine
//	        GET /schools/:id/overview
//	admin : POST /schools/admin/institutions
//	        GET  /schools/admin/institutions
//	        POST /schools/admin/licences
//	        POST /schools/admin/licences/:id/suspend
//	        POST /schools/admin/licences/:id/reactivate
//	        POST /schools/admin/licences/:id/expire
//	        POST /schools/admin/class-groups
//	        GET  /schools/admin/institutions/:id/class-groups
//	        POST /schools/admin/enrollments/bulk
//	        DELETE /schools/admin/enrollments
//	        POST /schools/admin/billing
//	        POST /schools/admin/billing/:id/charge
//	        GET  /schools/admin/institutions/:id/overview
func RegisterAcademySchools(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, billing BillingRail) {
	if pool == nil {
		return
	}
	if billing == nil {
		billing = StubBillingRail{}
	}
	svc := NewService(pool, billing)
	h := NewHandler(svc)

	if member != nil {
		mg := member.Group("/schools")
		mg.GET("/mine", h.MyInstitutions)
		mg.GET("/:id/overview", h.MemberOverview)
	}

	if admin != nil {
		guard := middleware.RequirePermission(rbac, "academy.schools")
		ag := admin.Group("/schools/admin")
		ag.Use(guard)
		ag.POST("/institutions", h.AdminOnboard)
		ag.GET("/institutions", h.AdminListInstitutions)
		ag.GET("/institutions/:id/overview", h.AdminOverview)
		ag.GET("/institutions/:id/class-groups", h.AdminListClassGroups)
		ag.POST("/licences", h.AdminIssueLicence)
		ag.POST("/licences/:id/suspend", h.AdminSuspendLicence)
		ag.POST("/licences/:id/reactivate", h.AdminReactivateLicence)
		ag.POST("/licences/:id/expire", h.AdminExpireLicence)
		ag.POST("/class-groups", h.AdminCreateClassGroup)
		ag.POST("/enrollments/bulk", h.AdminBulkEnroll)
		ag.DELETE("/enrollments", h.AdminRemoveEnrollment)
		ag.POST("/billing", h.AdminGenerateBilling)
		ag.POST("/billing/:id/charge", h.AdminChargeBilling)
	}
}

// ── Member handlers (school-admin lite) ──────────────────────────────────────────

func (h *Handler) MyInstitutions(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.MyInstitutions(c.Request.Context(), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) MemberOverview(c *gin.Context) {
	if _, ok := h.requireUser(c); !ok {
		return
	}
	out, err := h.svc.GetInstitution(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── Admin handlers (RBAC academy.schools) ─────────────────────────────────────────

func (h *Handler) AdminOnboard(c *gin.Context) {
	var req OnboardInstitutionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.OnboardInstitution(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminListInstitutions(c *gin.Context) {
	out, err := h.svc.ListInstitutions(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminOverview(c *gin.Context) {
	out, err := h.svc.GetInstitution(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminListClassGroups(c *gin.Context) {
	out, err := h.svc.GetInstitution(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out.ClassGroups})
}

func (h *Handler) AdminIssueLicence(c *gin.Context) {
	var req IssueLicenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.IssueLicence(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminSuspendLicence(c *gin.Context) {
	out, err := h.svc.SuspendLicence(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminReactivateLicence(c *gin.Context) {
	out, err := h.svc.ReactivateLicence(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminExpireLicence(c *gin.Context) {
	out, err := h.svc.ExpireLicence(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminCreateClassGroup(c *gin.Context) {
	var req CreateClassGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateClassGroup(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminBulkEnroll(c *gin.Context) {
	var req BulkEnrollRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.BulkEnroll(c.Request.Context(), uid(c), req, idemKey(c))
	if err != nil {
		// Seat-cap is a partial success: return the result (how many succeeded) alongside
		// the seat_limit_exceeded code so the caller knows where the run stopped.
		if errors.Is(err, ErrSeatLimitExceeded) {
			c.JSON(http.StatusConflict, gin.H{"error": "seat_limit_exceeded", "message": err.Error(), "data": out})
			return
		}
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// RemoveEnrollmentRequest removes a learner from an institution (frees a seat).
type RemoveEnrollmentRequest struct {
	InstitutionID string `json:"institutionId" binding:"required"`
	LearnerUserID string `json:"learnerUserId" binding:"required"`
}

func (h *Handler) AdminRemoveEnrollment(c *gin.Context) {
	var req RemoveEnrollmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	if err := h.svc.RemoveEnrollment(c.Request.Context(), uid(c), req.InstitutionID, req.LearnerUserID); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"removed": true}})
}

func (h *Handler) AdminGenerateBilling(c *gin.Context) {
	var req GenerateBillingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.GenerateBilling(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminChargeBilling(c *gin.Context) {
	out, err := h.svc.ChargeBilling(c.Request.Context(), uid(c), c.Param("id"), idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
