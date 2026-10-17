package top5events

// Organiser lifecycle handlers (edit / duplicate / pause / resume / cancel).
// Routes are attached via RegisterLifecycle so the wiring layer can gate them
// behind FEATURE_EVENTS_EDIT_LIFECYCLE (flag off => these 404).

import (
	"errors"
	"io"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/httperr"
)

// RegisterLifecycle attaches the lifecycle routes to the member group.
func (h *Handler) RegisterLifecycle(member *gin.RouterGroup) {
	member.PATCH("/:id", h.UpdateEvent)
	member.POST("/:id/duplicate", h.DuplicateEvent)
	member.POST("/:id/pause", h.Pause)
	member.POST("/:id/resume", h.Resume)
	member.POST("/:id/cancel", h.Cancel)
}

// lifecycleStatus maps lifecycle sentinels to HTTP statuses; unknown errors are 500.
func lifecycleStatus(err error) int {
	switch {
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrForbidden):
		return http.StatusForbidden
	case errors.Is(err, ErrEditLocked), errors.Is(err, ErrNotPurchasable), errors.Is(err, ErrEventClosed):
		return http.StatusConflict
	case errors.Is(err, ErrInvalidTimes), errors.Is(err, ErrValidation):
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}

func lifecycleFail(c *gin.Context, err error) {
	status := lifecycleStatus(err)
	if status == http.StatusInternalServerError {
		log.Printf("[top5events] lifecycle %s %s: %v", c.Request.Method, c.Request.URL.Path, err)
	}
	c.JSON(status, gin.H{"error": httperr.Msg(c, status, err)})
}

func (h *Handler) UpdateEvent(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var patch EventPatch
	if err := c.ShouldBindJSON(&patch); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.UpdateEvent(c.Request.Context(), u, c.Param("id"), patch)
	if err != nil {
		lifecycleFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}

func (h *Handler) DuplicateEvent(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.DuplicateEvent(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		lifecycleFail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": out})
}

func (h *Handler) Pause(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	if err := h.svc.Pause(c.Request.Context(), u, c.Param("id")); err != nil {
		lifecycleFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) Resume(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	if err := h.svc.Resume(c.Request.Context(), u, c.Param("id")); err != nil {
		lifecycleFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

type cancelRequest struct {
	Reason string `json:"reason"`
}

func (h *Handler) Cancel(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	key := idemKey(c)
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	var req cancelRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		bindFail(c, err)
		return
	}
	if err := h.svc.Cancel(c.Request.Context(), u, c.Param("id"), req.Reason, key); err != nil {
		lifecycleFail(c, err)
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"success": true})
}
