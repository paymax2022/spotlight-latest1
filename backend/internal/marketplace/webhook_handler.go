package marketplace

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
)

// webhook_handler.go implements the two public (unauthenticated) inbound webhooks.
// Both are HMAC-verified over the RAW request body before any side effect, and both
// are idempotent (delivery_ref / gateway tx id). Signature header: X-Signature.

const webhookSigHeader = "X-Signature"

// readSignedBody reads the raw body and verifies the HMAC signature. Returns the
// raw bytes on success; writes a 401 and returns (nil,false) on failure.
func (h *Handler) readSignedBody(c *gin.Context) ([]byte, bool) {
	raw, err := io.ReadAll(c.Request.Body)
	if err != nil {
		fail(c, fieldErr(CodeValidation, "unreadable body", ""))
		return nil, false
	}
	sig := c.GetHeader(webhookSigHeader)
	if !VerifyHMAC(h.webhookSecret, raw, sig) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": gin.H{
			"code": CodeWebhookBadSignature, "message": "invalid webhook signature", "request_id": requestID(c),
		}})
		return nil, false
	}
	return raw, true
}

// DeliveryConfirmedWebhook POST /webhooks/logistics/delivery-confirmed
func (h *Handler) DeliveryConfirmedWebhook(c *gin.Context) {
	raw, ok := h.readSignedBody(c)
	if !ok {
		return
	}
	var in DeliveryConfirmedInput
	if err := json.Unmarshal(raw, &in); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	o, err := h.svc.HandleDeliveryConfirmed(c.Request.Context(), in)
	if err != nil {
		fail(c, err)
		return
	}
	// Webhooks always return 200 on a processed (or idempotent-replay) event.
	respond(c, http.StatusOK, orderView(o))
}

// FundingConfirmedWebhook POST /webhooks/payments/funding-confirmed
func (h *Handler) FundingConfirmedWebhook(c *gin.Context) {
	raw, ok := h.readSignedBody(c)
	if !ok {
		return
	}
	var in FundingConfirmedInput
	if err := json.Unmarshal(raw, &in); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	o, err := h.svc.HandleFundingConfirmed(c.Request.Context(), in)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, orderView(o))
}
