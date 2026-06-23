package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/services"
)

type HandoffHandler struct {
	service services.HandoffService
}

func NewHandoffHandler(service services.HandoffService) *HandoffHandler {
	return &HandoffHandler{service: service}
}

func (h *HandoffHandler) List(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "200")
	status := c.Query("status")
	sessionID := c.Query("sessionId")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}

	handoffs, err := h.service.List(limit, status, sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load handoff requests"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "handoffs": handoffs})
}

func (h *HandoffHandler) UpdateStatus(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "handoff id is required"})
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
	case "pending", "in_progress", "resolved":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid status"})
		return
	}

	if err := h.service.UpdateStatus(id, status); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not update handoff"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "id": id, "status": status})
}
