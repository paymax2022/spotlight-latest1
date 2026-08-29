package creator

// HTTP layer for campaign owner self-management. Every handler takes the caller
// identity from the auth middleware's `user_id` and NEVER from the request body
// or a query param — the campaign id in the path is the only client-supplied
// input, and the service verifies ownership of it under lock.

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// selfManageStatus maps a service error to its HTTP status.
//
//	400 — malformed / invalid body
//	403 — authenticated but not the owner
//	404 — no such campaign (or no such pending request)
//	409 — owned, well-formed, but illegal in the campaign's current state
func selfManageStatus(err error) int {
	switch {
	case errors.Is(err, ErrNotOwner):
		return http.StatusForbidden
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrNoFeatureRequest):
		return http.StatusNotFound
	case errors.Is(err, ErrNoFieldsSupplied),
		errors.Is(err, ErrInvalidTitle),
		errors.Is(err, ErrInvalidGoal),
		errors.Is(err, ErrUnknownCategory):
		return http.StatusBadRequest
	case errors.Is(err, ErrCampaignDeleted),
		errors.Is(err, ErrAlreadyPaused),
		errors.Is(err, ErrNotPaused),
		errors.Is(err, ErrNotActive),
		errors.Is(err, ErrCampaignHasFunds),
		errors.Is(err, ErrGoalBelowRaised),
		errors.Is(err, ErrFeatureRequestOpen):
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

func failSelfManage(c *gin.Context, err error) {
	c.JSON(selfManageStatus(err), gin.H{"error": err.Error()})
}

// UpdateCampaign — PATCH /creator/campaigns/:id.
//
// Body is any SUBSET of {title, summary, story, category, coverImage, goalKobo}.
// An absent key leaves that column untouched.
func (h *Handler) UpdateCampaign(c *gin.Context) {
	var in CampaignUpdateRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.UpdateCampaign(c.Request.Context(), c.GetString("user_id"), c.Param("id"), in)
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
	out, err := h.svc.SetPaused(c.Request.Context(), c.GetString("user_id"), c.Param("id"), paused)
	if err != nil {
		failSelfManage(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// DeleteCampaign — DELETE /creator/campaigns/:id. Soft-delete, and only when the
// campaign has never received a contribution.
func (h *Handler) DeleteCampaign(c *gin.Context) {
	if err := h.svc.DeleteCampaign(c.Request.Context(), c.GetString("user_id"), c.Param("id")); err != nil {
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
	out, err := h.svc.RequestFeature(c.Request.Context(), c.GetString("user_id"), c.Param("id"), in.Note)
	if err != nil {
		failSelfManage(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

// WithdrawFeatureRequest — DELETE /creator/campaigns/:id/feature-request.
func (h *Handler) WithdrawFeatureRequest(c *gin.Context) {
	if err := h.svc.WithdrawFeatureRequest(c.Request.Context(), c.GetString("user_id"), c.Param("id")); err != nil {
		failSelfManage(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaignId": c.Param("id"), "status": "WITHDRAWN"})
}

// Unfeature — POST /creator/campaigns/:id/unfeature. Owner removes their OWN
// campaign from the featured rail. Always allowed, no approval.
func (h *Handler) Unfeature(c *gin.Context) {
	out, err := h.svc.Unfeature(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		failSelfManage(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}
