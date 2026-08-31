package engage

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// commentStatus maps a service error to the status the client should see.
// Everything unmapped is a 500: a bad request the caller can fix must never be
// indistinguishable from a server fault they cannot.
func commentStatus(err error) int {
	switch {
	case errors.Is(err, ErrUnauthenticated):
		return http.StatusUnauthorized
	case errors.Is(err, ErrNotCampaignCreator):
		return http.StatusForbidden
	case errors.Is(err, ErrCommentNotFound), errors.Is(err, ErrCampaignNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrEmptyBody), errors.Is(err, ErrBodyTooLong), errors.Is(err, ErrReplyToReply):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

// ListComments GET /campaigns/:id/comments
//
// The finance group this hangs off requires a bearer token, so a caller is always
// present in practice — the same bar the campaign detail sets. user_id is passed
// through so `reported` can mean "you reported this" rather than "somebody did".
func (h *Handler) ListComments(c *gin.Context) {
	out, err := h.svc.ListComments(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		c.JSON(commentStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// PostComment POST /campaigns/:id/comments
func (h *Handler) PostComment(c *gin.Context) {
	var in PostCommentInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.PostComment(c.Request.Context(), c.Param("id"), c.GetString("user_id"), in)
	if err != nil {
		c.JSON(commentStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// ReplyComment POST /comments/:commentId/reply
func (h *Handler) ReplyComment(c *gin.Context) {
	var in ReplyCommentInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.ReplyComment(c.Request.Context(), c.Param("commentId"), c.GetString("user_id"), in)
	if err != nil {
		c.JSON(commentStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// ReportComment POST /comments/:commentId/report
func (h *Handler) ReportComment(c *gin.Context) {
	if err := h.svc.ReportComment(c.Request.Context(), c.Param("commentId"), c.GetString("user_id")); err != nil {
		c.JSON(commentStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"reported": true}})
}
