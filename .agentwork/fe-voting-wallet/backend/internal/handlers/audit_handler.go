package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/services"
)

type AuditHandler struct{ svc services.AuditService }

func NewAuditHandler(svc services.AuditService) *AuditHandler { return &AuditHandler{svc: svc} }

func auditFilterFromQuery(c *gin.Context) domain.AuditFilter {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	return domain.AuditFilter{
		Limit:      limit,
		ActorUser:  c.Query("actorUser"),
		TargetUser: c.Query("targetUser"),
		Module:     c.Query("module"),
		Action:     c.Query("action"),
		Severity:   c.Query("severity"),
		DateFrom:   c.Query("dateFrom"),
		DateTo:     c.Query("dateTo"),
		Status:     c.Query("status"),
		Email:      c.Query("email"),
	}
}

func (h *AuditHandler) AuditLogs(c *gin.Context) {
	rows, err := h.svc.ListAuditLogs(auditFilterFromQuery(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "logs": rows})
}

func (h *AuditHandler) LoginActivity(c *gin.Context) {
	rows, err := h.svc.ListLoginActivity(auditFilterFromQuery(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "activity": rows})
}

func (h *AuditHandler) SecurityEvents(c *gin.Context) {
	rows, err := h.svc.ListSecurityEvents(auditFilterFromQuery(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "events": rows})
}

func (h *AuditHandler) ExportAuditLogs(c *gin.Context) {
	rows, err := h.svc.ListAuditLogs(auditFilterFromQuery(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	payload, err := json.MarshalIndent(rows, "", "  ")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "export failed"})
		return
	}
	c.Header("Content-Disposition", "attachment; filename=audit-logs.json")
	c.Data(http.StatusOK, "application/json", payload)
}
