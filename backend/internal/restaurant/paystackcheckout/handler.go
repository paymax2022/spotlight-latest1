package paystackcheckout

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/restaurant"
)

// Handler exposes the checkout-initiate + status-poll routes over Gin. The
// confirmation path (OnChargeSuccess) is NOT reached through either of these
// routes in production — it is driven by the shared Paystack webhook
// pipeline (see RegisterRestaurantPaystackCheckout's integration note).
// CheckStatus calls it too, but only as a self-heal read for environments
// Paystack cannot webhook (localhost) — see CheckStatus's doc comment.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrMissingRestaurant):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_restaurant", "message": err.Error()})
	case errors.Is(err, ErrEmptyCart):
		c.JSON(http.StatusBadRequest, gin.H{"error": "empty_cart", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": err.Error()})
	case errors.Is(err, ErrUnknownReference):
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown_reference", "message": err.Error()})
	case errors.Is(err, ErrChargeNotSuccessful):
		c.JSON(http.StatusConflict, gin.H{"error": "charge_not_successful", "message": err.Error()})
	case errors.Is(err, ErrAmountMismatch):
		c.JSON(http.StatusConflict, gin.H{"error": "amount_mismatch", "message": err.Error()})
	case errors.Is(err, restaurant.ErrPromoInvalid):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "promo_invalid", "message": err.Error()})
	case errors.Is(err, restaurant.ErrInvalidModifierSelection):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_modifier_selection", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterRestaurantPaystackCheckout wires the two customer-facing routes
// onto the restaurant member group. The gateway / order-placer / intent-store
// collaborators are injected at the composition root so this package imports
// no vendor SDK.
//
//	restGroup: POST /:id/orders/paystack/initiate   start a checkout session (Idempotency-Key required)
//	           GET  /orders/paystack/:reference/status  poll + self-heal (see Service.CheckStatus)
//
// >>> INTEGRATION NOTE (confirmation) <<<
// There is no POST /orders/paystack/webhook route here. Service.OnChargeSuccess
// MUST be invoked from the EXISTING shared Paystack webhook pipeline
// (webhooks.PaystackHandler.handleChargeSuccess), not a new receiver — the
// integration task routes a charge.success whose reference carries the
// ReferencePrefix ("foodorder:") to svc.OnChargeSuccess(reference, gatewayRef).
// Signature verification is already done by that pipeline.
func RegisterRestaurantPaystackCheckout(restGroup *gin.RouterGroup, svc *Service) *Handler {
	h := NewHandler(svc)
	if restGroup != nil {
		restGroup.POST("/:id/orders/paystack/initiate", h.Initiate)
		restGroup.GET("/orders/paystack/:reference/status", h.Status)
	}
	return h
}

// initiateRequest bundles restaurant.PlaceOrderRequest with the gateway
// fields InitiateCheckout needs. Item-field normalization (item_id/qty vs
// menu_item_id/quantity) mirrors restaurant.Handler.PlaceOrder exactly, so
// the SAME cart shape reaches priceOrder either way it was paid for.
type initiateRequest struct {
	restaurant.PlaceOrderRequest
	Email       string `json:"email"`
	CallbackURL string `json:"callback_url"`
}

func (h *Handler) Initiate(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req initiateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	if hk := c.GetHeader("Idempotency-Key"); hk != "" {
		req.IdempotencyKey = hk
	}
	if req.IdempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": "Idempotency-Key is required"})
		return
	}
	for idx := range req.Items {
		req.Items[idx].MenuItemID = req.Items[idx].MenuItem()
		req.Items[idx].Quantity = req.Items[idx].QtyOf()
		if req.Items[idx].MenuItemID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": "each item requires an item_id"})
			return
		}
		if req.Items[idx].Quantity < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": "each item requires a quantity >= 1"})
			return
		}
	}

	out, err := h.svc.InitiateCheckout(c.Request.Context(), c.Param("id"), u, req.PlaceOrderRequest, req.Email, req.CallbackURL)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) Status(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	reference := c.Param("reference")
	// Ownership check: a reference is a bare Paystack transaction reference,
	// not a per-caller secret, so without this any authenticated user could
	// poll ANY other customer's checkout status/amount by reference.
	owner, err := h.svc.OwnerCustomerID(c.Request.Context(), reference)
	if err != nil {
		h.fail(c, err)
		return
	}
	if owner != u {
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown_reference"})
		return
	}
	out, err := h.svc.CheckStatus(c.Request.Context(), reference)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
