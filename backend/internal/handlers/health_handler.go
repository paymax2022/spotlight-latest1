package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type HealthHandler struct{}

func NewHealthHandler() *HealthHandler { return &HealthHandler{} }

func (h *HealthHandler) PublicHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "service": "backend", "status": "ok"})
}

func (h *HealthHandler) GenericHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true})
}
