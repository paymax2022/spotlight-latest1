// Package paystackcheckout implements a Paystack-funded (card / bank-transfer)
// payment path for estate dues invoices that never touches the payer's
// wallet and therefore never runs the KYC-tier daily-wallet-debit gate — the
// money is collected directly by Paystack, verified server-side, and posted
// DR provider-clearing / CR settlement (no wallet leg), not via a wallet
// debit.
//
// Structurally the simplest of the three Paystack-checkout ports (see
// restaurant/paystackcheckout for the fully-commented reference this
// mirrors, and transport/paystackcheckout for the second port): a dues
// invoice's amount is fixed and known up front (no cart/route pricing to
// freeze, no negotiation, no escrow/hold-release lifecycle — dues settle
// immediately into the estate's collection account, same as the
// wallet-funded path always has), so there is no frozen request blob and no
// ExternalRefunder retrofit (estate's existing dues payment has no
// cancel/refund path at all to retrofit — see estate.payDues' doc comment).
package paystackcheckout

import (
	"errors"
)

// intentRecord is the stored pending-intent row
// (public.estate_dues_paystack_intents).
type intentRecord struct {
	Reference      string
	EstateID       string
	InvoiceID      string
	PayerID        string
	AmountKobo     int64
	IdempotencyKey string
	Status         string
	PaymentID      *string
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
	PaymentID  *string `json:"paymentId,omitempty"`
	AmountKobo int64   `json:"amountKobo,omitempty"`
}

var (
	ErrUnauthenticated     = errors.New("unauthenticated")
	ErrIdempotencyRequired = errors.New("idempotency_key_required")
	ErrChargeNotSuccessful = errors.New("charge_not_successful")
	ErrAmountMismatch      = errors.New("amount_mismatch")
	ErrUnknownReference    = errors.New("unknown_reference")
)
