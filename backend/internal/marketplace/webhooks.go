package marketplace

import (
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// webhooks.go handles the two inbound HMAC-signed, idempotent webhooks (§3.3):
//   - logistics delivery-confirmed  (idempotent on delivery_ref)
//   - payments funding-confirmed    (idempotent on ledger_fund_ref / gateway tx id)
//
// HMAC-SHA512 verification mirrors the house Paystack convention (CLAUDE.md).

// VerifyHMAC constant-time-compares an HMAC-SHA512 hex signature over the raw body.
func VerifyHMAC(secret string, body []byte, signatureHex string) bool {
	if secret == "" || signatureHex == "" {
		return false
	}
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signatureHex))
}

// DeliveryConfirmedInput is the logistics webhook payload.
type DeliveryConfirmedInput struct {
	DeliveryRef string `json:"delivery_ref"`
	OrderID     string `json:"order_id"`
	PODPhotoURL string `json:"pod_photo_url"`
	OTP         string `json:"otp"`
}

// HandleDeliveryConfirmed processes a HMAC-verified delivery webhook. It is
// idempotent on delivery_ref: a replay is a no-op returning the existing order. On
// first receipt it moves the order to delivered then immediately inspection_window
// (§2.2 deliver), stamping delivered_at + inspection_deadline = now+48h.
//
// The caller (webhook_handler) verifies the HMAC BEFORE calling this.
func (s *Service) HandleDeliveryConfirmed(ctx context.Context, in DeliveryConfirmedInput) (*Order, error) {
	if in.OrderID == "" && in.DeliveryRef == "" {
		return nil, newErr(400, CodeValidation, "order_id or delivery_ref required")
	}

	// Idempotency: if an order already carries this delivery_ref in a delivered/
	// inspection state, this is a replay — no-op.
	if in.DeliveryRef != "" {
		if prior, err := s.repo.GetOrderByDeliveryRef(ctx, in.DeliveryRef); err == nil && prior != nil {
			if prior.Status == OrderDelivered || prior.Status == OrderInspectionWindow ||
				orderIsTerminal(prior.Status) {
				return prior, nil // already processed
			}
		}
	}

	var o *Order
	var err error
	if in.OrderID != "" {
		o, err = s.repo.GetOrder(ctx, in.OrderID)
	} else {
		o, err = s.repo.GetOrderByDeliveryRef(ctx, in.DeliveryRef)
	}
	if err != nil {
		return nil, err
	}

	// The order must be dispatched/accepted to be deliverable. Accept both
	// seller_accepted (POD before an explicit dispatch webhook) and in_delivery.
	switch o.Status {
	case OrderInDelivery, OrderSellerAccepted:
		// ok
	case OrderDelivered, OrderInspectionWindow:
		return o, nil // idempotent replay
	default:
		return nil, newErr(422, CodeInvalidOrderTransition, "order is not awaiting delivery")
	}

	deadline := time.Now().Add(InspectionWindow)
	patch := OrderPatch{
		DeliveryRef:        strPtr(in.DeliveryRef),
		PODPhotoURL:        strPtr(in.PODPhotoURL),
		InspectionDeadline: &deadline,
	}
	// If we're at seller_accepted, first advance through in_delivery for FSM legality.
	if o.Status == OrderSellerAccepted {
		if err := s.repo.SetOrderStatus(ctx, o.ID, OrderSellerAccepted, OrderInDelivery, OrderPatch{DeliveryRef: strPtr(in.DeliveryRef)}); err != nil {
			return nil, err
		}
		o.Status = OrderInDelivery
	}
	// in_delivery → delivered
	if err := s.repo.SetOrderStatus(ctx, o.ID, OrderInDelivery, OrderDelivered, patch); err != nil {
		return nil, err
	}
	// delivered → inspection_window (immediate, §2.2)
	if err := s.repo.SetOrderStatus(ctx, o.ID, OrderDelivered, OrderInspectionWindow, OrderPatch{}); err != nil {
		return nil, err
	}
	o.Status = OrderInspectionWindow
	o.InspectionDeadline = &deadline
	s.notifySafe(ctx, o.BuyerID, "mkt.order.delivered", "Inspect your item — 48h to confirm or dispute.")
	return o, nil
}

// FundingConfirmedInput is the payments webhook payload (card/bank_transfer funding
// confirmed out-of-band; wallet funding is synchronous via FundOrder).
type FundingConfirmedInput struct {
	OrderID     string `json:"order_id"`
	GatewayTxID string `json:"gateway_tx_id"` // idempotency natural key
	AmountKobo  int64  `json:"amount_kobo"`
}

// HandleFundingConfirmed processes a HMAC-verified funding webhook for card/bank
// transfer methods (§8: the webhook is the ONLY source of truth for the funded
// transition on non-wallet methods). Idempotent on the gateway tx id (stored as
// ledger_fund_ref). The caller verifies HMAC first.
func (s *Service) HandleFundingConfirmed(ctx context.Context, in FundingConfirmedInput) (*Order, error) {
	if in.OrderID == "" {
		return nil, newErr(400, CodeValidation, "order_id required")
	}
	o, err := s.repo.GetOrder(ctx, in.OrderID)
	if err != nil {
		return nil, err
	}
	if o.Status == OrderFunded || escrowHoldsFunds(o.Status) || orderIsTerminal(o.Status) {
		return o, nil // idempotent: already funded/past funding
	}
	if o.Status != OrderInitiated {
		return nil, newErr(422, CodeOrderNotInitiated, "order is not awaiting funding")
	}

	// The gateway has collected the money into the platform's clearing; move it into
	// escrow via a balanced journal (provider_clearing → escrow). Idempotent on the
	// gateway tx id.
	escrow, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, wrapInternal("escrow account", err)
	}
	clearing, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return nil, wrapInternal("clearing account", err)
	}
	fundRef := "mkt:funding:" + in.GatewayTxID
	total := o.TotalPayableKobo()
	// provider_clearing → escrow, idempotent on the gateway tx id.
	if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference: fundRef, IdempotencyKey: fundRef, AmountKobo: total,
		DebitAccountID: clearing.ID, CreditAccountID: escrow.ID,
	}); err != nil && err != ledger.ErrDuplicate {
		return nil, wrapInternal("funding journal", err)
	}
	if err := s.repo.SetOrderStatus(ctx, o.ID, OrderInitiated, OrderFunded, OrderPatch{LedgerFundRef: &fundRef}); err != nil {
		return nil, err
	}
	o.Status = OrderFunded
	o.LedgerFundRef = &fundRef
	s.notifySafe(ctx, o.SellerID, "mkt.order.funded", "An order has been funded — accept within 24h.")
	return o, nil
}
