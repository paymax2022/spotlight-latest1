package healthpharmacy

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/ginutil"
)

// Reorder — POST /orders/:id/reorder (patient; re-prices a past order's lines)
func (h *Handler) Reorder(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	orderID, ok := uuidPathID(c, "order id")
	if !ok {
		return
	}
	lines, err := h.svc.Reorder(c.Request.Context(), uid, orderID)
	if err != nil {
		failOrder(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "lines": lines})
}

// Medications — GET /medications (patient's verified/dispensed Rx items)
func (h *Handler) Medications(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	rows, err := h.svc.Medications(c.Request.Context(), uid)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "medications": rows})
}

// Refills — GET /refills (patient's dispensed items + schedule)
func (h *Handler) Refills(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	rows, err := h.svc.Refills(c.Request.Context(), uid)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "refills": rows})
}

// ScheduleRefill — POST /refills/:id/schedule  body: { auto_refill }
func (h *Handler) ScheduleRefill(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	itemID := c.Param("id")
	if _, err := uuid.Parse(itemID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "refill id must be a uuid")
		return
	}
	var req struct {
		AutoRefill bool `json:"auto_refill"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	r, err := h.svc.ScheduleRefill(c.Request.Context(), uid, itemID, req.AutoRefill)
	if err != nil {
		if errors.Is(err, ErrRefillNotFound) {
			failErr(c, http.StatusNotFound, err)
			return
		}
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "refill": r})
}
