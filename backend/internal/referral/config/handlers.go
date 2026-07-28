package config

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes referral config endpoints.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Get handles GET (member config-read + admin config get).
func (h *Handler) Get(c *gin.Context) {
	cfg, err := h.svc.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

// Update handles admin config update (PUT).
func (h *Handler) Update(c *gin.Context) {
	var in Config
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid config body"})
		return
	}
	cfg, err := h.svc.Update(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cfg)
}
