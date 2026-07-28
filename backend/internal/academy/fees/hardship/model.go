package feeshardship

import (
	"errors"
	"time"
)

// Package feeshardship owns the EdTech Fees hardship/freeze request workflow (build-spec
// §3.1 overdue→frozen, §4 SF-9). It is a brownfield EXTENSION of the academy fees module,
// mirroring the conventions of the sibling fees packages (feesschool, feesinvoice,
// feesscholarship): pgx-pool data access via an in-package Store interface (so the logic is
// unit-testable with an in-memory fake), sentinel errors mapped to snake_case codes by the
// handler, and guarded invoice-status changes routed THROUGH feesstatemachine via the
// injected invoice service — never a raw status write.
//
// SF-9 (CRITICAL — the reason this package exists): hardship/freeze requests route to a
// HUMAN review queue. There is NO automated terminal transition on a hardship request.
//   - SubmitRequest ONLY creates a `pending` request. It NEVER approves, denies, or freezes
//     the invoice by itself. No code path in this package auto-advances a pending request.
//   - The ONLY way a request leaves `pending` is an explicit human Approve/Deny by an
//     authorized reviewer (RBAC-gated, fail-closed).
//   - The overdue→frozen invoice transition happens ONLY on a human Approve, and only via
//     the injected invoice service's guarded state machine (EvInvoiceFreeze). Deny leaves the
//     invoice exactly as-is.
//
// This package moves NO money. Every state change is audit-logged (module 'academy.fees').

// RequestStatus is the hardship-request review status. It is DISTINCT from the invoice
// status: a request being approved is what may (via human action) drive the invoice
// overdue→frozen transition — the two are never conflated.
type RequestStatus string

const (
	// StatusPending is the only status SubmitRequest ever produces (SF-9). A request stays
	// pending until an authorized human reviewer explicitly approves or denies it.
	StatusPending RequestStatus = "pending"
	// StatusApproved is set ONLY by Approve (human action). On approval the invoice is
	// transitioned overdue→frozen via the injected invoice service's guarded state machine.
	StatusApproved RequestStatus = "approved"
	// StatusDenied is set ONLY by Deny (human action). Denial leaves the invoice unchanged.
	StatusDenied RequestStatus = "denied"
)

// IsTerminal reports whether a request has already been reviewed (approved/denied) and can
// no longer be acted on. Used to keep review idempotent / fail-closed against double-review.
func (s RequestStatus) IsTerminal() bool {
	return s == StatusApproved || s == StatusDenied
}

// HardshipRequest mirrors public.academy_hardship_requests (the additive table the
// integration migration adds — see the report for the exact column list). It is the review
// queue row: submission fills the top block; a human review fills the reviewer block.
type HardshipRequest struct {
	ID             string        `json:"id"`
	InvoiceID      string        `json:"invoiceId"`
	GuardianUserID string        `json:"guardianUserId"`
	Reason         string        `json:"reason"`
	RequestedAt    time.Time     `json:"requestedAt"`
	Status         RequestStatus `json:"status"`

	// ── Filled ONLY by a human review (Approve/Deny) — nil while pending (SF-9) ──
	ReviewedBy *string    `json:"reviewedBy,omitempty"`
	ReviewedAt *time.Time `json:"reviewedAt,omitempty"`
	ReviewNote *string    `json:"reviewNote,omitempty"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// SubmitRequestRequest is the guardian-facing submission. guardian_user_id is the
// authenticated caller (set by the service, never trusted from the body). Submission only
// ever creates a `pending` request (SF-9).
type SubmitRequestRequest struct {
	InvoiceID string `json:"invoiceId" binding:"required"`
	Reason    string `json:"reason" binding:"required"`
}

// ReviewRequest is the ADMIN/human review payload (approve or deny). The note is an optional
// free-text rationale recorded on the request + the audit log.
type ReviewRequest struct {
	Note string `json:"note"`
}

// ── Sentinel errors (mapped to snake_case codes by the handler) ──────────────────

var (
	ErrNotFound         = errors.New("not_found")
	ErrUnauthenticated  = errors.New("unauthenticated")
	ErrForbidden        = errors.New("forbidden")
	ErrMissingInvoice   = errors.New("missing_invoice")
	ErrMissingReason    = errors.New("missing_reason")
	ErrAlreadyReviewed  = errors.New("already_reviewed")
	// ErrInvoiceNotFreezable is returned when a human approves a hardship request but the
	// invoice is not in a state from which overdue→frozen is legal (per feesstatemachine).
	// Fail-closed: approval that cannot legally freeze the invoice is rejected rather than
	// silently leaving the invoice untouched.
	ErrInvoiceNotFreezable = errors.New("invoice_not_freezable")
)
