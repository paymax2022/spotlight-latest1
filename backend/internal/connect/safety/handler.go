package connectsafety

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func parseLimit(c *gin.Context) int {
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return 0
}

// Report — POST /api/v1/connect/safety/report (authenticated member).
// Invariant 7: every safety report transactionally opens a connect_case and is
// audited; it NEVER fails silently. The reporter is the authed user (not the body).
// Returns the created case id; validation errors are 400, anything else bubbles as
// 5xx (the report is never swallowed).
func (h *Handler) Report(c *gin.Context) {
	reporterID := c.GetString("user_id")
	if reporterID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req ReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !ValidCaseType(req.Type) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid report type"})
		return
	}
	cs, err := h.svc.OpenCase(c.Request.Context(), OpenCaseInput{
		ReporterID: reporterID,
		SubjectID:  req.SubjectID,
		Type:       req.Type,
		SourceRef:  req.SourceRef,
		// Member reports default to normal; admin triage adjusts severity later.
		Severity: "normal",
		Notes:    req.Notes,
	})
	if err != nil {
		// Never swallow a safety report — surface the failure.
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not open case"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{"case_id": cs.ID, "status": cs.Status}})
}

// ListCases — GET /api/connect/admin/cases?status=&limit= (connect.cases.view)
func (h *Handler) ListCases(c *gin.Context) {
	cases, err := h.svc.ListCases(c.Request.Context(), c.Query("status"), parseLimit(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cases})
}

// GetCase — GET /api/connect/admin/cases/:id (connect.cases.view)
func (h *Handler) GetCase(c *gin.Context) {
	cs, err := h.svc.GetCase(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "case not found"})
		return
	}
	c.JSON(http.StatusOK, cs)
}

// UpdateCase — PATCH /api/connect/admin/cases/:id (connect.cases.manage)
func (h *Handler) UpdateCase(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req UpdateCaseInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cs, err := h.svc.UpdateCase(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cs)
}

// ListAudit — GET /api/connect/admin/audit?limit= (connect.audit.view)
func (h *Handler) ListAudit(c *gin.Context) {
	entries, err := h.svc.ListAudit(c.Request.Context(), parseLimit(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": entries})
}
