package edupay

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the academy EduPay surface over Gin.
//   - member: school/fee reads, link, dashboard, pay fees, savings pots (create / fund / pay).
//   - admin (RBAC academy.edupay): school + fee-schedule CRUD, disbursement reconcile,
//     scholarships CRUD + award.
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
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_transition", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyKeyReused):
		c.JSON(http.StatusConflict, gin.H{"error": "idempotency_key_reused", "message": err.Error()})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount", "message": err.Error()})
	case errors.Is(err, ErrInvalidSource):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_source", "message": err.Error()})
	case errors.Is(err, ErrSchoolInactive):
		c.JSON(http.StatusConflict, gin.H{"error": "school_inactive", "message": err.Error()})
	case errors.Is(err, ErrFeeScheduleInactive):
		c.JSON(http.StatusConflict, gin.H{"error": "fee_schedule_inactive", "message": err.Error()})
	case errors.Is(err, ErrSchoolAccountMissing):
		c.JSON(http.StatusConflict, gin.H{"error": "school_account_missing", "message": err.Error()})
	case errors.Is(err, ErrInsufficientPot):
		c.JSON(http.StatusConflict, gin.H{"error": "insufficient_pot_balance", "message": err.Error()})
	case errors.Is(err, ErrPotClosed):
		c.JSON(http.StatusConflict, gin.H{"error": "pot_closed", "message": err.Error()})
	case errors.Is(err, ErrScholarshipInactive):
		c.JSON(http.StatusConflict, gin.H{"error": "scholarship_inactive", "message": err.Error()})
	case errors.Is(err, ErrScholarshipExhausted):
		c.JSON(http.StatusConflict, gin.H{"error": "scholarship_budget_exhausted", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterAcademyEduPay wires the EduPay routes. Mirrors the project Register pattern:
// builds its own service from the pool + INJECTED rails, and gates admin routes with
// middleware.RequirePermission(rbac, "academy.edupay"). nil rails fall back to
// deterministic dev stubs; nil member/admin groups are skipped.
//
// Member routes use BARE subpaths — the aggregator passes the /api/finance/academy base
// group (memberAcad). Admin routes are grouped under /edupay/admin on the admin base.
//
//	member: GET  /edupay/schools
//	        GET  /edupay/fee-schedules
//	        POST /edupay/link
//	        GET  /edupay/me
//	        POST /edupay/pay
//	        POST /edupay/pots
//	        POST /edupay/pots/:id/fund
//	        POST /edupay/pots/:id/pay
//	admin : POST /edupay/admin/schools
//	        POST /edupay/admin/fee-schedules
//	        POST /edupay/admin/disbursements/:id/reconcile
//	        GET  /edupay/admin/scholarships
//	        POST /edupay/admin/scholarships
//	        POST /edupay/admin/scholarships/award
func RegisterAcademyEduPay(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, collect CollectRail, disburse DisburseRail, bnpl BNPLRail) {
	if pool == nil {
		return
	}
	if collect == nil {
		collect = StubCollectRail{}
	}
	if disburse == nil {
		disburse = StubDisburseRail{}
	}
	if bnpl == nil {
		bnpl = StubBNPLRail{}
	}
	svc := NewService(pool, collect, disburse, bnpl)
	h := NewHandler(svc)

	if member != nil {
		mg := member.Group("/edupay")
		mg.GET("/schools", h.ListSchools)
		mg.GET("/fee-schedules", h.ListFeeSchedules)
		mg.POST("/link", h.LinkSchool)
		mg.GET("/me", h.GetMyEduPay)
		mg.POST("/pay", h.PayFees)
		mg.POST("/pots", h.CreatePot)
		mg.POST("/pots/:id/fund", h.FundPot)
		mg.POST("/pots/:id/pay", h.PayFromPot)
	}

	if admin != nil {
		guard := middleware.RequirePermission(rbac, "academy.edupay")
		ag := admin.Group("/edupay/admin")
		ag.Use(guard)
		ag.POST("/schools", h.AdminCreateSchool)
		ag.POST("/fee-schedules", h.AdminCreateFeeSchedule)
		ag.POST("/disbursements/:id/reconcile", h.AdminReconcile)
		ag.GET("/scholarships", h.AdminListScholarships)
		ag.POST("/scholarships", h.AdminCreateScholarship)
		ag.POST("/scholarships/award", h.AdminAwardScholarship)
	}
}

// ── Member handlers ─────────────────────────────────────────────────────────────

func (h *Handler) ListSchools(c *gin.Context) {
	out, err := h.svc.ListSchools(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListFeeSchedules(c *gin.Context) {
	out, err := h.svc.ListFeeSchedules(c.Request.Context(), c.Query("school"), c.Query("class"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) LinkSchool(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req LinkSchoolRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.LinkSchool(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) GetMyEduPay(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.GetMyEduPay(c.Request.Context(), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) PayFees(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req PayFeesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.PayFees(c.Request.Context(), u, req.FeeScheduleID, req.StudentRef, req.Source, idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) CreatePot(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req CreatePotRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreatePot(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) FundPot(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req FundPotRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.FundPot(c.Request.Context(), u, c.Param("id"), req.AmountMinor, idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) PayFromPot(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req PayFromPotRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.PayFromPot(c.Request.Context(), u, c.Param("id"), req.FeeScheduleID, req.StudentRef, idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── Admin handlers (RBAC academy.edupay) ─────────────────────────────────────────

func (h *Handler) AdminCreateSchool(c *gin.Context) {
	var req CreateSchoolRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateSchool(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminCreateFeeSchedule(c *gin.Context) {
	var req CreateFeeScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateFeeSchedule(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminReconcile(c *gin.Context) {
	out, err := h.svc.Reconcile(c.Request.Context(), uid(c), c.Param("id"), idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminListScholarships(c *gin.Context) {
	out, err := h.svc.ListScholarships(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminCreateScholarship(c *gin.Context) {
	var req CreateScholarshipRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateScholarship(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminAwardScholarship(c *gin.Context) {
	var req AwardScholarshipRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.AwardScholarship(c.Request.Context(), uid(c), req, idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}
