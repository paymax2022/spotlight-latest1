package connectconfig

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Health is an unauthenticated module liveness probe.
func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok", "module": "connect"})
}

// Config serves the backend-owned, mobile-readable config (public rows only).
func (h *Handler) Config(c *gin.Context) {
	cfg, err := h.svc.PublicConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cfg})
}

// AdminConfig serves all config entries (public + internal) for admin tooling.
// Route layer gates this behind the connect.config.view permission.
func (h *Handler) AdminConfig(c *gin.Context) {
	entries, err := h.svc.AllConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": entries})
}
