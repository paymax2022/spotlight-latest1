package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/services"
)

type LeadHandler struct {
	service services.LeadService
}

func NewLeadHandler(service services.LeadService) *LeadHandler {
	return &LeadHandler{service: service}
}

func (h *LeadHandler) List(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "200")
	sessionID := c.Query("sessionId")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}

	leads, err := h.service.List(limit, sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load leads"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "leads": leads})
}

func (h *LeadHandler) UpdateStatus(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "lead id is required"})
		return
	}

	var payload struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	status := strings.TrimSpace(strings.ToLower(payload.Status))
	switch status {
	case "new", "in_review", "contacted", "closed":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid status"})
		return
	}

	if err := h.service.UpdateStatus(id, status); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not update lead"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "id": id, "status": status})
}
