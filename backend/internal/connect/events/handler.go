package connectevents

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }

// OptIn — POST /api/v1/connect/events/:id/networking/opt-in.
func (h *Handler) OptIn(c *gin.Context) {
	var in OptInInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	o, err := h.svc.OptIn(c.Request.Context(), uid(c), c.Param("id"), in)
	if err != nil {
		if errors.Is(err, ErrNoTicket) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": o})
}

// Attendees — GET /api/v1/connect/events/:id/attendees.
func (h *Handler) Attendees(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.Attendees(c.Request.Context(), uid(c), c.Param("id"), limit)
	if err != nil {
		if errors.Is(err, ErrNotOptedIn) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// CheckIn — POST /api/v1/connect/events/:id/checkin (self check-in).
func (h *Handler) CheckIn(c *gin.Context) {
	if err := h.svc.CheckInSelf(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		if errors.Is(err, ErrNoTicket) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"checked_in": true}})
}

// ScanQR — POST /api/v1/connect/events/:id/qr/scan (organiser scans a ticket QR).
func (h *Handler) ScanQR(c *gin.Context) {
	var in ScanInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ownerID, err := h.svc.ScanQR(c.Request.Context(), uid(c), c.Param("id"), in.QRCode)
	if err != nil {
		if errors.Is(err, ErrBadQR) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"checked_in_user": ownerID}})
}

// SaveContact — POST /api/v1/connect/events/:id/contacts.
func (h *Handler) SaveContact(c *gin.Context) {
	var in SaveContactInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ec, err := h.svc.SaveContact(c.Request.Context(), uid(c), c.Param("id"), in)
	if err != nil {
		switch {
		case errors.Is(err, ErrSelfContact):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, ErrNotOptedIn):
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": ec})
}

// ListContacts — GET /api/v1/connect/events/contacts?event_id=.
func (h *Handler) ListContacts(c *gin.Context) {
	out, err := h.svc.ListContacts(c.Request.Context(), uid(c), c.Query("event_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
