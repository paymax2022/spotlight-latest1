package feesinvoice

import (
	"errors"
	"time"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// Package feesinvoice owns the Invoice entity of the EdTech School-Fees module (build-spec
// §2 Invoice, §3.1 Invoice state machine, §4 SF-2). Built against public.academy_invoices
// and public.academy_invoice_payments (migration 20260918000000_academy_fees_edtech.sql).
//
// SF-2 (CRITICAL, release blocker): an Invoice's balance and amount_paid are DERIVED, never
// stored/mutated. There is deliberately NO Balance/AmountPaid COLUMN on academy_invoices
// and NO `UPDATE academy_invoices SET balance/amount_paid` anywhere in this package. Balance
// is computed as: total_amount_minor − SUM(academy_invoice_payments WHERE status='succeeded').
// The Balance/AmountPaidMinor fields on the Invoice struct below are COMPUTED at read time
// by the service from the payment rows; they are never persisted as source of truth.
//
// State changes go through feesstatemachine.InvoiceTransition ONLY — never a raw status
// write. Payments are APPEND-ONLY to academy_invoice_payments, idempotent on idempotency_key.
//
// The actual money move (ledger debit of guardian → school) is E3's payment-adapter concern
// (see report / the E3 hook comment in service.go). This package records the thin payment
// row and derives status; it never posts a ledger entry itself.

// Invoice mirrors public.academy_invoices. NOTE the absence of a balance/amount_paid column
// in the table — Balance + AmountPaidMinor here are DERIVED values populated by the service.
type Invoice struct {
	ID               string                        `json:"id"`
	StudentID        string                        `json:"studentId"`
	FeeScheduleID    string                        `json:"feeScheduleId"`
	TotalAmountMinor int64                         `json:"totalAmountMinor"`
	DueDate          *time.Time                    `json:"dueDate,omitempty"`
	Status           feesstatemachine.InvoiceState `json:"status"`
	IssuedAt         *time.Time                    `json:"issuedAt,omitempty"`
	CreatedAt        time.Time                     `json:"createdAt"`

	// ── DERIVED (SF-2) — computed from succeeded payment rows, never persisted ──
	AmountPaidMinor int64 `json:"amountPaidMinor"` // SUM(succeeded payments)
	Balance         int64 `json:"balance"`         // total_amount_minor − amountPaidMinor
}

// PaymentStatus mirrors academy_invoice_payments.status CHECK.
type PaymentStatus string

const (
	PaymentPending   PaymentStatus = "pending"
	PaymentSucceeded PaymentStatus = "succeeded"
	PaymentFailed    PaymentStatus = "failed"
	PaymentReversed  PaymentStatus = "reversed"
)

// Payment mirrors public.academy_invoice_payments — an APPEND-ONLY thin record referencing
// the real finance/ledger transaction (LedgerReference). Only succeeded rows count toward
// the derived balance.
type Payment struct {
	ID              string        `json:"id"`
	InvoiceID       string        `json:"invoiceId"`
	GuardianUserID  string        `json:"guardianUserId"`
	AmountMinor     int64         `json:"amountMinor"`
	GatewayRef      *string       `json:"gatewayRef,omitempty"`
	LedgerReference *string       `json:"ledgerReference,omitempty"`
	Status          PaymentStatus `json:"status"`
	IdempotencyKey  string        `json:"idempotencyKey"`
	CreatedAt       time.Time     `json:"createdAt"`
}

// RecordPaymentResult bundles the (possibly replayed) payment row with the invoice as it
// stands AFTER the payment — with the freshly-derived balance + state.
type RecordPaymentResult struct {
	Payment *Payment `json:"payment"`
	Invoice *Invoice `json:"invoice"`
	// Replayed is true when the idempotency key matched an existing row (no new insert,
	// no state change re-applied) — the money-path idempotency signal.
	Replayed bool `json:"replayed"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// IssueInvoiceRequest issues an invoice for a student against an immutable fee schedule.
// total_amount_minor may be supplied explicitly; when 0 the service derives it from the fee
// schedule amount (single source of truth for the price).
type IssueInvoiceRequest struct {
	StudentID        string `json:"studentId" binding:"required"`
	FeeScheduleID    string `json:"feeScheduleId" binding:"required"`
	TotalAmountMinor int64  `json:"totalAmountMinor"`
	DueDate          string `json:"dueDate"` // YYYY-MM-DD
}

// RecordPaymentRequest APPENDS a payment against an invoice. Idempotency-Key is required
// (money path). amount_minor must be > 0. gateway_ref / ledger_reference are set by the
// caller/E3 adapter once the real money move has (or will) settle.
type RecordPaymentRequest struct {
	AmountMinor     int64  `json:"amountMinor" binding:"required"`
	GatewayRef      string `json:"gatewayRef"`
	LedgerReference string `json:"ledgerReference"`
}

// ── Sentinel errors ─────────────────────────────────────────────────────────────

var (
	ErrNotFound            = errors.New("not_found")
	ErrUnauthenticated     = errors.New("unauthenticated")
	ErrInvalidAmount       = errors.New("invalid_amount")
	ErrInvalidDate         = errors.New("invalid_date")
	ErrMissingStudent      = errors.New("missing_student")
	ErrMissingFeeSchedule  = errors.New("missing_fee_schedule")
	ErrIdempotencyRequired = errors.New("idempotency_key_required")
	ErrOverpayment         = errors.New("overpayment")
	ErrInvoiceNotPayable   = errors.New("invoice_not_payable")
	ErrIllegalTransition   = errors.New("illegal_transition")
	// ErrAlreadyIssued guards double-issue of the same invoice.
	ErrAlreadyIssued = errors.New("already_issued")
)
