package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/services"
)

type AnalyticsHandler struct { service services.AnalyticsService }

func NewAnalyticsHandler(service services.AnalyticsService) *AnalyticsHandler {
	return &AnalyticsHandler{service: service}
}

func (h *AnalyticsHandler) Summary(c *gin.Context) {
	analytics, err := h.service.GetChatAnalytics()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load chatbot analytics"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "analytics": analytics})
}
