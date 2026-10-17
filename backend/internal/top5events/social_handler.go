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

// RegisterSocial attaches the like, follow, organiser profile and Following feed
// routes. /following and /organisers/me are static and sit beside the :id param
// routes (Gin resolves static before param); /organisers/me is PUT/POST while
// /organisers/:id is GET, so they are different method trees and cannot conflict.
func (h *Handler) RegisterSocial(member *gin.RouterGroup) {
	member.GET("/following", h.ListFollowing)
	member.PUT("/organisers/me", h.UpdateMyOrganiser)
	member.POST("/organisers/me/banner/presign", h.PresignOrganiserBanner)
	member.GET("/organisers/:id", h.GetOrganiser)
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

// ListFollowing is the Following feed: upcoming events of the organisers the caller
// follows. The page parameters are validated by followingPage before the service
// is called (bad input is 422).
func (h *Handler) ListFollowing(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	limit, offset, err := followingPage(c.Query("limit"), c.Query("offset"))
	if err != nil {
		socialFail(c, err)
		return
	}
	out, err := h.svc.ListFollowingEvents(c.Request.Context(), u, limit, offset)
	if err != nil {
		socialFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}

// GetOrganiser returns an organiser's public profile as seen by the caller.
func (h *Handler) GetOrganiser(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.GetOrganiser(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		socialFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}

// UpdateMyOrganiser edits the caller's own organiser profile. A banner_url that is
// neither an http(s) link nor a key under the caller's own prefix is 400; an
// explicit null or empty banner_url clears the banner.
func (h *Handler) UpdateMyOrganiser(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var in OrganiserPatch
	if err := c.ShouldBindJSON(&in); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.UpdateMyOrganiser(c.Request.Context(), u, in)
	if err != nil {
		// The contract documents 400 (not 422) for every rejected PUT body: a bad
		// banner key or URL, an over-long field, a malformed body.
		if errors.Is(err, ErrValidation) {
			c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
			return
		}
		socialFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}

// PresignOrganiserBanner mints the presigned PUT for the caller's banner. A bad
// file type is 400 (the contract's documented code, as in the restaurant presign); no
// usable object storage is 503.
func (h *Handler) PresignOrganiserBanner(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var body struct {
		FileName    string `json:"file_name" binding:"required"`
		ContentType string `json:"content_type" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.PresignOrganiserBanner(c.Request.Context(), u, body.FileName, body.ContentType)
	switch {
	case err == nil:
		c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
	case errors.Is(err, ErrBannerUploadsUnavailable):
		// httperr.Msg masks 5xx text; the app keys its "uploads unavailable" message
		// off this status and the wording is safe to show.
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "image uploads are not configured"})
	case errors.Is(err, ErrValidation):
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
	default:
		socialFail(c, err)
	}
}
