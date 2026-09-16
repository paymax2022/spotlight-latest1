package engage

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// broadcastStatus maps a service error to the status the client should see.
func broadcastStatus(err error) int {
	switch {
	case errors.Is(err, ErrCannotBroadcast):
		return http.StatusForbidden
	case errors.Is(err, ErrCampaignNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrBroadcastSubjectTooShort), errors.Is(err, ErrBroadcastSubjectTooLong),
		errors.Is(err, ErrBroadcastBodyTooShort), errors.Is(err, ErrBroadcastBodyTooLong),
		errors.Is(err, ErrNoBroadcastChannel):
		return http.StatusBadRequest
	default:
		return commentStatus(err)
	}
}

// Broadcast POST /campaigns/:id/broadcast — creator only.
func (h *Handler) Broadcast(c *gin.Context) {
	var in BroadcastInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.BroadcastToContributors(c.Request.Context(), c.Param("id"), c.GetString("user_id"), in)
	if err != nil {
		c.JSON(broadcastStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
