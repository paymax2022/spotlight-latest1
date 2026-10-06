package creator

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// Handler binds the creator Service to gin routes.
type Handler struct{ svc *Service }

var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusNotFound, ErrNotFound),
	httperr.R(http.StatusForbidden, ErrNotOwner),
)

// NewHandler constructs a creator Handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// GetContributors — GET /campaigns/:id/contributors.
func (h *Handler) GetContributors(c *gin.Context) {
	items, err := h.svc.GetContributors(c.Request.Context(), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// ListContributions — GET /contributions.
func (h *Handler) ListContributions(c *gin.Context) {
	userID := ginutil.UserID(c)
	items, err := h.svc.ListContributions(c.Request.Context(), userID, c.Query("status"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetContribution — GET /contributions/:id. Scoped to the caller: another
// contributor's id reads as 404, not as their contribution.
func (h *Handler) GetContribution(c *gin.Context) {
	item, err := h.svc.GetContribution(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		c.JSON(errMap.Code(err), gin.H{"error": "contribution not found"})
		return
	}
	c.JSON(http.StatusOK, item)
}

// RequestRefund — POST /contributions/:id/refund-request. Records intent only;
// no money is moved (an admin processes the refund later). Scoped to the
// caller: another contributor's id reads as 404, not as their refund request.
func (h *Handler) RequestRefund(c *gin.Context) {
	var in RefundRequestInput
	_ = c.ShouldBindJSON(&in)
	res, err := h.svc.RequestRefund(c.Request.Context(), c.Param("id"), ginutil.UserID(c), in.Reason)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetSaved — GET /campaigns/saved.
func (h *Handler) GetSaved(c *gin.Context) {
	userID := ginutil.UserID(c)
	items, err := h.svc.GetSaved(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetRecentlyViewed — GET /campaigns/recently-viewed.
func (h *Handler) GetRecentlyViewed(c *gin.Context) {
	userID := ginutil.UserID(c)
	items, err := h.svc.GetRecentlyViewed(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// SaveCampaign — POST /campaigns/:id/save.
func (h *Handler) SaveCampaign(c *gin.Context) {
	userID := ginutil.UserID(c)
	res, err := h.svc.ToggleSave(c.Request.Context(), userID, c.Param("id"), true)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// UnsaveCampaign — DELETE /campaigns/:id/save.
func (h *Handler) UnsaveCampaign(c *gin.Context) {
	userID := ginutil.UserID(c)
	res, err := h.svc.ToggleSave(c.Request.Context(), userID, c.Param("id"), false)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetCreatorStats — GET /creator/stats.
func (h *Handler) GetCreatorStats(c *gin.Context) {
	userID := ginutil.UserID(c)
	st, err := h.svc.GetCreatorStats(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, st)
}

// GetMyCampaigns — GET /creator/campaigns.
func (h *Handler) GetMyCampaigns(c *gin.Context) {
	userID := ginutil.UserID(c)
	items, err := h.svc.GetMyCampaigns(c.Request.Context(), userID, c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetCreatorContributions — GET /creator/contributions.
func (h *Handler) GetCreatorContributions(c *gin.Context) {
	userID := ginutil.UserID(c)
	items, err := h.svc.GetCreatorContributions(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetCreatorWithdrawals — GET /creator/withdrawals.
func (h *Handler) GetCreatorWithdrawals(c *gin.Context) {
	userID := ginutil.UserID(c)
	items, err := h.svc.GetCreatorWithdrawals(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetCreatorNotifications — GET /creator/notifications.
func (h *Handler) GetCreatorNotifications(c *gin.Context) {
	userID := ginutil.UserID(c)
	items, err := h.svc.GetCreatorNotifications(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetCampaignAnalytics — GET /creator/campaigns/:id/analytics.
func (h *Handler) GetCampaignAnalytics(c *gin.Context) {
	item, err := h.svc.GetCampaignAnalytics(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

// GetMilestones — GET /campaigns/:id/milestones.
func (h *Handler) GetMilestones(c *gin.Context) {
	items, err := h.svc.GetMilestones(c.Request.Context(), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// GetRewardBackers — GET /rewards/backers.
func (h *Handler) GetRewardBackers(c *gin.Context) {
	items, err := h.svc.GetRewardBackers(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// UpdateRewardStatus — PUT /rewards/fulfilment/:id.
func (h *Handler) UpdateRewardStatus(c *gin.Context) {
	var in RewardStatusInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.UpdateRewardStatus(c.Request.Context(), c.Param("id"), in.Status); err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "reward backer not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": c.Param("id"), "status": in.Status})
}

// HTTP layer for campaign owner self-management. Every handler takes the caller
// identity from the auth middleware's `user_id` and NEVER from the request body
// or a query param — the campaign id in the path is the only client-supplied
// input, and the service verifies ownership of it under lock.

// selfManageErrMap maps a service error to its HTTP status.
//
//	400 — malformed / invalid body
//	403 — authenticated but not the owner
//	404 — no such campaign (or no such pending request)
//	409 — owned, well-formed, but illegal in the campaign's current state
var selfManageErrMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusForbidden, ErrNotOwner),
	httperr.R(http.StatusNotFound, ErrNotFound, ErrNoFeatureRequest),
	httperr.R(http.StatusBadRequest, ErrNoFieldsSupplied, ErrInvalidTitle, ErrInvalidGoal, ErrUnknownCategory),
	httperr.R(http.StatusConflict, ErrCampaignDeleted, ErrAlreadyPaused, ErrNotPaused, ErrNotActive,
		ErrCampaignHasFunds, ErrGoalBelowRaised, ErrFeatureRequestOpen),
)

func failSelfManage(c *gin.Context, err error) {
	selfManageErrMap.Write(c, err)
}

// UpdateCampaign — PATCH /creator/campaigns/:id.
// Body is any SUBSET of {title, summary, story, category, coverImage, goalKobo}.
// An absent key leaves that column untouched.
func (h *Handler) UpdateCampaign(c *gin.Context) {
	var in CampaignUpdateRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.UpdateCampaign(c.Request.Context(), ginutil.UserID(c), c.Param("id"), in)
	if err != nil {
		failSelfManage(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// PauseCampaign — POST /creator/campaigns/:id/pause.
func (h *Handler) PauseCampaign(c *gin.Context) { h.setPaused(c, true) }

// ResumeCampaign — POST /creator/campaigns/:id/resume.
func (h *Handler) ResumeCampaign(c *gin.Context) { h.setPaused(c, false) }

func (h *Handler) setPaused(c *gin.Context, paused bool) {
	out, err := h.svc.SetPaused(c.Request.Context(), ginutil.UserID(c), c.Param("id"), paused)
	if err != nil {
		failSelfManage(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// DeleteCampaign — DELETE /creator/campaigns/:id. Soft-delete, and only when the
// campaign has never received a contribution.
func (h *Handler) DeleteCampaign(c *gin.Context) {
	if err := h.svc.DeleteCampaign(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		failSelfManage(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": c.Param("id"), "deleted": true})
}

// RequestFeature — POST /creator/campaigns/:id/feature-request.
// Records a request for an admin to action; never sets campaigns.featured.
func (h *Handler) RequestFeature(c *gin.Context) {
	var in FeatureRequestInput
	_ = c.ShouldBindJSON(&in) // body is optional — a bare POST is a valid request
	out, err := h.svc.RequestFeature(c.Request.Context(), ginutil.UserID(c), c.Param("id"), in.Note)
	if err != nil {
		failSelfManage(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

// WithdrawFeatureRequest — DELETE /creator/campaigns/:id/feature-request.
func (h *Handler) WithdrawFeatureRequest(c *gin.Context) {
	if err := h.svc.WithdrawFeatureRequest(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		failSelfManage(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaignId": c.Param("id"), "status": "WITHDRAWN"})
}

// Unfeature — POST /creator/campaigns/:id/unfeature. Owner removes their OWN
// campaign from the featured rail. Always allowed, no approval.
func (h *Handler) Unfeature(c *gin.Context) {
	out, err := h.svc.Unfeature(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		failSelfManage(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// Register wires the crowdfunding creator-dashboard routes onto the supplied
// router group. The caller mounts `rg` under the crowdfunding prefix and applies
// auth middleware that sets `user_id`.
// IMPORTANT: the campaign-scoped routes use the SAME param name ':id' as the
// sibling discovery/wallet packages (which register /campaigns/:id,
// /campaigns/:id/wallet, /campaigns/:id/ledger on the same group) to avoid Gin
// wildcard-conflict panics on the shared /campaigns/:id/* tree. Owner
// self-management routes each verify campaign ownership under FOR UPDATE inside
// the writing transaction (see selfmanage.go).
func Register(rg *gin.RouterGroup, db *pgxpool.Pool) {
	h := NewHandler(NewService(db))

	rg.GET("/campaigns/:id/contributors", h.GetContributors)
	rg.GET("/campaigns/:id/milestones", h.GetMilestones)
	rg.POST("/campaigns/:id/save", h.SaveCampaign)
	rg.DELETE("/campaigns/:id/save", h.UnsaveCampaign)

	// Static campaign-collection routes — mounted OFF the /campaigns/:id param
	// tree (Gin panics on a static sibling of a wildcard segment).
	rg.GET("/saved-campaigns", h.GetSaved)
	rg.GET("/recently-viewed", h.GetRecentlyViewed)

	rg.GET("/contributions", h.ListContributions)
	rg.GET("/contributions/:id", h.GetContribution)
	rg.POST("/contributions/:id/refund-request", h.RequestRefund)

	rg.GET("/creator/stats", h.GetCreatorStats)
	rg.GET("/creator/campaigns", h.GetMyCampaigns)
	rg.GET("/creator/contributions", h.GetCreatorContributions)
	rg.GET("/creator/withdrawals", h.GetCreatorWithdrawals)
	rg.GET("/creator/notifications", h.GetCreatorNotifications)
	rg.GET("/creator/campaigns/:id/analytics", h.GetCampaignAnalytics)

	// Shares the ':id' param with the analytics route above (Gin requires one
	// param name per path segment position).
	rg.PATCH("/creator/campaigns/:id", h.UpdateCampaign)
	rg.DELETE("/creator/campaigns/:id", h.DeleteCampaign)
	rg.POST("/creator/campaigns/:id/pause", h.PauseCampaign)
	rg.POST("/creator/campaigns/:id/resume", h.ResumeCampaign)
	rg.POST("/creator/campaigns/:id/feature-request", h.RequestFeature)
	rg.DELETE("/creator/campaigns/:id/feature-request", h.WithdrawFeatureRequest)
	rg.POST("/creator/campaigns/:id/unfeature", h.Unfeature)

	rg.GET("/rewards/backers", h.GetRewardBackers)
	rg.PUT("/rewards/fulfilment/:id", h.UpdateRewardStatus)
}
