package businventory

// Gin handlers for the bus v2 inventory/booking surface. NOT wired into the
// router — composition root registers RegisterRoutes under whatever mount
// point + auth middleware the feature flag dictates. ConfirmPayment is
// deliberately NOT exposed here: it belongs to the verified webhook path
// (Paystack HMAC), never to a client route.

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// Handler carries the HTTP surface for the engine.
type Handler struct {
	svc *Service
}

// NewHandler builds the handler over the engine.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes mounts the endpoints on an already-authenticated group:
//
//	GET    /departures/:departure_id/availability?from_seq=&to_seq=
//	GET    /departures/:departure_id/quote?from_seq=&to_seq=&seats=
//	POST   /holds                       {departure_id, seat_keys[], from_seq, to_seq, ttl_seconds}  (Idempotency-Key required)
//	POST   /holds/:id/release           release one live hold (owner only)
//	POST   /bookings                    {provider_id, legs[], passengers[]}  (Idempotency-Key required)
//	GET    /bookings/:ref               booking detail (purchaser only)
//	POST   /bookings/:ref/cancel-request {reason}                        (purchaser only)
//	GET    /bookings/:ref/tickets       issued tickets (purchaser only)
//	GET    /tickets/:token              ticket by non-guessable token (purchaser only)
func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	rg.GET("/departures/:departure_id/availability", h.Availability)
	rg.GET("/departures/:departure_id/quote", h.Quote)
	rg.POST("/holds", h.CreateHold)
	rg.POST("/holds/:id/release", h.ReleaseHold)
	rg.POST("/bookings", h.CreateBooking)
	rg.GET("/bookings/:ref", h.GetBooking)
	rg.POST("/bookings/:ref/cancel-request", h.RequestCancel)
	rg.GET("/bookings/:ref/tickets", h.BookingTickets)
	rg.GET("/tickets/:token", h.GetTicket)
}

// respondErr maps a service error to the right HTTP status + machine code.
// CodedError carries an explicit status/code; everything else is a 500 with
// the message sanitized so driver/SQLSTATE internals never reach the client.
func respondErr(c *gin.Context, err error) {
	if ce, ok := errors.AsType[*CodedError](err); ok {
		c.JSON(ce.Status, ce.Body())
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
}

// holdCreateRequest is POST /holds.
type holdCreateRequest struct {
	DepartureID string   `json:"departure_id" binding:"required"`
	SeatKeys    []string `json:"seat_keys" binding:"required,min=1"`
	FromSeq     int      `json:"from_seq" binding:"required,min=1"`
	ToSeq       int      `json:"to_seq" binding:"required"`
	TTLSeconds  int      `json:"ttl_seconds"`
}

// CreateHold — POST /holds.
func (h *Handler) CreateHold(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	idem, ok := ginutil.RequireIdempotencyKey(c)
	if !ok {
		return
	}
	var req holdCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	res, err := h.svc.HoldSeats(c.Request.Context(), req.DepartureID, req.SeatKeys,
		req.FromSeq, req.ToSeq, userID, idem, time.Duration(req.TTLSeconds)*time.Second)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"hold": res})
}

// ReleaseHold — POST /holds/:id/release. Idempotent by CAS; no Idempotency-Key
// required since release moves no money and a replay is a safe no-op.
func (h *Handler) ReleaseHold(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	if err := h.svc.ReleaseHold(c.Request.Context(), c.Param("id"), userID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Availability — GET /departures/:departure_id/availability.
func (h *Handler) Availability(c *gin.Context) {
	from, to, ok := segmentParams(c)
	if !ok {
		return
	}
	res, err := h.svc.AvailableSeats(c.Request.Context(), c.Param("departure_id"), from, to)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// Quote — GET /departures/:departure_id/quote.
func (h *Handler) Quote(c *gin.Context) {
	from, to, ok := segmentParams(c)
	if !ok {
		return
	}
	seats := 1
	if v, err := strconv.Atoi(c.Query("seats")); err == nil && v > 0 {
		seats = v
	}
	res, err := h.svc.Quote(c.Request.Context(), c.Param("departure_id"), from, to, seats)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func segmentParams(c *gin.Context) (int, int, bool) {
	from, ferr := strconv.Atoi(c.Query("from_seq"))
	to, terr := strconv.Atoi(c.Query("to_seq"))
	if ferr != nil || terr != nil || from < 1 || to <= from {
		c.JSON(http.StatusBadRequest, gin.H{"error": "from_seq/to_seq must satisfy 1 <= from_seq < to_seq"})
		return 0, 0, false
	}
	return from, to, true
}

// createBookingRequest is POST /bookings.
type createBookingRequest struct {
	ProviderID string           `json:"provider_id" binding:"required"`
	Legs       []LegInput       `json:"legs" binding:"required,min=1,max=2"`
	Passengers []PassengerInput `json:"passengers" binding:"required,min=1"`
}

// CreateBooking — POST /bookings.
func (h *Handler) CreateBooking(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	idem, ok := ginutil.RequireIdempotencyKey(c)
	if !ok {
		return
	}
	var req createBookingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	d, err := h.svc.CreateBooking(c.Request.Context(), userID, req.ProviderID, req.Legs, req.Passengers, idem)
	if err != nil {
		respondErr(c, err)
		return
	}
	status := http.StatusCreated
	if d.Replayed {
		status = http.StatusOK
	}
	c.JSON(status, d)
}

// GetBooking — GET /bookings/:ref.
func (h *Handler) GetBooking(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	d, err := h.svc.GetBooking(c.Request.Context(), c.Param("ref"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// RequestCancel — POST /bookings/:ref/cancel-request.
func (h *Handler) RequestCancel(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	d, err := h.svc.RequestCancel(c.Request.Context(), c.Param("ref"), userID, req.Reason)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// BookingTickets — GET /bookings/:ref/tickets.
func (h *Handler) BookingTickets(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	d, err := h.svc.GetBooking(c.Request.Context(), c.Param("ref"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"tickets": d.Tickets})
}

// GetTicket — GET /tickets/:token.
func (h *Handler) GetTicket(c *gin.Context) {
	userID, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	t, err := h.svc.GetTicket(c.Request.Context(), c.Param("token"), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": t})
}
