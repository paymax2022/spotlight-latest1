package marketplace

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// admin_analytics_handler.go — GET /admin/analytics?range_days=N (MKT-007,
// ADM-005). See repository_admin_analytics.go's package doc for exactly which
// fields are real vs. structurally-unavailable-and-disclosed-as-0.
//
// ⚠️ Bare JSON, not respond()'s {"data": ...} envelope — matches
// getMarketplaceAnalytics() in marketplaceAdminService.ts, which does
// `return res.json()` and the analytics page reads `data.gmv_kobo` etc.
// directly off the top-level object (same contract-matching rationale as
// admin_taxonomy_handler.go).
func (h *Handler) AdminAnalytics(c *gin.Context) {
	rangeDays, err := strconv.Atoi(c.DefaultQuery("range_days", "30"))
	if err != nil || rangeDays <= 0 {
		rangeDays = 30
	}
	if rangeDays > 365 {
		rangeDays = 365 // guard against an accidental multi-year full-table scan
	}
	a, err := h.svc.repo.AdminAnalytics(c.Request.Context(), DefaultMarketID, rangeDays)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, a)
}
