package connectaml

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes the AML admin surface over HTTP. All routes are mounted under
// the connect admin group with RBAC connect.aml.* permissions (wired in Register
// via the route file — handlers assume the caller is already authorised).
type Handler struct{ svc *Service }

// NewHandler builds an AML handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func actorID(c *gin.Context) string { return c.GetString("user_id") }

func parseLimit(c *gin.Context) int {
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return 0
}

// ListAlerts — GET /api/connect/admin/aml/alerts (connect.aml.view).
func (h *Handler) ListAlerts(c *gin.Context) {
	out, err := h.svc.ListAlerts(c.Request.Context(), parseLimit(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ListCases — GET /api/connect/admin/aml/cases (connect.aml.view).
func (h *Handler) ListCases(c *gin.Context) {
	out, err := h.svc.ListCases(c.Request.Context(), parseLimit(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// openCaseRequest is the admin body for POST /aml/cases.
type openCaseRequest struct {
	SubjectID   string   `json:"subjectId" binding:"required"`
	ReportType  string   `json:"reportType" binding:"required"` // str | sar
	ReasonCodes []string `json:"reasonCodes"`
}

// OpenCase — POST /api/connect/admin/aml/cases (connect.aml.manage).
func (h *Handler) OpenCase(c *gin.Context) {
	var req openCaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.OpenCase(c.Request.Context(), req.SubjectID, req.ReportType, req.ReasonCodes, actorID(c))
	if err != nil {
		if errors.Is(err, ErrInvalidType) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// FileSTR — POST /api/connect/admin/aml/cases/:id/file-str (connect.aml.file).
func (h *Handler) FileSTR(c *gin.Context) {
	var req FileSTRRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.FileSTR(c.Request.Context(), c.Param("id"), actorID(c), req)
	if err != nil {
		if errors.Is(err, ErrCaseNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// PermissionGuard mirrors middleware.RequirePermission without importing the
// middleware/services packages into this leaf package: the route file supplies a
// factory that builds the per-permission gin.HandlerFunc.
type PermissionGuard func(permission string) gin.HandlerFunc

// Register wires the AML admin routes under the connect admin group. The caller
// passes a guard factory (built from middleware.RequirePermission + the RBAC
// service) so each route enforces its connect.aml.* permission.
func Register(admin gin.IRouter, svc *Service, guard PermissionGuard) {
	h := NewHandler(svc)
	g := admin.Group("/aml")
	g.GET("/alerts", guard("connect.aml.view"), h.ListAlerts)
	g.GET("/cases", guard("connect.aml.view"), h.ListCases)
	g.POST("/cases", guard("connect.aml.manage"), h.OpenCase)
	g.POST("/cases/:id/file-str", guard("connect.aml.file"), h.FileSTR)
}
