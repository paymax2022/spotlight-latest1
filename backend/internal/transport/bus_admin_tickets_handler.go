package transport

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

func busQueryInt(c *gin.Context, key string) int {
	n, _ := strconv.Atoi(c.Query(key))
	return n
}

// AdminBusTickets is GET /bus/tickets (search + pagination).
func (h *AdminHandler) AdminBusTickets(c *gin.Context) {
	res, err := h.svc.ListBusTicketsAdmin(c.Request.Context(), BusAdminTicketFilter{
		Query: c.Query("q"), Status: c.Query("status"), RefundStatus: c.Query("refund_status"),
		ScheduleID: c.Query("schedule_id"), From: c.Query("from"), To: c.Query("to"),
		Limit: busQueryInt(c, "limit"), Offset: busQueryInt(c, "offset"),
	})
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// AdminBusManualRefunds is GET /bus/refunds/manual (ops refund queue).
func (h *AdminHandler) AdminBusManualRefunds(c *gin.Context) {
	res, err := h.svc.ListManualBusRefunds(c.Request.Context(),
		busQueryInt(c, "stuck_minutes"), busQueryInt(c, "limit"), busQueryInt(c, "offset"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// AdminBusResolveRefund is POST /bus/tickets/:id/resolve-refund (Idempotency-Key required).
func (h *AdminHandler) AdminBusResolveRefund(c *gin.Context) {
	key, ok := ginutil.RequireIdempotencyKey(c)
	if !ok {
		return
	}
	var req BusManualRefundRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	res, err := h.svc.ResolveManualBusRefund(c.Request.Context(), ginutil.UserID(c), c.Param("id"), key, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}
