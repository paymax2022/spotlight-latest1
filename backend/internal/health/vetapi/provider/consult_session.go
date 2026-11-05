package provider

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/health/consultengine"
	healthvet "spotlight/backend/internal/health/vet"
)

// OpenConsultSession — POST /provider/appointments/:id/consult-session. The vet
// opens the room from the workspace; the engine pins the session to the
// appointment, so the owner opening theirs converges on the same row. Opening
// also starts the legacy consult row when it has not been started yet, which is
// what the SOAP completion path releases payment against.
func (h *Handler) OpenConsultSession(c *gin.Context) {
	uid, _, ok := h.requireVet(c, true)
	if !ok {
		return
	}
	apptID, ok := pathID(c, "id")
	if !ok {
		return
	}
	if h.vet == nil {
		fail(c, http.StatusServiceUnavailable, "consult media is not available")
		return
	}
	sess, err := h.vet.OpenConsultSession(c.Request.Context(), uid, apptID)
	if err != nil {
		switch {
		case errors.Is(err, healthvet.ErrAppointmentNotFound):
			fail(c, http.StatusNotFound, "appointment not found")
		case errors.Is(err, healthvet.ErrConsultNotOpenable):
			fail(c, http.StatusConflict, err.Error())
		case errors.Is(err, healthvet.ErrConsultUnavailable),
			errors.Is(err, consultengine.ErrMediaUnavailable),
			errors.Is(err, consultengine.ErrEscrowUnavailable):
			fail(c, http.StatusServiceUnavailable, err.Error())
		case errors.Is(err, consultengine.ErrInvalid), errors.Is(err, consultengine.ErrState):
			fail(c, http.StatusConflict, err.Error())
		default:
			fail(c, http.StatusInternalServerError, err.Error())
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "session": sess})
}
