package restaurant

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/platform/ws"
)

type Handler struct {
	svc *Service
	hub *ws.Hub
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// WithRealtime attaches the WS hub used for the per-order live channel.
func (h *Handler) WithRealtime(hub *ws.Hub) *Handler {
	h.hub = hub
	return h
}

func (h *Handler) Create(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CreateRestaurantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.CreateRestaurant(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, r)
}

func (h *Handler) PlaceOrder(c *gin.Context) {
	userID := c.GetString("user_id")
	var req PlaceOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Idempotency-Key is a HEADER by client convention (every money route). Prefer
	// the header; fall back to the body field for any legacy caller. Fail closed.
	if hk := c.GetHeader("Idempotency-Key"); hk != "" {
		req.IdempotencyKey = hk
	}
	if req.IdempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key is required"})
		return
	}
	// Normalize each line so the service sees canonical MenuItemID/Quantity
	// regardless of whether the client sent item_id/qty (mobile) or
	// menu_item_id/quantity (canonical). Validate fail-closed.
	for idx := range req.Items {
		req.Items[idx].MenuItemID = req.Items[idx].MenuItem()
		req.Items[idx].Quantity = req.Items[idx].QtyOf()
		if req.Items[idx].MenuItemID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "each item requires an item_id"})
			return
		}
		if req.Items[idx].Quantity < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "each item requires a quantity >= 1"})
			return
		}
	}
	order, err := h.svc.PlaceOrder(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		if code, ok := escrowErrStatus(err); ok {
			c.JSON(code, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, order)
}

// escrowErrStatus maps the fail-closed money-path refusals a wallet-escrowing order
// placement can return to their HTTP status. It reports ok=false for anything else so
// each caller keeps its own default (PlaceOrder → 500, group finalize → statusCodeFor).
//
// Mirrors withdrawalErrStatus (handler_withdrawal.go) — the two money paths in this
// module must answer the same refusal with the same code.
func escrowErrStatus(err error) (int, bool) {
	switch {
	case errors.Is(err, tiers.ErrWalletDisabled), errors.Is(err, tiers.ErrDailyLimitExceeded):
		// The caller's KYC tier forbids this debit (no wallet at Tier 0, or today's
		// cap is spent). 403, not 400 — the request is well-formed, the caller isn't
		// permitted to spend this much today.
		return http.StatusForbidden, true
	case errors.Is(err, ledger.ErrInsufficientFunds):
		return http.StatusPaymentRequired, true // 402 — wallet is short of the total
	case errors.Is(err, ErrTierGateUnwired):
		// Server misconfiguration, not the caller's fault, and retryable once wired.
		return http.StatusServiceUnavailable, true
	case errors.Is(err, ErrOrderMissingIdem):
		return http.StatusBadRequest, true
	}
	return 0, false
}

// DeliveryQuote previews the delivery fee for a destination before order placement.
// POST /restaurant/:id/delivery-quote  body {lat,lng[,night,weather]}.
func (h *Handler) DeliveryQuote(c *gin.Context) {
	var body struct {
		Lat     float64 `json:"lat" binding:"required"`
		Lng     float64 `json:"lng" binding:"required"`
		Night   *bool   `json:"night,omitempty"`
		Weather *bool   `json:"weather,omitempty"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	q, err := h.svc.QuoteDelivery(c.Request.Context(), c.Param("id"), body.Lat, body.Lng, body.Night, body.Weather)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, q)
}

// GetDeliveryConfig returns the effective/stored delivery-fee config (admin).
// GET /restaurant/admin/delivery-config?restaurant_id=
func (h *Handler) GetDeliveryConfig(c *gin.Context) {
	var restaurantID *string
	if rid := c.Query("restaurant_id"); rid != "" {
		restaurantID = &rid
	}
	row, err := h.svc.GetDeliveryConfig(c.Request.Context(), restaurantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, row)
}

// PutDeliveryConfig upserts the delivery-fee config (admin).
// PUT /restaurant/admin/delivery-config
//
//	body { restaurant_id?: string|null, ...DeliveryFeeConfig fields, active }
func (h *Handler) PutDeliveryConfig(c *gin.Context) {
	var body struct {
		RestaurantID *string `json:"restaurant_id"`
		Active       *bool   `json:"active"`
		DeliveryFeeConfig
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	if body.RestaurantID != nil && *body.RestaurantID == "" {
		body.RestaurantID = nil
	}
	row, err := h.svc.SetDeliveryConfig(c.Request.Context(), body.RestaurantID, body.DeliveryFeeConfig, active)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, row)
}

func (h *Handler) UpdateStatus(c *gin.Context) {
	actorID := c.GetString("user_id")
	var body struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdateStatus(c.Request.Context(), c.Param("orderId"), actorID, OrderStatus(body.Status)); err != nil {
		c.JSON(statusCodeFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) CancelOrder(c *gin.Context) {
	actorID := c.GetString("user_id")
	if err := h.svc.CancelOrder(c.Request.Context(), c.Param("orderId"), actorID); err != nil {
		c.JSON(statusCodeFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// statusCodeFor maps order-lifecycle errors to HTTP codes: authorization failures →
// 403, everything else → 400 (validation/illegal-transition). Keeps object-level authZ
// denials distinguishable from bad requests.
func statusCodeFor(err error) int {
	if errors.Is(err, ErrForbidden) || errors.Is(err, ErrDeliveredViaHandoff) {
		return http.StatusForbidden
	}
	return http.StatusBadRequest
}
