package transport

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/platform/ws"
)

type Handler struct {
	svc     *Service
	tracker *TripTracker
	hub     *ws.Hub
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// WithRealtime attaches the live trip-tracking hub + tracker (real-time GPS).
func (h *Handler) WithRealtime(tracker *TripTracker, hub *ws.Hub) *Handler {
	h.tracker = tracker
	h.hub = hub
	return h
}

// ServeTripWS upgrades to a WebSocket on the authenticated user's channel. The
// client receives "trip.position" messages for any trip it participates in (we
// only push to the trip's rider + driver), so no per-trip subscription is needed.
func (h *Handler) ServeTripWS(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	if h.hub == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "realtime not configured"})
		return
	}
	_ = h.hub.ServeHTTP(c.Writer, c.Request, uid)
}

// TrackPosition ingests one driver GPS sample for a trip and fans the snapped
// position out to the rider + driver in real time. Driver-only.
func (h *Handler) TrackPosition(c *gin.Context) {
	uid := c.GetString("user_id")
	tripID := c.Param("id")
	if h.tracker == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "realtime not configured"})
		return
	}
	var p TrackPoint
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.tracker.Ingest(c.Request.Context(), tripID, uid, p); err != nil {
		if errors.Is(err, ErrNotTripDriver) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error(), "code": "not_trip_driver"})
			return
		}
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"ok": true})
}

// respondErr maps a service error to the right HTTP status + machine code.
// CodedError carries an explicit status/code; everything else is a 500.
func respondErr(c *gin.Context, err error) {
	var ce *CodedError
	if errors.As(err, &ce) {
		c.JSON(ce.Status, gin.H{"error": ce.Message, "code": ce.Code})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
}

// idemKey reads the Idempotency-Key header (falls back to body field at call site).
func idemKey(c *gin.Context) string {
	return c.GetHeader("Idempotency-Key")
}

func (h *Handler) RegisterDriver(c *gin.Context) {
	userID := c.GetString("user_id")
	var req RegisterDriverRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d, err := h.svc.RegisterDriver(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, d)
}

func (h *Handler) SetStatus(c *gin.Context) {
	userID := c.GetString("user_id")
	var body struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetDriverStatus(c.Request.Context(), userID, DriverStatus(body.Status)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) RequestTrip(c *gin.Context) {
	userID := c.GetString("user_id")
	var req RequestTripRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	trip, err := h.svc.RequestTrip(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, trip)
}

func (h *Handler) AcceptTrip(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.AcceptTrip(c.Request.Context(), c.Param("id"), userID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) UpdateStatus(c *gin.Context) {
	userID := c.GetString("user_id")
	var body struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdateTripStatus(c.Request.Context(), c.Param("id"), userID, TripStatus(body.Status)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
