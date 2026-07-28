package connectdiscovery

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes the Phase-1 discovery + search endpoints.
type Handler struct{ svc *Service }

// NewHandler builds the discovery HTTP handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Discovery — GET /api/v1/connect/discovery?mode= (authenticated member).
// Curated daily matches with match-reason cards; anti-fatigue limit from config.
func (h *Handler) Discovery(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	resp, err := h.svc.Discovery(c.Request.Context(), uid, c.Query("mode"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "create your profile first"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": resp})
}

// Search — GET /api/v1/connect/search (authenticated member).
// Filters: verified-only, intent, approximate (bucketed) distance.
func (h *Handler) Search(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	f := SearchFilters{
		Mode:         c.Query("mode"),
		VerifiedOnly: c.Query("verified") == "true" || c.Query("verified_only") == "true",
		Intent:       c.Query("intent"),
	}
	if v := c.Query("max_distance_km"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.MaxDistKm = n
		}
	}
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.Limit = n
		}
	}
	results, err := h.svc.Search(c.Request.Context(), uid, f)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "create your profile first"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": results})
}
