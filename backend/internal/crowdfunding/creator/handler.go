package creator

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler binds the creator Service to gin routes.
type Handler struct{ svc *Service }

// NewHandler constructs a creator Handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func statusFor(err error) int {
	if errors.Is(err, ErrNotFound) {
		return http.StatusNotFound
	}
	return http.StatusInternalServerError
}

// ─── Contributors / contributions ────────────────────────────────────────────

// GetContributors — GET /campaigns/:id/contributors.
func (h *Handler) GetContributors(c *gin.Context) {
	items, err := h.svc.GetContributors(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// ListContributions — GET /contributions.
func (h *Handler) ListContributions(c *gin.Context) {
	userID := c.GetString("user_id")
	items, err := h.svc.ListContributions(c.Request.Context(), userID, c.Query("status"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetContribution — GET /contributions/:id.
func (h *Handler) GetContribution(c *gin.Context) {
	item, err := h.svc.GetContribution(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": "contribution not found"})
		return
	}
	c.JSON(http.StatusOK, item)
}

// RequestRefund — POST /contributions/:id/refund-request. Records intent only;
// no money is moved (an admin processes the refund later).
func (h *Handler) RequestRefund(c *gin.Context) {
	var in RefundRequestInput
	_ = c.ShouldBindJSON(&in)
	res, err := h.svc.RequestRefund(c.Request.Context(), c.Param("id"), in.Reason)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// ─── Saved / recently viewed ─────────────────────────────────────────────────

// GetSaved — GET /campaigns/saved.
func (h *Handler) GetSaved(c *gin.Context) {
	userID := c.GetString("user_id")
	items, err := h.svc.GetSaved(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetRecentlyViewed — GET /campaigns/recently-viewed.
func (h *Handler) GetRecentlyViewed(c *gin.Context) {
	userID := c.GetString("user_id")
	items, err := h.svc.GetRecentlyViewed(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// SaveCampaign — POST /campaigns/:id/save.
func (h *Handler) SaveCampaign(c *gin.Context) {
	userID := c.GetString("user_id")
	res, err := h.svc.ToggleSave(c.Request.Context(), userID, c.Param("id"), true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// UnsaveCampaign — DELETE /campaigns/:id/save.
func (h *Handler) UnsaveCampaign(c *gin.Context) {
	userID := c.GetString("user_id")
	res, err := h.svc.ToggleSave(c.Request.Context(), userID, c.Param("id"), false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// ─── Creator dashboard ───────────────────────────────────────────────────────

// GetCreatorStats — GET /creator/stats.
func (h *Handler) GetCreatorStats(c *gin.Context) {
	userID := c.GetString("user_id")
	st, err := h.svc.GetCreatorStats(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, st)
}

// GetMyCampaigns — GET /creator/campaigns.
func (h *Handler) GetMyCampaigns(c *gin.Context) {
	userID := c.GetString("user_id")
	items, err := h.svc.GetMyCampaigns(c.Request.Context(), userID, c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetCreatorContributions — GET /creator/contributions.
func (h *Handler) GetCreatorContributions(c *gin.Context) {
	userID := c.GetString("user_id")
	items, err := h.svc.GetCreatorContributions(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetCreatorWithdrawals — GET /creator/withdrawals.
func (h *Handler) GetCreatorWithdrawals(c *gin.Context) {
	userID := c.GetString("user_id")
	items, err := h.svc.GetCreatorWithdrawals(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetCreatorNotifications — GET /creator/notifications.
func (h *Handler) GetCreatorNotifications(c *gin.Context) {
	userID := c.GetString("user_id")
	items, err := h.svc.GetCreatorNotifications(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetCampaignAnalytics — GET /creator/campaigns/:id/analytics.
func (h *Handler) GetCampaignAnalytics(c *gin.Context) {
	item, err := h.svc.GetCampaignAnalytics(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

// ─── Milestones ──────────────────────────────────────────────────────────────

// GetMilestones — GET /campaigns/:id/milestones.
func (h *Handler) GetMilestones(c *gin.Context) {
	items, err := h.svc.GetMilestones(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// ─── Reward fulfilment ───────────────────────────────────────────────────────

// GetRewardBackers — GET /rewards/backers.
func (h *Handler) GetRewardBackers(c *gin.Context) {
	items, err := h.svc.GetRewardBackers(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// UpdateRewardStatus — PUT /rewards/fulfilment/:id.
func (h *Handler) UpdateRewardStatus(c *gin.Context) {
	var in RewardStatusInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdateRewardStatus(c.Request.Context(), c.Param("id"), in.Status); err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "reward backer not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": c.Param("id"), "status": in.Status})
}
