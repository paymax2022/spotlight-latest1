// Package paystackcheckout implements a Paystack-funded (card / bank-transfer)
// checkout path for ride-hailing that never touches the rider's wallet and
// therefore never runs the KYC-tier daily-wallet-debit gate — the money is
// collected directly by Paystack, verified server-side, and escrowed via
// settlement.EscrowExternal (DR provider-clearing / CR escrow), not via a
// wallet debit.
//
// Structurally identical to restaurant/paystackcheckout (same rejected-and-
// redesigned history applies — see that package's doc comment for the full
// account of why a wallet-credit-based "funding" approach was rejected).
// Ported here for ride-hailing rather than food delivery because transport
// shares the exact same settlement.Escrow/EscrowExternal shape restaurant
// does. Two differences worth knowing:
//   - Only INSTANT pricing is supported (no offer-mode negotiation) — a ride's
//     fare must be fixed before Paystack collects it, and offer-mode fares can
//     change AFTER booking (RiderOffer/AcceptCounter), which has no external-
//     funding counterpart. See transport.RequestRidePaystackFunded.
//   - Refunding an externally-funded ride (cancellation, a stranded booking)
//     goes through transport.ExternalRefunder → settlement.RefundExternal +
//     this package's own gateway refund — never settlement.Refund, which
//     would wallet-credit the rider. See refundExternalAdapter.
package paystackcheckout

import (
	"encoding/json"
	"errors"

	"spotlight/backend/internal/transport"
)

// intentRecord is the stored pending-intent row (public.transport_ride_paystack_intents).
type intentRecord struct {
	Reference      string
	RiderID        string
	RequestJSON    json.RawMessage
	AmountKobo     int64
	IdempotencyKey string
	Status         string
	TripID         *string
}

func (r *intentRecord) decodeRequest() (transport.RequestRideRequest, error) {
	var req transport.RequestRideRequest
	err := json.Unmarshal(r.RequestJSON, &req)
	return req, err
}

// CheckoutIntent is the result of InitiateCheckout handed back to the client.
type CheckoutIntent struct {
	Reference        string `json:"reference"`
	AuthorizationURL string `json:"authorizationUrl"`
	AccessCode       string `json:"accessCode,omitempty"`
	AmountKobo       int64  `json:"amountKobo"`
}

// ConfirmResult is the outcome of OnChargeSuccess / CheckStatus.
type ConfirmResult struct {
	Reference  string  `json:"reference"`
	Status     string  `json:"status"` // pending | processing | confirmed | amount_mismatch | order_failed | refunded
	TripID     *string `json:"tripId,omitempty"`
	AmountKobo int64   `json:"amountKobo,omitempty"`
}

var (
	ErrUnauthenticated     = errors.New("unauthenticated")
	ErrIdempotencyRequired = errors.New("idempotency_key_required")
	ErrChargeNotSuccessful = errors.New("charge_not_successful")
	ErrAmountMismatch      = errors.New("amount_mismatch")
	ErrUnknownReference    = errors.New("unknown_reference")
)
