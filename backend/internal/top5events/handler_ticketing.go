package top5events

// Organiser ticketing-depth handlers (tier / promo edit). Routes are attached
// via RegisterTicketing so the wiring layer can gate them behind
// FEATURE_EVENTS_TICKETING_DEPTH (flag off => these 404).

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/httperr"
)

// RegisterTicketing attaches the tier/promo edit routes to the member group.
func (h *Handler) RegisterTicketing(member *gin.RouterGroup) {
	member.PATCH("/:id/tiers/:tierId", h.UpdateTier)
	member.PATCH("/:id/promos/:promoId", h.UpdatePromo)
}

// ticketingStatus maps ticketing sentinels to HTTP statuses; unknown errors are 500.
func ticketingStatus(err error) int {
	switch {
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrForbidden):
		return http.StatusForbidden
	case errors.Is(err, ErrTierLocked), errors.Is(err, ErrPromoLocked),
		errors.Is(err, ErrInviteOnly), errors.Is(err, ErrTierNotOnSale):
		return http.StatusConflict
	case errors.Is(err, ErrInvalidWindow), errors.Is(err, ErrValidation):
		return http.StatusBadRequest
	case errors.Is(err, ErrPromoNotApplicable):
		return http.StatusUnprocessableEntity
	}
	return http.StatusInternalServerError
}

func ticketingFail(c *gin.Context, err error) {
	status := ticketingStatus(err)
	if status == http.StatusInternalServerError {
		log.Printf("[top5events] ticketing %s %s: %v", c.Request.Method, c.Request.URL.Path, err)
	}
	c.JSON(status, gin.H{"error": httperr.Msg(c, status, err)})
}

func (h *Handler) UpdateTier(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var patch TierPatch
	if err := c.ShouldBindJSON(&patch); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.UpdateTier(c.Request.Context(), u, c.Param("id"), c.Param("tierId"), patch)
	if err != nil {
		ticketingFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}

func (h *Handler) UpdatePromo(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var patch PromoPatch
	if err := c.ShouldBindJSON(&patch); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.UpdatePromo(c.Request.Context(), u, c.Param("id"), c.Param("promoId"), patch)
	if err != nil {
		ticketingFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": out})
}
