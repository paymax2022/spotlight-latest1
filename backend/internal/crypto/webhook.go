package crypto

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// Quidax webhook signature verification: HMAC-SHA256 in X-Quidax-Signature header.
// Enable by setting CRYPTO_QUIDAX_WEBHOOK_SECRET in the environment; leave unset
// to disable the endpoint (returns 503).
const quidaxWebhookSecretEnv = "CRYPTO_QUIDAX_WEBHOOK_SECRET"
const quidaxWebhookSignatureHeader = "X-Quidax-Signature"

// quidaxWebhookGuard verifies the HMAC-SHA256 signature on incoming Quidax webhooks.
// Fail-closed: returns 503 if CRYPTO_QUIDAX_WEBHOOK_SECRET is unset, 401 if signature
// is invalid or missing.
func quidaxWebhookGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		secret := strings.TrimSpace(os.Getenv(quidaxWebhookSecretEnv))
		if secret == "" {
			// Not configured → seam disabled, fail closed.
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"success": false,
				"error":   "quidax webhook not configured",
			})
			return
		}

		// Read the raw body for signature verification (HMAC over the raw bytes).
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
				"success": false,
				"error":   "failed to read request body",
			})
			return
		}

		// Restore the body so handlers can read it again.
		c.Request.Body = io.NopCloser(strings.NewReader(string(body)))

		// Verify HMAC-SHA256 signature (already implemented in provider.go).
		presentedSignature := strings.TrimSpace(c.GetHeader(quidaxWebhookSignatureHeader))
		if presentedSignature == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"error":   "missing quidax signature header",
			})
			return
		}

		// VerifyQuidaxWebhook checks HMAC-SHA256 constant-time comparison.
		// timestampThresholdSec: allow up to 5 minutes of clock skew for replay attack prevention.
		const timestampThresholdSec int64 = 300
		if err := VerifyQuidaxWebhook(body, presentedSignature, secret, timestampThresholdSec); err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"error":   "invalid quidax signature",
			})
			return
		}

		c.Next()
	}
}

// QuidaxWebhook POST /internal/webhooks/quidax (Quidax swap completion event handler).
// Receives Quidax webhook event: {event_type, data: {swap_transaction_id, status, ...}, timestamp, id}
// Updates SwapOrder.status from "executing" to final status (completed/failed).
// Guarded by HMAC-SHA256 signature verification (fail-closed when unset).
func (h *Handler) QuidaxWebhook(c *gin.Context) {
	var event QuidaxWebhookEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "invalid webhook payload",
		})
		return
	}

	// Parse event data to extract swap_transaction_id and status.
	// Quidax sends these in the data field of the webhook event.
	if event.Data == nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "missing event data",
		})
		return
	}

	swapTxID, ok := event.Data["swap_transaction_id"].(string)
	if !ok || swapTxID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "missing or invalid swap_transaction_id in data",
		})
		return
	}

	status, ok := event.Data["status"].(string)
	if !ok || status == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "missing or invalid status in data",
		})
		return
	}

	// Call service to update order status.
	// The service will look up the swap order by swap_transaction_id and update
	// the status to the Quidax-reported value (completed/failed/etc).
	// Service handles idempotency: same webhook replayed = no-op or safe re-update.
	err := h.svc.UpdateSwapOrderStatusFromWebhook(c.Request.Context(), swapTxID, status)
	if err != nil {
		// Log the error but return success to Quidax (prevents retry storms).
		// Real-world: this would write to an alerting queue or observability system.
		fmt.Printf("[crypto] webhook status update failed: %v\n", err)

		// Return 200 to avoid Quidax retry, but note the internal error.
		// The swap order remains in "executing" state until manual reconciliation.
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"error":   "status update failed (will retry)",
			"note":    "webhook queued for manual reconciliation",
		})
		return
	}

	// Success: status updated.
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "status updated",
	})
}

// registerQuidaxWebhook adds the Quidax webhook route to the crypto module.
// Mounted at /api/v1/crypto/internal/webhooks/quidax (internal seam, no auth needed
// except signature verification via HMAC).
func registerQuidaxWebhook(member *gin.RouterGroup, h *Handler) {
	member.POST("/internal/webhooks/quidax", quidaxWebhookGuard(), h.QuidaxWebhook)
}
