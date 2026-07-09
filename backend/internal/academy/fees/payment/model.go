// Package feespayment is the EdTech School-Fees PAYMENT ADAPTER (build-spec §4 SF-2 / SF-6 /
// SF-8). It is a THIN adapter over the EXISTING Paymax rails — it introduces NO new provider
// integration. It only:
//
//   - CreatePaymentIntent: asks the existing provider.PaymentProvider to InitializePayment and
//     hands the returned authorization URL + reference back to the caller (the parent app).
//     It persists nothing that duplicates the ledger — the money is captured later, on
//     confirmation, so an intent is a pure gateway session request (idempotent on the
//     Idempotency-Key so a retried intent returns the same reference).
//
//   - OnChargeSuccess: the confirmation path. It VERIFIES the charge via provider.VerifyPayment,
//     posts the REAL money move through the injected ledger interface (guardian wallet → school
//     settlement account), and RECORDS the invoice-side payment via the injected invoice
//     recorder using the SAME idempotency key, so the money leg and the invoice record replay
//     together (SF-2 discipline: the invoice balance is DERIVED from its payment events — this
//     package NEVER mutates a balance). End-to-end idempotent.
//
//   - PayInstallment (SF-6): a partial payment against an invoice whose immutable fee schedule
//     carries an installment_policy. The terms are locked/disclosed at issuance (SF-1 already
//     makes the schedule immutable). Here we accept a partial amount and drive the same
//     confirm-and-record flow; the invoice derives partially_paid from the DERIVED balance.
//     A DisclosureRequired flag is surfaced to the UI before the first installment.
//
// Iron rules honoured: money is int64 minor units (kobo); every money mutation requires an
// Idempotency-Key, posts a balanced double-entry ledger move, and never writes a balance
// column. This package imports NO vendor SDK — only the provider.PaymentProvider interface and
// small locally-declared ledger/invoice interfaces, wired at the composition root.
package feespayment

import "errors"

// PaymentIntent is the result of CreatePaymentIntent handed back to the parent app. It carries
// only the gateway session handles (authorization URL / reference) — no money has moved yet, so
// nothing here duplicates the ledger. Amount is echoed back for the caller's convenience.
type PaymentIntent struct {
	InvoiceID        string `json:"invoiceId"`
	GuardianUserID   string `json:"guardianUserId"`
	Reference        string `json:"reference"`        // our reference; echoed back on webhook/verify
	AuthorizationURL string `json:"authorizationUrl"` // gateway checkout URL for the parent app
	AccessCode       string `json:"accessCode,omitempty"`
	AmountMinor      int64  `json:"amountMinor"`

	// DisclosureRequired (SF-6) is true when this intent is the FIRST installment against an
	// invoice with an installment_policy and the guardian has not yet acknowledged the locked
	// installment terms. The UI MUST show the disclosure before proceeding. It is advisory —
	// the money never front-runs the disclosure because the first capture only reconciles on
	// confirmation, and the caller gates the checkout on this flag.
	DisclosureRequired bool `json:"disclosureRequired"`

	// IsInstallment marks an intent as a partial (installment) payment (SF-6) vs a full-invoice
	// payment. Purely informational for the caller/UI.
	IsInstallment bool `json:"isInstallment"`
}

// ConfirmResult is the outcome of OnChargeSuccess: the reconciled ledger reference plus the
// invoice-side record. Replayed is true when the SAME idempotency key had already settled this
// charge (no second ledger move, no second invoice payment) — the end-to-end idempotency signal.
type ConfirmResult struct {
	InvoiceID       string `json:"invoiceId"`
	GuardianUserID  string `json:"guardianUserId"`
	Reference       string `json:"reference"`
	GatewayRef      string `json:"gatewayRef"`
	LedgerReference string `json:"ledgerReference"`
	AmountMinor     int64  `json:"amountMinor"`
	Replayed        bool   `json:"replayed"`
	// InvoiceStatus is the invoice's DERIVED status after the payment is recorded (e.g.
	// partially_paid / paid), surfaced straight from the invoice recorder.
	InvoiceStatus string `json:"invoiceStatus"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// CreatePaymentIntentRequest starts a checkout session for a full-invoice payment. amountMinor,
// when 0, means "the invoice's current derived balance" (resolved by the caller/handler before
// invoking the service). Email is the gateway customer email. Idempotency-Key comes from the
// header (money path).
type CreatePaymentIntentRequest struct {
	InvoiceID   string `json:"invoiceId" binding:"required"`
	AmountMinor int64  `json:"amountMinor"`
	Email       string `json:"email"`
	CallbackURL string `json:"callbackUrl"`
}

// PayInstallmentRequest starts a checkout session for a PARTIAL (installment) payment against an
// invoice whose immutable fee schedule carries an installment_policy (SF-6). amountMinor is the
// partial amount the guardian chooses to pay now (must be > 0 and ≤ the derived balance — the
// caller/invoice enforces the ceiling). Acknowledged reflects that the guardian has seen the
// locked installment disclosure (clears DisclosureRequired on the returned intent).
type PayInstallmentRequest struct {
	InvoiceID    string `json:"invoiceId" binding:"required"`
	AmountMinor  int64  `json:"amountMinor" binding:"required"`
	Email        string `json:"email"`
	CallbackURL  string `json:"callbackUrl"`
	Acknowledged bool   `json:"acknowledged"`
}

// ── Sentinel errors ─────────────────────────────────────────────────────────────

var (
	ErrNotFound            = errors.New("not_found")
	ErrUnauthenticated     = errors.New("unauthenticated")
	ErrInvalidAmount       = errors.New("invalid_amount")
	ErrMissingInvoice      = errors.New("missing_invoice")
	ErrIdempotencyRequired = errors.New("idempotency_key_required")
	// ErrChargeNotSuccessful is returned when provider.VerifyPayment reports the charge is not
	// in a success state — we NEVER post a ledger move or record a payment for an unverified
	// charge (fail-closed).
	ErrChargeNotSuccessful = errors.New("charge_not_successful")
	// ErrAmountMismatch guards the confirmation path: the verified gateway amount must equal the
	// amount we are about to move + record. A mismatch aborts before any money moves.
	ErrAmountMismatch = errors.New("amount_mismatch")
	// ErrUnknownReference is returned when a confirmation arrives for a reference this adapter
	// has no pending-intent record of. Confirmation callers treat it as a benign no-op.
	ErrUnknownReference = errors.New("unknown_reference")
	// ErrDisclosureRequired guards PayInstallment: the first installment on a policy-bearing
	// invoice cannot proceed until the guardian acknowledges the locked terms (SF-6).
	ErrDisclosureRequired = errors.New("disclosure_required")
)
