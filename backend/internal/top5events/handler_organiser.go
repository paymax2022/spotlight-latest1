package top5events

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// RegisterOrganiserGate mounts the organiser-eligibility read (EVTA-D001).
// Mounted regardless of FEATURE_EVENTS_ORGANISER_GATE: with the flag off it
// reports gate_enabled=false / can_organise=true, so a client never has to
// guess the server's flag state.
//
//	GET /api/finance/events/organiser/eligibility
func (h *Handler) RegisterOrganiserGate(member *gin.RouterGroup) {
	member.GET("/organiser/eligibility", h.OrganiserEligibility)
}

// OrganiserEligibility answers whether the caller may create/publish events,
// and which onboarding merchant type to apply for when they may not.
func (h *Handler) OrganiserEligibility(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.Eligibility(c.Request.Context(), u)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: "internal error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: out})
}
