package va

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes virtual account endpoints.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// GetMe handles GET /finance/va/me
func (h *Handler) GetMe(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	va, err := h.svc.GetOrProvision(c.Request.Context(), userID)
	if err != nil {
		switch {
		case errors.Is(err, ErrTierTooLow):
			c.JSON(http.StatusForbidden, gin.H{
				"error": "Complete Tier 1 (BVN) verification to get a virtual account.",
				"code":  "tier_required",
			})
		case errors.Is(err, ErrProviderUnavailable):
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Virtual accounts are temporarily unavailable."})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, va)
}
