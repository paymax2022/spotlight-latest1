package connectsafety

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// This file ADDITIVELY adds the member-facing block/unblock HTTP handlers to the
// existing safety Handler. No existing handler methods are changed.

// Block — POST /api/v1/connect/safety/block (authenticated member).
// Block prevents further contact/visibility and never fails silently.
func (h *Handler) Block(c *gin.Context) {
	blockerID := c.GetString("user_id")
	if blockerID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req BlockRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.Block(c.Request.Context(), blockerID, req)
	if err != nil {
		// A block must never be swallowed — surface the failure.
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not apply block"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": res})
}

// Unblock — DELETE /api/v1/connect/safety/block/:blockedId (authenticated member).
func (h *Handler) Unblock(c *gin.Context) {
	blockerID := c.GetString("user_id")
	if blockerID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	if err := h.svc.Unblock(c.Request.Context(), blockerID, c.Param("blockedId")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not remove block"})
		return
	}
	c.Status(http.StatusNoContent)
}
