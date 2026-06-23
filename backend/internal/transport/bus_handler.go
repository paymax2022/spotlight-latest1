package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ─── Bus customer handlers ───────────────────────────────────────────────────

// BusRoutes searches routes by origin/dest.
func (h *Handler) BusRoutes(c *gin.Context) {
	routes, err := h.svc.SearchBusRoutes(c.Request.Context(), c.Query("origin"), c.Query("dest"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"routes": routes})
}

// BusSchedules lists schedules for a route + seats left.
func (h *Handler) BusSchedules(c *gin.Context) {
	routeID := c.Query("route_id")
	if routeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "route_id required"})
		return
	}
	scheds, err := h.svc.ListBusSchedules(c.Request.Context(), routeID, c.Query("date"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"schedules": scheds})
}

// BusBook books a seat and issues a QR ticket.
func (h *Handler) BusBook(c *gin.Context) {
	userID := c.GetString("user_id")
	var req BusBookRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ticket, err := h.svc.BookBusTicket(c.Request.Context(), userID, req, idemKey(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, ticket)
}

// BusTickets lists the user's tickets.
func (h *Handler) BusTickets(c *gin.Context) {
	userID := c.GetString("user_id")
	tickets, err := h.svc.ListBusTickets(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"tickets": tickets})
}

// BusTicketCancel refunds + cancels a ticket.
func (h *Handler) BusTicketCancel(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CancelRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.CancelBusTicket(c.Request.Context(), c.Param("id"), userID, req.Reason); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "cancelled"})
}

// ─── Bus operator (driver) handlers ──────────────────────────────────────────

// BusValidate validates a QR → boarded.
func (h *Handler) BusValidate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req BusValidateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.ValidateBusTicket(c.Request.Context(), userID, req.QRCode)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ─── Bus admin handlers ──────────────────────────────────────────────────────

// AdminBusListRoutes lists all routes.
func (h *AdminHandler) AdminBusListRoutes(c *gin.Context) {
	routes, err := h.svc.ListBusRoutes(c.Request.Context())
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"routes": routes})
}

// AdminBusCreateRoute creates a route.
func (h *AdminHandler) AdminBusCreateRoute(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req BusRouteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.CreateBusRoute(c.Request.Context(), adminID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, r)
}

// AdminBusCreateSchedule creates a schedule.
func (h *AdminHandler) AdminBusCreateSchedule(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req BusScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sch, err := h.svc.CreateBusSchedule(c.Request.Context(), adminID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, sch)
}

// AdminBusApproveFare approves a schedule fare.
func (h *AdminHandler) AdminBusApproveFare(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req CancelRequest // reuse {reason}
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.ApproveBusFare(c.Request.Context(), adminID, c.Param("id"), req.Reason); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "fare_approved": true})
}

// AdminBusManifest returns a schedule manifest.
func (h *AdminHandler) AdminBusManifest(c *gin.Context) {
	scheduleID := c.Query("schedule_id")
	if scheduleID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "schedule_id required"})
		return
	}
	m, err := h.svc.BusManifest(c.Request.Context(), scheduleID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"manifest": m})
}
