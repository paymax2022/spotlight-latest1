package engage

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// updateStatus maps a service error to the status the client should see. Shares
// the comment mapping for the errors both paths raise, and adds the update-only
// validation cases.
func updateStatus(err error) int {
	switch {
	case errors.Is(err, ErrUpdateNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrCannotPublishUpdate):
		return http.StatusForbidden
	case errors.Is(err, ErrEmptyTitle), errors.Is(err, ErrTitleTooLong),
		errors.Is(err, ErrEmptyUpdateBody), errors.Is(err, ErrUpdateBodyTooLong):
		return http.StatusBadRequest
	default:
		return commentStatus(err)
	}
}

// ListUpdates GET /campaigns/:id/updates
//
// The same rows are embedded in the campaign detail; this exists for callers that
// want updates alone. Auth comes from the finance group, as it does for the
// detail — there is no anonymous read of a campaign anywhere in this module.
func (h *Handler) ListUpdates(c *gin.Context) {
	out, err := h.svc.ListUpdates(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(updateStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// PostUpdate POST /campaigns/:id/updates — creator only.
func (h *Handler) PostUpdate(c *gin.Context) {
	var in PostUpdateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.PostUpdate(c.Request.Context(), c.Param("id"), c.GetString("user_id"), in)
	if err != nil {
		c.JSON(updateStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// LikeUpdate POST /updates/:updateId/like — idempotent; returns the new count.
func (h *Handler) LikeUpdate(c *gin.Context) {
	count, err := h.svc.LikeUpdate(c.Request.Context(), c.Param("updateId"), c.GetString("user_id"))
	if err != nil {
		c.JSON(updateStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"likeCount": count}})
}
