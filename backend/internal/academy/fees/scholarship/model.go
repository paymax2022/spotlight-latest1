package feesscholarship

import (
	"errors"
	"time"
)

// Package feesscholarship implements ScholarshipPledge / Sponsor-a-Student (build-spec E9 /
// T9.2). It is a brownfield EXTENSION of the existing academy/edupay scholarship domain
// (academy_scholarships / academy_scholarship_awards — REUSE-MAP.md is source of truth): a
// pledge is a sponsor-funded scholarship targeted at a specific student, and an award is applied
// toward that student's INVOICE via the existing feesinvoice.RecordPayment (SF-2 derived-balance
// discipline preserved — this package NEVER writes a balance).
//
// Fund flow (fully auditable):
//   1. CreatePledge      — a sponsor pledges an amount for a target student (state=pledged).
//   2. FundPledge        — the pledged amount is moved into the scholarship fund via the INJECTED
//                          ledger poster (idempotent, balanced double-entry). state=funded.
//   3. ApplyAward        — an award is applied toward a student's invoice by calling the invoice
//                          package's RecordPayment (idempotent, records an invoice payment; the
//                          real guardian-side ledger move is E3's concern — here the funded
//                          scholarship is the payment source). state=applied.
//
// Money moves ONLY through the injected LedgerPoster (fund) and the invoice payment record
// (apply). This package posts no ledger entry of its own and writes no balance column.

// ── Pledge / Award state machines ───────────────────────────────────────────────

// PledgeState is the sponsor pledge lifecycle: pledged → funded → applied (or → cancelled).
type PledgeState string

const (
	PledgePledged   PledgeState = "pledged" // sponsor committed; funds not yet moved
	PledgeFunded    PledgeState = "funded"  // funds moved into the scholarship fund (ledger)
	PledgeApplied   PledgeState = "applied" // at least one award applied to an invoice
	PledgeCancelled PledgeState = "cancelled"
)

// AwardState is the award lifecycle for a single application against an invoice.
type AwardState string

const (
	AwardApplied  AwardState = "applied"
	AwardReversed AwardState = "reversed"
)

// ── Entities ─────────────────────────────────────────────────────────────────────

// Pledge is a Sponsor-a-Student pledge. It EXTENDS the edupay scholarship concept with a
// concrete target student. SponsorIdentityID is the sponsor's academy identity;
// TargetStudentID references public.academy_students(id).
type Pledge struct {
	ID                string      `json:"id"`
	SponsorIdentityID string      `json:"sponsorIdentityId"`
	TargetStudentID   string      `json:"targetStudentId"`
	AmountMinor       int64       `json:"amountMinor"`
	AppliedMinor      int64       `json:"appliedMinor"` // running total applied to invoices (derived-friendly)
	Currency          string      `json:"currency"`
	State             PledgeState `json:"state"`
	FundLedgerRef     *string     `json:"fundLedgerRef,omitempty"` // reference of the funding ledger move
	CreatedAt         time.Time   `json:"createdAt"`
}

// Award is one application of a funded pledge toward a specific invoice. It carries the invoice
// payment reference produced by feesinvoice.RecordPayment so the fund flow is traceable.
type Award struct {
	ID               string     `json:"id"`
	PledgeID         string     `json:"pledgeId"`
	InvoiceID        string     `json:"invoiceId"`
	StudentID        string     `json:"studentId"`
	AmountMinor      int64      `json:"amountMinor"`
	InvoicePaymentID *string    `json:"invoicePaymentId,omitempty"`
	State            AwardState `json:"state"`
	IdempotencyKey   string     `json:"-"`
	CreatedAt        time.Time  `json:"createdAt"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// CreatePledgeRequest creates a Sponsor-a-Student pledge.
type CreatePledgeRequest struct {
	SponsorIdentityID string `json:"sponsorIdentityId"`
	TargetStudentID   string `json:"targetStudentId" binding:"required"`
	AmountMinor       int64  `json:"amountMinor" binding:"required"`
	Currency          string `json:"currency"`
}

// ApplyAwardRequest applies part (or all) of a funded pledge toward a student's invoice. The
// GuardianUserID is the invoice's guardian-of-record (the RecordPayment guardian party).
type ApplyAwardRequest struct {
	PledgeID       string `json:"pledgeId" binding:"required"`
	InvoiceID      string `json:"invoiceId" binding:"required"`
	StudentID      string `json:"studentId"`
	GuardianUserID string `json:"guardianUserId"`
	AmountMinor    int64  `json:"amountMinor" binding:"required"`
}

// ── Sentinel errors ─────────────────────────────────────────────────────────────

var (
	ErrNotFound            = errors.New("not_found")
	ErrUnauthenticated     = errors.New("unauthenticated")
	ErrMissingStudent      = errors.New("missing_student")
	ErrInvalidAmount       = errors.New("invalid_amount")
	ErrIdempotencyRequired = errors.New("idempotency_key_required")
	ErrIdempotencyReused   = errors.New("idempotency_key_reused")
	ErrPledgeNotFunded     = errors.New("pledge_not_funded")
	ErrPledgeExhausted     = errors.New("pledge_amount_exhausted")
	ErrIllegalTransition   = errors.New("illegal_transition")
)

// canPledge reports whether a pledge transition is allowed (guarded SM).
func canPledge(from, to PledgeState) bool {
	switch from {
	case PledgePledged:
		return to == PledgeFunded || to == PledgeCancelled
	case PledgeFunded:
		return to == PledgeApplied || to == PledgeCancelled
	case PledgeApplied:
		return to == PledgeApplied // further partial applications stay in 'applied'
	default:
		return false
	}
}
