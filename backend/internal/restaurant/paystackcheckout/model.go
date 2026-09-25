// Package paystackcheckout implements a Paystack-funded (card / bank-transfer)
// checkout path for restaurant food orders that never touches the customer's
// wallet and therefore never runs the KYC-tier daily-wallet-debit gate — the
// money is collected directly by Paystack, verified server-side, and escrowed
// via settlement.EscrowExternal (DR provider-clearing / CR escrow), not via a
// wallet debit.
//
// This is a DELIBERATELY narrow, audited alternative to an earlier, REJECTED
// design (FEATURE_CHECKOUT_TOPUP_TIER0 / ADR-042/043) that tried to let a
// Tier-0 customer top up their wallet with a card and immediately spend it —
// a ledger-auditor review found that design unsafe (see
// docs/audit/checkout-allowance-audit-findings.md) because a topped-up wallet
// balance persists and is spendable outside the checkout that funded it,
// defeating the whole point of the tier gate. This package never credits the
// wallet at all: the money is escrowed directly from an external clearing
// account straight into the specific order it paid for, and the ONLY way
// money comes back to the customer if something goes wrong is a real
// Paystack refund (RefundPayment) — never a wallet credit — precisely so the
// same hazard can't recur through a different door.
//
// Shape mirrors academy/fees/payment (Gateway/IntentStore interfaces, a thin
// intents table, VerifyPayment + exact-amount cross-check before any money
// moves, confirmation driven by the shared Paystack webhook pipeline). The
// two differences that matter:
//   - The "amount to charge" is not a client-supplied number: InitiateCheckout
//     calls restaurant.Service.QuoteOrder to compute it from the SAME pricing
//     logic PlaceOrder itself uses (see restaurant/service.go priceOrder).
//   - On any failure AFTER Paystack has collected the money (amount drifted,
//     the order could no longer be placed), the charge is REVERSED via
//     RefundPayment rather than credited anywhere internal — see OnChargeSuccess.
package paystackcheckout

import (
	"encoding/json"
	"errors"

	"spotlight/backend/internal/restaurant"
)

// intentRecord is the stored pending-intent row (public.restaurant_order_paystack_intents).
// Deliberately minimal plus one field academy's fees intent doesn't need: RequestJSON,
// the FROZEN PlaceOrderRequest, so confirmation can replay the exact cart the customer
// was quoted and charged for without trusting anything the webhook/verify caller supplies.
type intentRecord struct {
	Reference      string
	RestaurantID   string
	CustomerID     string
	RequestJSON    json.RawMessage
	AmountKobo     int64
	IdempotencyKey string
	Status         string
	OrderID        *string
}

// decodeRequest unmarshals the frozen cart back into the exact request type
// restaurant.Service expects.
func (r *intentRecord) decodeRequest() (restaurant.PlaceOrderRequest, error) {
	var req restaurant.PlaceOrderRequest
	err := json.Unmarshal(r.RequestJSON, &req)
	return req, err
}

// CheckoutIntent is the result of InitiateCheckout handed back to the client.
// No money has moved yet — AmountKobo is echoed for the client's own display
// only; it is NEVER trusted back from the client on confirmation.
type CheckoutIntent struct {
	RestaurantID     string `json:"restaurantId"`
	Reference        string `json:"reference"`
	AuthorizationURL string `json:"authorizationUrl"`
	AccessCode       string `json:"accessCode,omitempty"`
	AmountKobo       int64  `json:"amountKobo"`
}

// ConfirmResult is the outcome of OnChargeSuccess / CheckStatus.
type ConfirmResult struct {
	Reference  string  `json:"reference"`
	Status     string  `json:"status"` // pending | processing | confirmed | amount_mismatch | order_failed | refunded
	OrderID    *string `json:"orderId,omitempty"`
	AmountKobo int64   `json:"amountKobo,omitempty"`
}

var (
	ErrUnauthenticated     = errors.New("unauthenticated")
	ErrMissingRestaurant   = errors.New("missing_restaurant")
	ErrEmptyCart           = errors.New("empty_cart")
	ErrIdempotencyRequired = errors.New("idempotency_key_required")
	// ErrChargeNotSuccessful mirrors feespayment: never move money, place an
	// order, or refund for a charge the gateway does not report as successful.
	ErrChargeNotSuccessful = errors.New("charge_not_successful")
	// ErrVerifyUnavailable wraps a failure to REACH Paystack's verify
	// endpoint (network error, timeout, transient 5xx) — distinct from
	// ErrChargeNotSuccessful, which means Paystack was reached and explicitly
	// said the charge did not succeed. CheckStatus treats this the same as
	// "still pending" (keep polling) rather than a hard failure: the WebView
	// SDK's own onSuccess already told the client the card charge went
	// through, so a transient hiccup calling Paystack back MUST NOT surface
	// as a customer-facing "payment unavailable" — found 2026-09-25, a real
	// payment stuck oscillating between "processing" and "unavailable" on
	// every self-heal poll that happened to race a momentary verify failure.
	ErrVerifyUnavailable = errors.New("verify_unavailable")
	// ErrAmountMismatch is returned when the verified Paystack amount does not
	// equal the intent's frozen amount. The charge is refunded before this is
	// returned — see OnChargeSuccess.
	ErrAmountMismatch = errors.New("amount_mismatch")
	// ErrUnknownReference: confirmation/status arrived for a reference this
	// adapter never created an intent for. Benign no-op for callers.
	ErrUnknownReference = errors.New("unknown_reference")
)
