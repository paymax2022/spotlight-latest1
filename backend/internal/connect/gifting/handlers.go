package connectgifting

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Handler exposes the gifting money path over HTTP.
type Handler struct{ svc *Service }

// NewHandler builds a gifting handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func userID(c *gin.Context) string  { return c.GetString("user_id") }
func idemKey(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

// mapMoneyError converts service errors to HTTP status codes (shared shape with
// the monetization handler).
func mapMoneyError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrMissingIdem):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
	case errors.Is(err, ErrGiftNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "gift not found or inactive"})
	case errors.Is(err, ErrInvalidAmount), errors.Is(err, ErrAmbiguousAmount), errors.Is(err, ErrSelfGift):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		msg := err.Error()
		switch {
		case strings.Contains(msg, "insufficient funds"):
			c.JSON(http.StatusPaymentRequired, gin.H{"error": "insufficient wallet balance"})
		case strings.Contains(msg, "duplicate"):
			c.JSON(http.StatusConflict, gin.H{"error": "duplicate request"})
		case strings.Contains(msg, "limit"), strings.Contains(msg, "disabled"):
			c.JSON(http.StatusForbidden, gin.H{"error": "transaction limit exceeded"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "gift failed"})
		}
	}
}

func parseLimit(c *gin.Context) int {
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return 0
}

// SendGift — POST /api/v1/connect/gifts (member, Idempotency-Key required).
func (h *Handler) SendGift(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req SendGiftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	g, err := h.svc.Send(c.Request.Context(), uid, idemKey(c), req)
	if err != nil {
		mapMoneyError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": g})
}

// ListSent — GET /api/v1/connect/gifts/sent (member).
func (h *Handler) ListSent(c *gin.Context) {
	gifts, err := h.svc.ListSent(c.Request.Context(), userID(c), parseLimit(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gifts})
}

// ListReceived — GET /api/v1/connect/gifts/received (member).
func (h *Handler) ListReceived(c *gin.Context) {
	gifts, err := h.svc.ListReceived(c.Request.Context(), userID(c), parseLimit(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gifts})
}

// Catalog — GET /api/v1/connect/gifts/catalog (member). Backend-owned prices.
func (h *Handler) Catalog(c *gin.Context) {
	items, err := h.svc.Catalog(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// Register wires the gifting routes onto the already auth-gated member group
// (FeatureConnectEnabled + RequireAuthContext + user_id mirror inherited).
func Register(member gin.IRouter, svc *Service) {
	h := NewHandler(svc)
	member.POST("/gifts", h.SendGift) // Idempotency-Key required
	member.GET("/gifts/sent", h.ListSent)
	member.GET("/gifts/received", h.ListReceived)
	member.GET("/gifts/catalog", h.Catalog)
}
