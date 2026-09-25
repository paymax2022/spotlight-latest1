package paystackcheckout

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/transport"
)

// Handler exposes the checkout-initiate + status-poll routes over Gin.
// Confirmation (OnChargeSuccess) is driven by the shared Paystack webhook
// pipeline in production; Status also self-heals via CheckStatus for
// environments Paystack cannot webhook (localhost).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := c.GetString("user_id")
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

func (h *Handler) fail(c *gin.Context, err error) {
	var ce *transport.CodedError
	if errors.As(err, &ce) {
		c.JSON(ce.Status, gin.H{"error": ce.Message, "code": ce.Code})
		return
	}
	switch {
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": err.Error()})
	case errors.Is(err, ErrUnknownReference):
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown_reference", "message": err.Error()})
	case errors.Is(err, ErrChargeNotSuccessful):
		c.JSON(http.StatusConflict, gin.H{"error": "charge_not_successful", "message": err.Error()})
	case errors.Is(err, ErrAmountMismatch):
		c.JSON(http.StatusConflict, gin.H{"error": "amount_mismatch", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterTransportPaystackCheckout wires the two customer-facing routes onto
// the mobility member group.
//
//	group: POST /rides/paystack/initiate            start a checkout session (Idempotency-Key required)
//	       GET  /rides/paystack/:reference/status    poll + self-heal (see Service.CheckStatus)
//
// >>> INTEGRATION NOTE (confirmation) <<<
// No POST /rides/paystack/webhook route here. Service.OnChargeSuccess MUST be
// invoked from the EXISTING shared Paystack webhook pipeline
// (webhooks.PaystackHandler.handleChargeSuccess) — the integration task routes
// a charge.success whose reference carries ReferencePrefix ("rideorder:") to
// svc.OnChargeSuccess(reference, gatewayRef).
func RegisterTransportPaystackCheckout(group *gin.RouterGroup, svc *Service) *Handler {
	h := NewHandler(svc)
	if group != nil {
		group.POST("/rides/paystack/initiate", h.Initiate)
		group.GET("/rides/paystack/:reference/status", h.Status)
	}
	return h
}

// initiateRequest bundles transport.RequestRideRequest with the gateway
// fields InitiateCheckout needs, bound in ONE pass (the request body can only
// be read once) — mirrors restaurant/paystackcheckout's identical pattern.
type initiateRequest struct {
	transport.RequestRideRequest
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
	// Paystack-funded rides only support instant pricing — mirrors
	// transport.requestRide's own guard, checked again here so a caller gets a
	// clear 400 before ever quoting/charging anything.
	if req.PricingMode == "offer" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": "Paystack-funded rides must use instant pricing, not offer mode"})
		return
	}

	out, err := h.svc.InitiateCheckout(c.Request.Context(), u, req.RequestRideRequest, req.Email, req.CallbackURL)
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
