package feesexport

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes ComplianceExport (SF-11) + school self-service export (SF-10) over Gin.
// Router registration into RegisterAcademy is owned by the QA/integration task — see
// RegisterFeesExport for the groups this package expects.
type Handler struct {
	svc *Service
}

// NewHandler builds the export handler.
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
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrMissingSchool):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_school", "message": err.Error()})
	case errors.Is(err, ErrMissingReportType):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_report_type", "message": err.Error()})
	case errors.Is(err, ErrNoCategories):
		c.JSON(http.StatusBadRequest, gin.H{"error": "no_data_categories", "message": err.Error()})
	case errors.Is(err, ErrCategoryNotOptedIn):
		c.JSON(http.StatusForbidden, gin.H{"error": "data_category_not_opted_in", "message": err.Error()})
	case errors.Is(err, ErrSchoolNotVerified):
		c.JSON(http.StatusForbidden, gin.H{"error": "school_not_verified", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterFeesExport wires compliance-export routes onto the passed admin group (school/bursar
// or platform operator scope). nil pool/groups are skipped. Admin routes should be gated by the
// integration task with middleware.RequirePermission(rbac, "academy.fees.export.*").
//
//	admin: POST /export/compliance                 SF-11 trigger regulator export (append-only log)
//	       GET  /export/compliance/:schoolId        SF-11 list a school's export history (audit)
//	       POST /export/school-data                 SF-10 verified-school full data export
func RegisterFeesExport(admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) *Handler {
	if pool == nil {
		return nil
	}
	h := NewHandler(NewService(pool))
	if admin != nil {
		eg := admin.Group("/export")
		eg.POST("/compliance", h.TriggerExport)
		eg.GET("/compliance/:schoolId", h.ListExports)
		eg.POST("/school-data", h.TriggerSchoolDataExport)
	}
	_ = rbac
	return h
}

// ── Handlers ────────────────────────────────────────────────────────────────────

func (h *Handler) TriggerExport(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req TriggerExportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.TriggerExport(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) ListExports(c *gin.Context) {
	out, err := h.svc.ListExports(c.Request.Context(), c.Param("schoolId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) TriggerSchoolDataExport(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req SchoolDataExportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.TriggerSchoolDataExport(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}
