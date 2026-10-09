package restaurant

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
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
	userID := ginutil.UserID(c)
	var req CreateRestaurantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	r, err := h.svc.CreateRestaurant(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusCreated, r)
}

func (h *Handler) PlaceOrder(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req PlaceOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	// Idempotency-Key is a HEADER by client convention (every money route). Prefer
	// the header; fall back to the body field for any legacy caller. Fail closed.
	if hk := ginutil.IdempotencyKey(c); hk != "" {
		req.IdempotencyKey = hk
	}
	if req.IdempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyIdempotencyKeyIsRequired})
		return
	}
	// Normalize each line so the service sees canonical MenuItemID/Quantity
	// regardless of whether the client sent item_id/qty (mobile) or
	// menu_item_id/quantity (canonical). Validate fail-closed.
	for idx := range req.Items {
		req.Items[idx].MenuItemID = req.Items[idx].MenuItem()
		req.Items[idx].Quantity = req.Items[idx].QtyOf()
		if req.Items[idx].MenuItemID == "" {
			c.JSON(http.StatusBadRequest, gin.H{keyError: "each item requires an item_id"})
			return
		}
		if req.Items[idx].Quantity < 1 {
			c.JSON(http.StatusBadRequest, gin.H{keyError: "each item requires a quantity >= 1"})
			return
		}
	}
	order, err := h.svc.PlaceOrder(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		// An unusable promo code is the CLIENT's input being wrong (unknown code, out
		// of window, under the minimum, at its usage cap, or a discount the funder
		// cannot bear) — not a server fault. 422 so the app can surface "that code
		// doesn't apply" and let the customer retry without it, instead of the generic
		// 500 that made every rejection look like an outage.
		if errors.Is(err, ErrPromoInvalid) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{keyError: httperr.Msg(c, http.StatusUnprocessableEntity, err)})
			return
		}
		// A bad modifier selection is a malformed cart — an option that isn't on this
		// item, a duplicate, or a group's min/max/required rule broken. 400, so the app
		// can point at the offending line instead of showing a server-error page.
		if errors.Is(err, ErrInvalidModifierSelection) {
			c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
			return
		}
		// Tier-gate and wallet-state rejections carry their own statuses (402/403/…).
		if code, ok := escrowErrStatus(err); ok {
			c.JSON(code, gin.H{keyError: httperr.Msg(c, code, err)})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusCreated, order)
}

// escrowErrStatus maps the fail-closed refusals order placement can return —
// the money-path tier/fund gates AND the pricing rejections priceOrder raises
// before any money moves (closed/not-found restaurant, unavailable item,
// under-minimum cart, bad slot, malformed line). Without the second group
// every cart refusal 500'd (prod probe B4): a rejection is never a server
// fault. It reports ok=false for anything else so each caller keeps its own
// default (PlaceOrder → 500, group finalize → statusCodeFor).
// Mirrors withdrawalErrStatus (handler_withdrawal.go) — the two money paths in
// this module must answer the same refusal with the same code.
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
	case errors.Is(err, ErrExternalAmountMismatch):
		// The verified charge no longer matches the recomputed total — the caller
		// must refund the external payment and retry. Conflict, not a fault.
		return http.StatusConflict, true
	case errors.Is(err, ErrRestaurantNotFound), errors.Is(err, ErrMenuItemNotFound):
		return http.StatusNotFound, true
	case errors.Is(err, ErrRestaurantClosed), errors.Is(err, ErrMenuItemUnavailable),
		errors.Is(err, ErrBelowMinOrder):
		// State-dependent refusals: well-formed request the restaurant cannot
		// fulfil right now. 422 lets the client surface the reason.
		return http.StatusUnprocessableEntity, true
	case errors.Is(err, ErrOrderInvalid), errors.Is(err, ErrScheduledSlotInvalid):
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	q, err := h.svc.QuoteDelivery(c.Request.Context(), c.Param("id"), body.Lat, body.Lng, body.Night, body.Weather)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
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
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
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
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, row)
}

func (h *Handler) UpdateStatus(c *gin.Context) {
	actorID := ginutil.UserID(c)
	var body struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.UpdateStatus(c.Request.Context(), c.Param("orderId"), actorID, OrderStatus(body.Status)); err != nil {
		c.JSON(statusCodeFor(err), gin.H{keyError: httperr.Msg(c, statusCodeFor(err), err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) CancelOrder(c *gin.Context) {
	actorID := ginutil.UserID(c)
	if err := h.svc.CancelOrder(c.Request.Context(), c.Param("orderId"), actorID); err != nil {
		c.JSON(statusCodeFor(err), gin.H{keyError: httperr.Msg(c, statusCodeFor(err), err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// statusCodeFor maps order-lifecycle errors to HTTP codes: authorization failures →
// 403, everything else → 400 (validation/illegal-transition). Keeps object-level authZ
// denials distinguishable from bad requests.
func statusCodeFor(err error) int {
	if errors.Is(err, ErrForbidden) || errors.Is(err, ErrDeliveredViaHandoff) || errors.Is(err, ErrPickedUpViaPickupCode) {
		return http.StatusForbidden
	}
	return http.StatusBadRequest
}
