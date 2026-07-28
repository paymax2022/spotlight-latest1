package parent

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the academy parent layer over Gin.
//   - member (guardian): child dashboards, controls, reports, purchase approvals.
//     Every endpoint is gated by the active guardian link (fail-closed in Service).
//   - admin : notification-template CRUD, gated by RBAC academy.notifications.
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
// ErrForbidden (no active guardian link) → 403, the child-safety denial.
func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden", "message": err.Error()})
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

// requireUID resolves the guardian or aborts 401.
func (h *Handler) requireUID(c *gin.Context) (string, bool) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication_required"})
		return "", false
	}
	return u, true
}

// RegisterAcademyParent wires the parent routes. Mirrors RegisterAcademyAssessment:
// it builds its own service from the pool and gates admin routes with
// middleware.RequirePermission(rbac, "academy.notifications").
//
//	member (guardian):
//	  GET  /parent/children
//	  GET  /parent/children/:minorId/dashboard
//	  GET  /parent/children/:minorId/subjects/:subjectId
//	  PUT  /parent/children/:minorId/controls
//	  GET  /parent/children/:minorId/reports
//	  POST /parent/reports/generate
//	  GET  /parent/approvals
//	  POST /parent/approvals/:id/decide
//	admin: /notification-templates (CRUD) under RBAC academy.notifications
func RegisterAcademyParent(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		return
	}
	svc := NewService(pool)
	h := NewHandler(svc)

	// ── Member (guardian) ──
	if member != nil {
		pg := member.Group("/parent")
		pg.GET("/children", h.GetChildren)
		pg.GET("/children/:minorId/dashboard", h.GetChildDashboard)
		pg.GET("/children/:minorId/subjects/:subjectId", h.GetChildSubject)
		pg.PUT("/children/:minorId/controls", h.UpsertControls)
		pg.GET("/children/:minorId/reports", h.ListReports)
		pg.POST("/reports/generate", h.GenerateReport)
		pg.GET("/approvals", h.ListPendingApprovals)
		pg.POST("/approvals/:id/decide", h.DecideApproval)
	}

	// ── Admin — academy.notifications capability ──
	if admin != nil {
		guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
		ag := admin.Group("/notification-templates", guard("academy.notifications"))
		ag.GET("", h.AdminListTemplates)
		ag.POST("", h.AdminUpsertTemplate)
		ag.PUT("", h.AdminUpsertTemplate) // upsert on key
		ag.GET("/:key", h.AdminGetTemplate)
		ag.DELETE("/:key", h.AdminDeleteTemplate)
	}
}

// ── Member handlers (guardian) ──────────────────────────────────────────────────

func (h *Handler) GetChildren(c *gin.Context) {
	u, ok := h.requireUID(c)
	if !ok {
		return
	}
	out, err := h.svc.Children(c.Request.Context(), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetChildDashboard(c *gin.Context) {
	u, ok := h.requireUID(c)
	if !ok {
		return
	}
	out, err := h.svc.ChildDashboard(c.Request.Context(), u, c.Param("minorId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetChildSubject(c *gin.Context) {
	u, ok := h.requireUID(c)
	if !ok {
		return
	}
	out, err := h.svc.ChildSubject(c.Request.Context(), u, c.Param("minorId"), c.Param("subjectId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) UpsertControls(c *gin.Context) {
	u, ok := h.requireUID(c)
	if !ok {
		return
	}
	var req UpsertControlsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpsertControls(c.Request.Context(), u, c.Param("minorId"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListReports(c *gin.Context) {
	u, ok := h.requireUID(c)
	if !ok {
		return
	}
	out, err := h.svc.ListReports(c.Request.Context(), u, c.Param("minorId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GenerateReport(c *gin.Context) {
	u, ok := h.requireUID(c)
	if !ok {
		return
	}
	var req GenerateReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.GenerateReport(c.Request.Context(), u, req.MinorUserID, req.Period)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) ListPendingApprovals(c *gin.Context) {
	u, ok := h.requireUID(c)
	if !ok {
		return
	}
	out, err := h.svc.ListPending(c.Request.Context(), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) DecideApproval(c *gin.Context) {
	u, ok := h.requireUID(c)
	if !ok {
		return
	}
	var req DecideApprovalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.Decide(c.Request.Context(), u, c.Param("id"), req.Decision)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── Admin handlers: notification templates ──────────────────────────────────────

func (h *Handler) AdminUpsertTemplate(c *gin.Context) {
	var req UpsertTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpsertTemplate(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminListTemplates(c *gin.Context) {
	out, err := h.svc.ListTemplates(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminGetTemplate(c *gin.Context) {
	out, err := h.svc.GetTemplate(c.Request.Context(), c.Param("key"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminDeleteTemplate(c *gin.Context) {
	if err := h.svc.DeleteTemplate(c.Request.Context(), uid(c), c.Param("key")); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
