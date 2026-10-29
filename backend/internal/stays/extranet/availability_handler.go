package extranet

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// ListAvailability: GET /properties/:propertyId/availability?from=&to=
// Defaults to today through the next 89 nights when the window is not given.
func (h *Handler) ListAvailability(c *gin.Context) {
	from, to, err := parseAvailabilityWindow(c.Query("from"), c.Query("to"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.ListAvailability(c.Request.Context(), ginutil.UserID(c), c.Param("propertyId"), from, to)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

// SetAvailability: PUT /properties/:propertyId/room-types/:roomTypeId/availability
// Body: {from, to, allotment}. Sets the window for that room type.
// Rooms become unavailable only if booked; manual stop-sell is no longer supported.
func (h *Handler) SetAvailability(c *gin.Context) {
	var b struct {
		From      string `json:"from" binding:"required"`
		To        string `json:"to" binding:"required"`
		Allotment int    `json:"allotment"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	from, to, err := parseAvailabilityWindow(b.From, b.To)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	n, err := h.svc.SetAvailability(c.Request.Context(), ginutil.UserID(c), c.Param("propertyId"), c.Param("roomTypeId"),
		SetAvailabilityInput{From: from, To: to, Allotment: b.Allotment, StopSell: false})
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: gin.H{"days_updated": n}})
}

// parseAvailabilityWindow reads YYYY-MM-DD bounds. Empty values default to today
// and the next 89 nights.
func parseAvailabilityWindow(fromStr, toStr string) (time.Time, time.Time, error) {
	today := time.Now().UTC().Truncate(24 * time.Hour)
	from, to := today, today.AddDate(0, 0, 89)
	var err error
	if fromStr != "" {
		if from, err = time.Parse(dateLayout, fromStr); err != nil {
			return time.Time{}, time.Time{}, ErrValidation
		}
	}
	if toStr != "" {
		if to, err = time.Parse(dateLayout, toStr); err != nil {
			return time.Time{}, time.Time{}, ErrValidation
		}
	}
	return from, to, nil
}
