package referrals

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/httperr"
)

// CaseReader is the read seam AdminGetCaseByUser needs (satisfied by *RewardService).
type CaseReader interface {
	GetCase(ctx context.Context, referrerID string) (*CaseView, error)
}

// AdminGetCaseByUser handles GET /finance/admin/referrals/:user_id — a thin
// read-only alias of GET /v1/admin/referrals/:referrerId/case so the admin
// console reaches it through the same /api admin proxy as the other profile panels.
func AdminGetCaseByUser(r CaseReader) gin.HandlerFunc {
	return func(c *gin.Context) {
		cv, err := r.GetCase(c.Request.Context(), c.Param("user_id"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		c.JSON(http.StatusOK, cv)
	}
}
