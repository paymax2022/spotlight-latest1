package webhooks

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/finance/transfers"
	"spotlight/backend/internal/finance/va"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/provider"
)

// PaystackEvent is the outer envelope for all Paystack webhook payloads.
type PaystackEvent struct {
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data"`
}

// chargeData covers charge.success events.
type chargeData struct {
	Reference  string `json:"reference"`
	Amount     int64  `json:"amount"` // kobo
	Channel    string `json:"channel"`
	Customer   struct {
		Email string `json:"email"`
	} `json:"customer"`
	Metadata map[string]any `json:"metadata"`
	// For dedicated virtual account credits:
	VirtualAccount *struct {
		AccountNumber string `json:"account_number"`
	} `json:"virtual_account,omitempty"`
}

// transferData covers transfer.success / transfer.failed / transfer.reversed.
type transferData struct {
	Reference    string `json:"reference"`
	TransferCode string `json:"transfer_code"`
	Amount       int64  `json:"amount"`
	Status       string `json:"status"`
	Reason       string `json:"reason"`
}

// FeesChargeConfirmer is the confirm-and-record entry point for EdTech fee
// payments. On a charge.success whose reference carries the fees prefix
// ("feespay:") the webhook routes here instead of the wallet/VA path. The
// concrete impl is *academy/fees/payment.Service.OnChargeSuccess, wired at the
// composition root and injected via SetFeesConfirmer. When nil (fees module off)
// the fees branch is a no-op. This is the ONLY fees webhook seam — no new receiver.
type FeesChargeConfirmer interface {
	OnChargeSuccess(ctx context.Context, reference, gatewayRef string) (any, error)
}

// FeesReferencePrefix is the reference prefix fees payment intents use
// (academy/fees/payment.referenceFor → "feespay:"+idempotencyKey).
const FeesReferencePrefix = "feespay:"

// PaystackHandler dispatches inbound Paystack webhooks to the appropriate
// finance sub-handlers.
type PaystackHandler struct {
	payment      provider.PaymentProvider
	vaSvc        *va.Service
	xferSvc      *transfers.Service
	walletSvc    *wallet.Service
	feesConfirmer FeesChargeConfirmer // optional; nil ⇒ fees module off (no-op)
}

func NewPaystackHandler(payment provider.PaymentProvider, vaSvc *va.Service, xferSvc *transfers.Service, walletSvc *wallet.Service) *PaystackHandler {
	return &PaystackHandler{payment: payment, vaSvc: vaSvc, xferSvc: xferSvc, walletSvc: walletSvc}
}

// SetFeesConfirmer injects the EdTech-fees confirm-and-record service. Called from
// the composition root only when FEATURE_ACADEMY_FEES_ENABLED and the fees payment
// service is assembled. Idempotent + safe to leave unset.
func (h *PaystackHandler) SetFeesConfirmer(c FeesChargeConfirmer) { h.feesConfirmer = c }

// Handle handles POST /api/webhooks/paystack
func (h *PaystackHandler) Handle(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	sig := c.GetHeader("X-Paystack-Signature")
	if !h.payment.VerifyWebhookSignature(body, sig) {
		c.Status(http.StatusUnauthorized)
		return
	}

	var event PaystackEvent
	if err := json.Unmarshal(body, &event); err != nil {
		c.Status(http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var dispatchErr error
	switch event.Event {
	case "charge.success":
		dispatchErr = h.handleChargeSuccess(ctx, event.Data)
	case "transfer.success":
		dispatchErr = h.handleTransferUpdate(ctx, event.Data, "successful")
	case "transfer.failed":
		dispatchErr = h.handleTransferUpdate(ctx, event.Data, "failed")
	case "transfer.reversed":
		dispatchErr = h.handleTransferUpdate(ctx, event.Data, "reversed")
	}
	// Errors are logged but we always return 200 to stop Paystack retrying
	// for deterministic failures (e.g. unknown reference).
	if dispatchErr != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": dispatchErr.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *PaystackHandler) handleChargeSuccess(ctx context.Context, data json.RawMessage) error {
	var d chargeData
	if err := json.Unmarshal(data, &d); err != nil {
		return fmt.Errorf("paystack webhook: unmarshal charge: %w", err)
	}

	// EdTech fees payment — reference carries the "feespay:" prefix. Route to the
	// fees confirm-and-record path (verify → guardian wallet → school settlement
	// ledger move → invoice payment record, all idempotent). No new receiver; this
	// is a minimal branch on the existing charge.success pipeline. When the fees
	// module is off (feesConfirmer nil) this is a benign no-op.
	if strings.HasPrefix(d.Reference, FeesReferencePrefix) {
		if h.feesConfirmer == nil {
			return nil
		}
		_, err := h.feesConfirmer.OnChargeSuccess(ctx, d.Reference, d.Reference)
		return err
	}

	// DVA inbound transfer — credit wallet via VA service.
	if d.VirtualAccount != nil && d.VirtualAccount.AccountNumber != "" {
		return h.vaSvc.CreditInbound(ctx, va.InboundTransfer{
			AccountNumber:  d.VirtualAccount.AccountNumber,
			AmountKobo:     d.Amount,
			Reference:      d.Reference,
			IdempotencyKey: "dva:charge:" + d.Reference,
		})
	}

	// Wallet topup via Paystack checkout — look up user from metadata.
	if userID, ok := d.Metadata["user_id"].(string); ok && userID != "" {
		return h.handleWalletTopup(ctx, userID, d.Reference, d.Amount)
	}
	// Bank→bank funding collection — route to the transfers funding path. The
	// transfers service no-ops if the reference is not a pending bank→bank funding.
	if h.xferSvc != nil {
		return h.xferSvc.HandleProviderWebhook(ctx, &provider.WebhookEvent{
			Type:        "collection",
			ProviderRef: d.Reference,
			Reference:   d.Reference,
			Status:      "successful",
			AmountKobo:  d.Amount,
		})
	}
	return nil
}

func (h *PaystackHandler) handleWalletTopup(ctx context.Context, userID, reference string, amountKobo int64) error {
	if h.walletSvc == nil {
		return nil
	}
	idempotencyKey := "paystack:topup:" + reference
	return h.walletSvc.Credit(ctx, userID, reference, idempotencyKey, amountKobo)
}

func (h *PaystackHandler) handleTransferUpdate(ctx context.Context, data json.RawMessage, newStatus string) error {
	var d transferData
	if err := json.Unmarshal(data, &d); err != nil {
		return fmt.Errorf("paystack webhook: unmarshal transfer: %w", err)
	}
	return h.updateBankTransferStatus(ctx, d.Reference, newStatus, d.Amount)
}

func (h *PaystackHandler) updateBankTransferStatus(ctx context.Context, reference, status string, amountKobo int64) error {
	return h.xferSvc.HandleWebhook(ctx, reference, status, amountKobo)
}
