package paystackcheckout

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/estate"
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
	case errors.Is(err, estate.ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": err.Error()})
	case errors.Is(err, estate.ErrDuesExternalAmountMismatch):
		c.JSON(http.StatusConflict, gin.H{"error": "amount_mismatch", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterEstateDuesPaystackCheckout wires the two customer-facing routes
// onto the estate member group.
//
//	group: POST /:id/dues/invoices/:invoiceId/pay/paystack/initiate   start a checkout session (Idempotency-Key required)
//	       GET  /:id/dues/paystack/:reference/status                  poll + self-heal (see Service.CheckStatus)
//
// >>> INTEGRATION NOTE (confirmation) <<<
// No POST .../paystack/webhook route here. Service.OnChargeSuccess MUST be
// invoked from the EXISTING shared Paystack webhook pipeline
// (webhooks.PaystackHandler.handleChargeSuccess) — the integration task
// routes a charge.success whose reference carries ReferencePrefix
// ("duespay:") to svc.OnChargeSuccess(reference, gatewayRef).
func RegisterEstateDuesPaystackCheckout(group *gin.RouterGroup, svc *Service) *Handler {
	h := NewHandler(svc)
	if group != nil {
		group.POST("/:id/dues/invoices/:invoiceId/pay/paystack/initiate", h.Initiate)
		group.GET("/:id/dues/paystack/:reference/status", h.Status)
	}
	return h
}

type initiateRequest struct {
	Email       string `json:"email"`
	CallbackURL string `json:"callback_url"`
}

func (h *Handler) Initiate(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req initiateRequest
	_ = c.ShouldBindJSON(&req) // both fields optional
	idempotencyKey := c.GetHeader("Idempotency-Key")
	if idempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": "Idempotency-Key is required"})
		return
	}

	out, err := h.svc.InitiateCheckout(c.Request.Context(), c.Param("id"), u, c.Param("invoiceId"), idempotencyKey, req.Email, req.CallbackURL)
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
