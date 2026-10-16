package tiers

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/httperr"
)

// TierReader is the read seam AdminGetTier needs (satisfied by *Service).
type TierReader interface {
	GetUserTier(ctx context.Context, userID string) (Tier, error)
}

// AdminGetTier handles GET /finance/admin/tiers/:user_id (read-only).
// It returns the RAW tier and limits; interpretation is the caller's:
// Tier 0 limits 0/0 = wallet disabled, Tier 3 limits 0/0 = unlimited.
func AdminGetTier(r TierReader) gin.HandlerFunc {
	return func(c *gin.Context) {
		t, err := r.GetUserTier(c.Request.Context(), c.Param("user_id"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		cfg := GetConfig(t)
		c.JSON(http.StatusOK, gin.H{
			"tier":                int(t),
			"dailyDebitLimitKobo": cfg.DailyDebitLimitKobo,
			"maxBalanceKobo":      cfg.MaxBalanceKobo,
		})
	}
}
