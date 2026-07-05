package webhooks

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	mapleraddomain "spotlight/backend/internal/finance/maplerad"
	"spotlight/backend/internal/provider"
)

// MapleradHandler is the single hardened Maplerad webhook endpoint (ADR-012
// settlement backbone). Pipeline: read raw body → verify signature → parse →
// dedupe + dispatch (in the domain service) → ACK fast. Deterministic failures
// always return 200 so Maplerad stops retrying; the dedupe insert makes every
// redelivery a no-op and the ledger effect is idempotent.
type MapleradHandler struct {
	verifier provider.DisbursementProvider // signature verify + parse (the maplerad.Client)
	svc      *mapleraddomain.Service
}

// NewMapleradHandler builds the Maplerad webhook handler. verifier MUST be the
// Maplerad gateway client (it owns VerifyWebhookSignature + ParseWebhook).
func NewMapleradHandler(verifier provider.DisbursementProvider, svc *mapleraddomain.Service) *MapleradHandler {
	return &MapleradHandler{verifier: verifier, svc: svc}
}

// Handle handles POST /api/webhooks/maplerad/go (unauthenticated; body-signed).
func (h *MapleradHandler) Handle(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	// Maplerad signs the raw body; the signature rides in this header.
	sig := c.GetHeader("maplerad-signature")
	if sig == "" {
		sig = c.GetHeader("x-maplerad-signature")
	}
	if !h.verifier.VerifyWebhookSignature(body, sig) {
		c.Status(http.StatusUnauthorized)
		return
	}
	ev, err := h.verifier.ParseWebhook(body)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}

	// ACK fast: dedupe + dispatch is light (dedupe insert is one row; the ledger
	// effect is idempotent). Bound the work so a slow DB never holds the provider
	// connection past its window.
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	if err := h.svc.HandleWebhookEvent(ctx, ev); err != nil {
		// Deterministic processing failure → still 200 so Maplerad stops retrying;
		// the event is recorded in webhook_event with status=failed for follow-up.
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
