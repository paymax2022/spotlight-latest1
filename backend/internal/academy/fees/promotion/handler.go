package feespromotion

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the Promotion engine routes over Gin. Router registration into
// RegisterAcademy is owned by the QA/integration task — see RegisterFeesPromotion for
// the groups this package expects and the permission slugs to gate them with.
//
// SF-3 note: the two approval endpoints are DISTINCT and must be gated with DIFFERENT
// permission slugs (teacher vs head-teacher/admin) so the two-approval requirement is
// enforced at the authz layer as well as the state machine + service.
type Handler struct {
	svc *Service
}

// NewHandler builds the promotion handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

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

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden", "message": err.Error()})
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
	case errors.Is(err, ErrInvalidDecision):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_decision", "message": err.Error()})
	case errors.Is(err, ErrSchoolMismatch):
		c.JSON(http.StatusConflict, gin.H{"error": "school_mismatch", "message": err.Error()})
	case errors.Is(err, ErrScoresIncomplete):
		c.JSON(http.StatusConflict, gin.H{"error": "scores_incomplete", "message": err.Error()})
	// SF-3 signals: an attempted approval bypass / missing-or-same approver.
	case errors.Is(err, ErrApprovalRequired):
		c.JSON(http.StatusConflict, gin.H{"error": "approval_required", "message": err.Error()})
	case errors.Is(err, ErrApprovalsIncomplete):
		c.JSON(http.StatusConflict, gin.H{"error": "approvals_incomplete", "message": err.Error()})
	case errors.Is(err, ErrApproversMustDiffer):
		c.JSON(http.StatusConflict, gin.H{"error": "approvers_must_differ", "message": err.Error()})
	case errors.Is(err, ErrTerminal):
		c.JSON(http.StatusConflict, gin.H{"error": "terminal_state", "message": err.Error()})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_transition", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterFeesPromotion wires promotion routes onto the passed member group. nil
// pool/groups are skipped. The integration task must register these behind
// FEATURE_ACADEMY_FEES_ENABLED and gate the two approval endpoints with DISTINCT RBAC
// permission slugs (see the report).
//
//	member: POST /schools/:schoolId/sessions/:sessionId/classes/:classId/scores      import scores
//	        POST /schools/:schoolId/sessions/:sessionId/classes/:classId/compute       propose decisions
//	        GET  /schools/:schoolId/promotions/:promotionId                            get record
//	        POST /schools/:schoolId/promotions/:promotionId/teacher-approval           approval #1 (teacher)
//	        POST /schools/:schoolId/promotions/:promotionId/admin-approval             approval #2 (admin)
//	        POST /schools/:schoolId/promotions/:promotionId/apply                       apply + rollover
func RegisterFeesPromotion(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) *Handler {
	if pool == nil {
		return nil
	}
	h := NewHandler(NewService(pool))
	if member != nil {
		g := member.Group("/schools/:schoolId")
		// Member self-service (score entry / proposal / read) — no RBAC gate; the
		// service self-authorizes on school membership.
		g.POST("/sessions/:sessionId/classes/:classId/scores", h.ImportScores)
		g.POST("/sessions/:sessionId/classes/:classId/compute", h.Compute)
		g.GET("/promotions/:promotionId", h.Get)
		// SF-3 two-approval + apply are privileged admin actions. Gate them with the
		// seeded `academy.fees.promotion.approve` permission as defense-in-depth on top
		// of the state machine + distinct-approver + DB CHECK. Without this a caller
		// lacking the permission is rejected (403) before any state transition.
		g.POST("/promotions/:promotionId/teacher-approval",
			middleware.RequirePermission(rbac, "academy.fees.promotion.approve"), h.TeacherApprove)
		g.POST("/promotions/:promotionId/admin-approval",
			middleware.RequirePermission(rbac, "academy.fees.promotion.approve"), h.AdminApprove)
		g.POST("/promotions/:promotionId/apply",
			middleware.RequirePermission(rbac, "academy.fees.promotion.approve"), h.Apply)
	}
	// admin group reserved so the integration task can register platform variants
	// without a signature change.
	_ = admin
	return h
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func (h *Handler) ImportScores(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req ImportScoresRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	// Path params are authoritative over the body.
	req.SchoolID = c.Param("schoolId")
	req.SessionID = c.Param("sessionId")
	req.ClassID = c.Param("classId")
	if err := h.svc.ImportScores(c.Request.Context(), u, req); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": "ok"}})
}

func (h *Handler) Compute(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req ComputeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	req.SchoolID = c.Param("schoolId")
	out, err := h.svc.Compute(c.Request.Context(), u, c.Param("sessionId"), c.Param("classId"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Get(c *gin.Context) {
	out, err := h.svc.Get(c.Request.Context(), c.Param("promotionId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) TeacherApprove(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.TeacherApprove(c.Request.Context(), u, c.Param("promotionId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminApprove(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.AdminApprove(c.Request.Context(), u, c.Param("promotionId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Apply(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.Apply(c.Request.Context(), u, c.Param("promotionId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
