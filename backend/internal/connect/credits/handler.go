package connectcredits

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the member-facing credit balance read. Consumption is invoked
// server-side by the features that spend credits, never by the client directly.
type Handler struct{ svc *Service }

// NewHandler wires the credits handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Balances — GET /api/v1/connect/credits (member). Returns the caller's balances.
func (h *Handler) Balances(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	bals, err := h.svc.Balances(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read credits"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": bals})
}
