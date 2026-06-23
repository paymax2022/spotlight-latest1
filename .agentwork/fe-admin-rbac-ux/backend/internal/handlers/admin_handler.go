package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/services"
)

type AdminHandler struct {
	service services.AdminService
}

func NewAdminHandler(service services.AdminService) *AdminHandler {
	return &AdminHandler{service: service}
}

func (h *AdminHandler) MenuCounts(c *gin.Context) {
	counts, err := h.service.GetMenuCounts()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load admin counts"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "counts": counts})
}
