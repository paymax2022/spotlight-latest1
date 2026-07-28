package feespayment

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
)

// Handler exposes the fees PAYMENT-INTENT routes over Gin. It exposes ONLY the intent-creation
// endpoints (checkout session start); the confirmation path (OnChargeSuccess) is NOT an HTTP
// route here — it is driven by the EXISTING academy webhook pipeline (see the integration note
// in RegisterFeesPayment). Router registration into RegisterAcademy is owned by the integration
// task, behind FEATURE_ACADEMY_FEES_ENABLED.
//
// The member group already carries RequireAuthContext (REUSE-MAP §1), so c.GetString("user_id")
// is populated. The Idempotency-Key header is REQUIRED on every intent route (money path).
type Handler struct {
	svc *Service
}

// NewHandler builds the payment handler.
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

func idemKey(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrUnknownReference):
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown_reference", "message": err.Error()})
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrMissingInvoice):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_invoice", "message": err.Error()})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_key_required", "message": err.Error()})
	case errors.Is(err, ErrDisclosureRequired):
		c.JSON(http.StatusConflict, gin.H{"error": "disclosure_required", "message": err.Error()})
	case errors.Is(err, ErrChargeNotSuccessful):
		c.JSON(http.StatusConflict, gin.H{"error": "charge_not_successful", "message": err.Error()})
	case errors.Is(err, ErrAmountMismatch):
		c.JSON(http.StatusConflict, gin.H{"error": "amount_mismatch", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterFeesPayment wires the payment-intent routes onto the member group. It is called from
// fees.RegisterAcademyFees by the integration task (behind FEATURE_ACADEMY_FEES_ENABLED). The
// gateway / ledger / invoice / intent-store collaborators are injected at the root so this
// package imports NO vendor SDK, ledger, or invoice package concretely.
//
//	member: POST /payments/intent        create a full-invoice payment intent (Idempotency-Key required)
//	        POST /payments/installment    create an installment (partial) payment intent (Idempotency-Key required) — SF-6
//
// >>> INTEGRATION NOTE (confirmation) <<<
// There is NO POST /payments/webhook route here. The confirmation path Service.OnChargeSuccess
// MUST be invoked from the EXISTING academy webhook pipeline
// (backend/internal/app/academy_webhooks.go / the shared webhooks.PaystackHandler
// handleChargeSuccess), NOT a new receiver. The integration task routes a fees charge.success
// (references prefixed "feespay:") to svc.OnChargeSuccess(reference, gatewayRef). Signature
// verification + dedupe are already done by that pipeline.
func RegisterFeesPayment(member *gin.RouterGroup, svc *Service) *Handler {
	h := NewHandler(svc)
	if member != nil {
		g := member.Group("/payments")
		g.POST("/intent", h.CreateIntent)
		g.POST("/installment", h.PayInstallment)
	}
	return h
}

// ── Handlers ────────────────────────────────────────────────────────────────────

func (h *Handler) CreateIntent(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req CreatePaymentIntentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreatePaymentIntent(c.Request.Context(), u, req, idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) PayInstallment(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req PayInstallmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.PayInstallment(c.Request.Context(), u, req, idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	// When the disclosure gate fired, no gateway session was started; surface it as a 200 with
	// disclosureRequired=true so the UI can render the disclosure and re-submit with Acknowledged.
	if out.DisclosureRequired {
		c.JSON(http.StatusOK, gin.H{"data": out})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}
