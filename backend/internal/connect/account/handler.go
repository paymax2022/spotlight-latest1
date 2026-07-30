package connectaccount

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the member-facing account-deletion / DSR endpoint.
type Handler struct{ svc *Service }

// NewHandler wires the account handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Delete — DELETE /api/v1/connect/account (authenticated member self-serve DSR).
// The subject is ALWAYS the authenticated user (never a body param), so a member
// can only delete their own account. Idempotent; returns what was affected.
func (h *Handler) Delete(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	res, err := h.svc.DeleteAccount(c.Request.Context(), userID, userID)
	if err != nil {
		// A deletion failure must not silently leave partial state; it rolled back.
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete account"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}
