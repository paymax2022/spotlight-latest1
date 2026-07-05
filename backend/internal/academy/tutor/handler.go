package tutor

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the academy tutor-marketplace surface over Gin.
//   - member (tutor): onboard, profile, assignments, grading, earnings, payouts.
//   - public        : list verified tutors (by subject).
//   - admin (RBAC academy.tutor): vetting (verify/suspend), payouts list.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated user. The finance group mirrors the auth user into
// c.Set("user_id", ...); fall back to the auth context if absent.
func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

// idemKey reads the Idempotency-Key header (required for the payout money path).
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
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount", "message": err.Error()})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
	case errors.Is(err, ErrKYCNotMet):
		c.JSON(http.StatusForbidden, gin.H{"error": "kyc_tier_not_met", "message": err.Error()})
	case errors.Is(err, ErrInsufficientBalance):
		c.JSON(http.StatusConflict, gin.H{"error": "insufficient_balance", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterAcademyTutor wires the tutor-marketplace routes. Mirrors the project Register
// pattern: builds its own service from the pool + INJECTED KYCChecker / PayoutRail, and
// gates admin routes with middleware.RequirePermission(rbac, "academy.tutor"). nil kyc
// falls back to allow (dev); nil payout falls back to a deterministic stub; a nil pool,
// or nil member/admin groups, are skipped.
//
// Member routes use BARE subpaths — the aggregator passes the /api/finance/academy base
// group (memberAcad). The public tutor listing is on the member group (auth-gated read).
//
//	member: POST /tutor/onboard
//	        GET  /tutor/me
//	        POST /tutor/assignments
//	        POST /tutor/grades
//	        GET  /tutor/earnings
//	        POST /tutor/payouts
//	        GET  /tutors            — list verified tutors (?subject=)
//	admin : POST /tutor/:id/verify
//	        POST /tutor/:id/suspend
//	        GET  /tutor/payouts
func RegisterAcademyTutor(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, kyc KYCChecker, payout PayoutRail) {
	if pool == nil {
		return
	}
	if kyc == nil {
		kyc = stubKYCChecker{}
	}
	if payout == nil {
		payout = stubPayoutRail{}
	}
	svc := NewService(pool, kyc, payout)
	h := NewHandler(svc)

	if member != nil {
		member.POST("/tutor/onboard", h.Onboard)
		member.GET("/tutor/me", h.GetMe)
		member.POST("/tutor/assignments", h.CreateAssignment)
		member.POST("/tutor/grades", h.CreateGrade)
		member.GET("/tutor/earnings", h.GetEarnings)
		member.POST("/tutor/payouts", h.RequestPayout)
		// Public-ish listing (auth-gated read on the member group).
		member.GET("/tutors", h.ListTutors)
	}

	if admin != nil {
		guard := middleware.RequirePermission(rbac, "academy.tutor")
		admin.POST("/tutor/:id/verify", guard, h.AdminVerify)
		admin.POST("/tutor/:id/suspend", guard, h.AdminSuspend)
		admin.GET("/tutor/payouts", guard, h.AdminListPayouts)
	}
}

// ── Member handlers ─────────────────────────────────────────────────────────────

func (h *Handler) Onboard(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req OnboardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.OnboardTutor(c.Request.Context(), u, req.Bio, req.Subjects)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) GetMe(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.GetMyTutor(c.Request.Context(), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) CreateAssignment(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req AssignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	var dueAt *time.Time
	if req.DueAt != "" {
		t, perr := time.Parse(time.RFC3339, req.DueAt)
		if perr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": "due_at must be RFC3339"})
			return
		}
		dueAt = &t
	}
	out, err := h.svc.Assign(c.Request.Context(), u, req.ClassGroupID, req.LearnerID, req.Kind, req.Title, req.ContentRef, dueAt)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) CreateGrade(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req GradeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	grade, earn, err := h.svc.Grade(c.Request.Context(), u, req.AssignmentID, req.LearnerID, req.Score, req.Feedback, req.EarnMinor)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{"grade": grade, "earning": earn}})
}

func (h *Handler) GetEarnings(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.GetMyEarnings(c.Request.Context(), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// RequestPayout is the money path. Requires an Idempotency-Key header.
func (h *Handler) RequestPayout(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req PayoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.RequestPayout(c.Request.Context(), u, req.AmountMinor, idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListTutors(c *gin.Context) {
	out, err := h.svc.ListTutors(c.Request.Context(), c.Query("subject"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── Admin handlers (RBAC academy.tutor) ─────────────────────────────────────────

func (h *Handler) AdminVerify(c *gin.Context) {
	out, err := h.svc.VerifyTutor(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminSuspend(c *gin.Context) {
	out, err := h.svc.SuspendTutor(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminListPayouts(c *gin.Context) {
	out, err := h.svc.ListPayouts(c.Request.Context(), c.Query("tutor"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
