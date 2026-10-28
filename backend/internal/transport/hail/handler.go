package hail

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/finance/tiers"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register mounts the routes on g (expected: /api/v1/transport, already authed).
func (h *Handler) Register(g *gin.RouterGroup) {
	g.POST("/trips", h.Request)
	g.POST("/trips/:id/confirm-driver", h.ConfirmDriver)
	g.POST("/trips/:id/complete", h.Complete)
	g.GET("/trips/:id", h.Get)
}

type requestBody struct {
	PickupLat  *float64 `json:"pickup_lat" binding:"required"`
	PickupLon  *float64 `json:"pickup_lon" binding:"required"`
	DropoffLat *float64 `json:"dropoff_lat" binding:"required"`
	DropoffLon *float64 `json:"dropoff_lon" binding:"required"`
}

func (h *Handler) Request(c *gin.Context) {
	var b requestBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	t, err := h.svc.RequestTrip(c.Request.Context(), ginutil.UserID(c),
		*b.PickupLat, *b.PickupLon, *b.DropoffLat, *b.DropoffLon, c.GetHeader("Idempotency-Key"))
	respond(c, t, err)
}

func (h *Handler) ConfirmDriver(c *gin.Context) {
	t, err := h.svc.ConfirmDriver(c.Request.Context(), c.Param("id"), ginutil.UserID(c), c.GetHeader("Idempotency-Key"))
	respond(c, t, err)
}

func (h *Handler) Complete(c *gin.Context) {
	t, err := h.svc.CompleteTrip(c.Request.Context(), c.Param("id"), ginutil.UserID(c), c.GetHeader("Idempotency-Key"))
	respond(c, t, err)
}

func (h *Handler) Get(c *gin.Context) {
	t, err := h.svc.GetTrip(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	respond(c, t, err)
}

func respond(c *gin.Context, t *Trip, err error) {
	if err == nil {
		c.JSON(http.StatusOK, gin.H{"data": t})
		return
	}
	status, msg := http.StatusInternalServerError, "internal error"
	switch {
	case errors.Is(err, ErrIdempotencyKey), errors.Is(err, ErrInvalidInput):
		status, msg = http.StatusBadRequest, err.Error()
	case errors.Is(err, ErrNotFound):
		status, msg = http.StatusNotFound, "not found"
	case errors.Is(err, ErrForbidden):
		status, msg = http.StatusForbidden, "not permitted"
	case errors.Is(err, ErrInsufficientFunds), errors.Is(err, tiers.ErrWalletDisabled),
		errors.Is(err, tiers.ErrDailyLimitExceeded), errors.Is(err, tiers.ErrCheckoutAllowanceExceeded):
		status, msg = http.StatusPaymentRequired, err.Error()
	case errors.Is(err, ErrLockContended), errors.Is(err, ErrNotRequested),
		errors.Is(err, ErrNotMatched), errors.Is(err, ErrDriverUnavailable):
		status, msg = http.StatusConflict, err.Error()
	}
	c.JSON(status, gin.H{"error": msg})
}
