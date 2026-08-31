package crowdfunding

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

func parseQuery(c *gin.Context) CampaignQuery {
	return CampaignQuery{
		Collection:   c.Query("collection"),
		Category:     c.Query("category"),
		Type:         c.Query("type"),
		VerifiedOnly: c.Query("verifiedOnly") == "1" || c.Query("verifiedOnly") == "true",
		UrgentOnly:   c.Query("urgentOnly") == "1" || c.Query("urgentOnly") == "true",
		Search:       c.Query("search"),
		Sort:         c.Query("sort"),
		Status:       c.Query("status"),
	}
}

// ListCampaigns — GET /campaigns (discovery).
func (h *Handler) ListCampaigns(c *gin.Context) {
	items, err := h.svc.ListCampaigns(c.Request.Context(), parseQuery(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetDetail — GET /campaigns/:id (rich detail).
func (h *Handler) GetDetail(c *gin.Context) {
	detail, err := h.svc.GetDetail(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "campaign not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": detail})
}

// ListCategories — GET /categories.
func (h *Handler) ListCategories(c *gin.Context) {
	cats, err := h.svc.ListCategories(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cats})
}

// SubmitCampaign — POST /campaigns (full create/submit flow).
func (h *Handler) SubmitCampaign(c *gin.Context) {
	userID := c.GetString("user_id")
	var req SubmitCampaignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.SubmitForReview(c.Request.Context(), userID, req)
	if err != nil {
		// A submission the caller can fix is a 400. Returning 500 for a rejected
		// milestone told the creator the server had failed when in fact their
		// funding plan needed one field changed.
		if errors.Is(err, ErrInvalidSubmission) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": res})
}

// ─── Admin handlers ──────────────────────────────────────────────────────────

// AdminListPending — GET /admin/campaigns.
func (h *Handler) AdminListPending(c *gin.Context) {
	items, err := h.svc.AdminListPending(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaigns": items})
}

// AdminGetCampaign — GET /admin/campaigns/:id.
func (h *Handler) AdminGetCampaign(c *gin.Context) {
	detail, err := h.svc.AdminCampaignDetail(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "campaign not found"})
		return
	}
	c.JSON(http.StatusOK, detail)
}

// AdminDecide — POST /admin/campaigns/:id/decision.
func (h *Handler) AdminDecide(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req ReviewDecisionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.AdminDecide(c.Request.Context(), c.Param("id"), adminID, req.Decision, req.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminStats — GET /admin/stats.
func (h *Handler) AdminStats(c *gin.Context) {
	st, err := h.svc.AdminStats(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, st)
}
