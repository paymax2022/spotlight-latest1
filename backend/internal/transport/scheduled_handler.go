package transport

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// ─── Member (rider) scheduled-booking handlers ───────────────────────────────
//
// Mounted under the existing `mob` group → /api/finance/mobility/scheduled*.
// Auth (user_id) is set by the group middleware; OLA to the owner is enforced in
// the Service. Idempotency-Key is required on the two money-adjacent POSTs
// (create, cancel) and read via the Idempotency-Key header (idemKey()).

// ScheduledCreate handles POST /mobility/scheduled.
func (h *Handler) ScheduledCreate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req ScheduledCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	key := idemKey(c)
	b, err := h.svc.CreateScheduled(c.Request.Context(), userID, req, key)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, b)
}

// ScheduledList handles GET /mobility/scheduled?filter=upcoming|past|all&cursor&limit.
func (h *Handler) ScheduledList(c *gin.Context) {
	userID := c.GetString("user_id")
	filter := c.DefaultQuery("filter", "all")
	cursor := c.Query("cursor")
	limit, _ := strconv.Atoi(c.Query("limit"))
	items, err := h.svc.ListScheduled(c.Request.Context(), userID, filter, cursor, limit)
	if err != nil {
		respondErr(c, err)
		return
	}
	var nextCursor string
	if n := len(items); n > 0 {
		nextCursor = items[n-1].CreatedAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00")
	}
	c.JSON(http.StatusOK, gin.H{"bookings": items, "nextCursor": nextCursor})
}

// ScheduledGet handles GET /mobility/scheduled/:id (OLA).
func (h *Handler) ScheduledGet(c *gin.Context) {
	userID := c.GetString("user_id")
	b, err := h.svc.GetScheduled(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}

// ScheduledPatch handles PATCH /mobility/scheduled/:id (reschedule/edit).
func (h *Handler) ScheduledPatch(c *gin.Context) {
	userID := c.GetString("user_id")
	var req ScheduledPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b, err := h.svc.RescheduleScheduled(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}

// ScheduledCancel handles POST /mobility/scheduled/:id/cancel (Idempotency-Key).
func (h *Handler) ScheduledCancel(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CancelRequest
	_ = c.ShouldBindJSON(&req)
	key := idemKey(c)
	b, err := h.svc.CancelScheduled(c.Request.Context(), c.Param("id"), userID, req.Reason, key)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}

// ScheduledEstimate handles POST /mobility/scheduled/estimate (fare/ETA quote).
func (h *Handler) ScheduledEstimate(c *gin.Context) {
	var req ScheduledEstimateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.EstimateScheduled(c.Request.Context(), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}
