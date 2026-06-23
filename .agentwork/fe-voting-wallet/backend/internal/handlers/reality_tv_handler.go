package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/services"
)

type RealityTVHandler struct {
	service services.RealityTVService
}

func NewRealityTVHandler(service services.RealityTVService) *RealityTVHandler {
	return &RealityTVHandler{service: service}
}

func (h *RealityTVHandler) Dashboard(c *gin.Context) {
	metrics, err := h.service.GetDashboardMetrics()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load reality tv dashboard"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "metrics": metrics})
}
