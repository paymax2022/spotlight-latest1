package webhooks

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/finance/transfers"
	"spotlight/backend/internal/provider"
)

// MonnifyHandler dispatches inbound Monnify webhooks (disbursement + collection)
// to the transfers settlement path. Signature is verified against the configured
// Monnify provider before any state change (unauthenticated route, signed body).
type MonnifyHandler struct {
	prov    provider.DisbursementProvider
	xferSvc *transfers.Service
}

// NewMonnifyHandler builds the Monnify webhook handler. prov must be the
// registered Monnify disbursement provider (for signature verify + parse).
func NewMonnifyHandler(prov provider.DisbursementProvider, xferSvc *transfers.Service) *MonnifyHandler {
	return &MonnifyHandler{prov: prov, xferSvc: xferSvc}
}

// Handle handles POST /api/webhooks/monnify/go
func (h *MonnifyHandler) Handle(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	sig := c.GetHeader("monnify-signature")
	if !h.prov.VerifyWebhookSignature(body, sig) {
		c.Status(http.StatusUnauthorized)
		return
	}
	ev, err := h.prov.ParseWebhook(body)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	if err := h.xferSvc.HandleProviderWebhook(ctx, ev); err != nil {
		// Always 200 for deterministic failures so Monnify stops retrying.
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
