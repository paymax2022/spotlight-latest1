package transport

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ─── Event transport customer / organizer handlers ───────────────────────────

// EventOffersList lists transport offers for an event. event_id is taken from
// the query string (see the route comment for why it is not a path param).
func (h *Handler) EventOffersList(c *gin.Context) {
	eventID := c.Query("event_id")
	if eventID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "event_id required"})
		return
	}
	offers, err := h.svc.ListEventOffers(c.Request.Context(), eventID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"offers": offers})
}

// EventOfferCreate creates a transport offer (organizer = caller).
func (h *Handler) EventOfferCreate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req EventOfferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	offer, err := h.svc.CreateEventOffer(c.Request.Context(), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, offer)
}

// EventOfferGet returns an offer detail.
func (h *Handler) EventOfferGet(c *gin.Context) {
	offer, err := h.svc.EventOfferDetail(c.Request.Context(), c.Param("id"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, offer)
}

// EventBook books seats on an offer.
func (h *Handler) EventBook(c *gin.Context) {
	userID := c.GetString("user_id")
	var req EventBookRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	booking, err := h.svc.BookEventTransport(c.Request.Context(), userID, c.Param("id"), req, idemKey(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, booking)
}

// EventBookings lists the user's bookings (QR).
func (h *Handler) EventBookings(c *gin.Context) {
	userID := c.GetString("user_id")
	bookings, err := h.svc.ListEventBookings(c.Request.Context(), userID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookings": bookings})
}

// EventBookingCancel refunds + cancels a booking.
func (h *Handler) EventBookingCancel(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CancelRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.CancelEventBooking(c.Request.Context(), c.Param("id"), userID, req.Reason); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "refunded"})
}

// ─── Event transport organizer/driver handlers ───────────────────────────────

// EventValidate validates a QR → boarded.
func (h *Handler) EventValidate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req EventValidateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.ValidateEventBooking(c.Request.Context(), userID, req.QRCode)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}
