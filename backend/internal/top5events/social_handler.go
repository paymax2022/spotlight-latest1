package top5events

// Event like / organiser follow handlers. Routes are attached via RegisterSocial
// so the wiring layer can gate them behind FEATURE_EVENTS_SOCIAL (flag off =>
// the routes are not mounted and 404). Every route parameter is named :id:
// Gin rejects sibling wildcards with different names at the same level.

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/httperr"
)

// RegisterSocial attaches the like and follow routes.
func (h *Handler) RegisterSocial(member *gin.RouterGroup) {
	member.POST("/:id/like", h.LikeEvent)
	member.DELETE("/:id/like", h.UnlikeEvent)
	member.POST("/organisers/:id/follow", h.FollowOrganiser)
	member.DELETE("/organisers/:id/follow", h.UnfollowOrganiser)
}

// socialStatus maps social sentinels to HTTP statuses: not found is 404 and a
// validation failure (including self-follow) is 422.
func socialStatus(err error) int {
	switch {
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrValidation):
		return http.StatusUnprocessableEntity
	}
	return http.StatusInternalServerError
}

func socialFail(c *gin.Context, err error) {
	status := socialStatus(err)
	if status == http.StatusInternalServerError {
		log.Printf("[top5events] social %s %s: %v", c.Request.Method, c.Request.URL.Path, err)
	}
	c.JSON(status, gin.H{"error": httperr.Msg(c, status, err)})
}

// LikeEvent likes a public event for the caller (idempotent).
func (h *Handler) LikeEvent(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.LikeEvent(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		socialFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}

// UnlikeEvent removes the caller's like (idempotent).
func (h *Handler) UnlikeEvent(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.UnlikeEvent(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		socialFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}

// FollowOrganiser follows an organiser for the caller (idempotent; self-follow is 422).
func (h *Handler) FollowOrganiser(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.FollowOrganiser(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		socialFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}

// UnfollowOrganiser removes the caller's follow (idempotent).
func (h *Handler) UnfollowOrganiser(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.UnfollowOrganiser(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		socialFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}
