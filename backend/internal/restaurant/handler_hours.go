package restaurant

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// GetBusinessHours → GET /restaurant/:id/hours
// The weekly windows plus open_now, computed by the same gate the order path uses: the
// manual switch, the schedule if the owner set one, and any dated override for today. It is
// a member read, not a staff one — a store page has to say when it shuts instead of
// letting the customer discover it at checkout.
func (h *Handler) GetBusinessHours(c *gin.Context) {
	st, err := h.svc.GetBusinessHours(c.Request.Context(), c.Param("id"))
	if err != nil {
		if errors.Is(err, ErrRestaurantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, st)
}

// SetBusinessHours → PUT /restaurant/:id/hours, body
// {"windows":[{"day_of_week":1,"open":"10:00","close":"22:00"}]} (store managers).
// A full replace, so it is idempotent: the editor sends the whole week it shows, and a
// window it drops is really gone. An empty list clears the schedule, which returns the
// store to being governed by its manual switch alone.
func (h *Handler) SetBusinessHours(c *gin.Context) {
	userID := ginutil.UserID(c)
	var body struct {
		Windows []BusinessHourInput `json:"windows"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.SetBusinessHours(c.Request.Context(), c.Param("id"), userID, body.Windows)
	if err != nil {
		if errors.Is(err, ErrBusinessHourInvalid) {
			// The body is wrong, not the caller's role: 400 with the reason, so the
			// editor can point at the window instead of reporting a failure to save.
			c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
			return
		}
		status := ownerErrStatus(err)
		c.JSON(status, gin.H{keyError: httperr.Msg(c, status, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"windows": out})
}
