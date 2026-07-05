package connectpayouts

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Handler exposes the creator payout money path over HTTP.
type Handler struct{ svc *Service }

// NewHandler builds a payouts handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func userID(c *gin.Context) string  { return c.GetString("user_id") }
func idemKey(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

func mapMoneyError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrMissingIdem):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrTierTooLow):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
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
			c.JSON(http.StatusInternalServerError, gin.H{"error": "payout failed"})
		}
	}
}

// RequestPayout — POST /api/v1/connect/payouts (member, Idempotency-Key required).
func (h *Handler) RequestPayout(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req RequestPayoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.Request(c.Request.Context(), uid, idemKey(c), req)
	if err != nil {
		mapMoneyError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": p})
}

// ListPayouts — GET /api/v1/connect/payouts (member).
func (h *Handler) ListPayouts(c *gin.Context) {
	limit := 0
	if v := c.Query("limit"); v != "" {
		limit, _ = strconv.Atoi(v)
	}
	out, err := h.svc.List(c.Request.Context(), userID(c), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Register wires the payout routes onto the auth-gated member group.
func Register(member gin.IRouter, svc *Service) {
	h := NewHandler(svc)
	member.POST("/payouts", h.RequestPayout) // Idempotency-Key required
	member.GET("/payouts", h.ListPayouts)
}
