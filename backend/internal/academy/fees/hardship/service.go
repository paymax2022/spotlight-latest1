package feeshardship

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// Service owns the SF-9 hardship/freeze request workflow. It is deliberately split so the
// ONLY terminal transitions are human actions:
//
//	SubmitRequest → creates a `pending` request. NEVER approves/denies, NEVER freezes the
//	                invoice. There is no automated path off `pending` anywhere in this file.
//	Approve       → HUMAN action. Transitions the invoice overdue→frozen through the injected
//	                invoice service's GUARDED state machine (never a direct status write),
//	                then records the request `approved`.
//	Deny          → HUMAN action. Records the request `denied`. Leaves the invoice untouched.
//
// Approve/Deny are additionally fail-closed on reviewer authorization: an unauthorized
// caller is rejected with ErrForbidden BEFORE any request or invoice state changes.
//
// This package moves NO money. Every mutation is audit-logged (module 'academy.fees').
type Service struct {
	store    Store
	invoices InvoiceFreezer
	authz    ReviewerAuthorizer
}

// InvoiceFreezer is the slice of the invoice domain this package depends on. It is
// implemented by the integration task as a thin adapter over feesinvoice.Service so that the
// overdue→frozen move ALWAYS runs through feesstatemachine (never a raw status write):
//
//   - CurrentStatus reports the invoice's current status (so the service can pre-validate the
//     overdue→frozen edge via feesstatemachine.InvoiceTransition and audit the from-state).
//   - Freeze applies the EvInvoiceFreeze event through feesinvoice's guarded status writer
//     (the invoice service's own SetInvoiceStatus, which is fed by feesstatemachine). The
//     service only calls Freeze after it has itself confirmed the edge is legal, so an
//     adapter that simply delegates to the invoice state machine cannot drift.
//
// Defining it as an interface (rather than importing feesinvoice.Service directly) keeps this
// package decoupled and lets hardship_test.go inject a fake invoice service to assert the
// freeze happened on Approve and did NOT happen on Submit/Deny (SF-9).
type InvoiceFreezer interface {
	// CurrentStatus returns the invoice's current status, or ErrNotFound if absent.
	CurrentStatus(ctx context.Context, invoiceID string) (feesstatemachine.InvoiceState, error)
	// Freeze applies overdue→frozen via feesstatemachine (EvInvoiceFreeze) through the invoice
	// service's guarded status writer. Returns the resulting state.
	Freeze(ctx context.Context, actorID, invoiceID string) (feesstatemachine.InvoiceState, error)
}

// ReviewerAuthorizer answers whether a caller may approve/deny hardship requests for a school
// (SF-9 human review, fail-closed). Implemented by the integration task over the RBAC service
// (e.g. CheckPermission(userID, "academy.fees.hardship.review", "school", schoolID)). When no
// authorizer is injected the service DENIES all reviews (fail-closed) — a review path never
// runs unauthenticated/unauthorized.
type ReviewerAuthorizer interface {
	CanReview(ctx context.Context, reviewerID, invoiceID string) (bool, error)
}

// NewService wires the pgx-backed store. The invoice-freezer + reviewer-authorizer ports are
// injected by the integration task (composed at the academy registration root), mirroring
// how feesscholarship takes its ledger/invoice ports.
func NewService(db *pgxpool.Pool, invoices InvoiceFreezer, authz ReviewerAuthorizer) *Service {
	return &Service{store: NewRepository(db), invoices: invoices, authz: authz}
}

// NewServiceWithDeps injects all ports (tests / integration).
func NewServiceWithDeps(store Store, invoices InvoiceFreezer, authz ReviewerAuthorizer) *Service {
	return &Service{store: store, invoices: invoices, authz: authz}
}

// ── SubmitRequest (creates a `pending` request — SF-9, NO terminal transition) ────

// SubmitRequest records a guardian's hardship/freeze request against an invoice. It ALWAYS
// creates the request in `pending` and returns it. It NEVER:
//   - approves or denies the request, and
//   - freezes (or otherwise transitions) the invoice.
//
// There is intentionally no automated review here — the request sits in the human review
// queue until an authorized reviewer explicitly acts on it (SF-9).
func (s *Service) SubmitRequest(ctx context.Context, guardianUserID string, req SubmitRequestRequest) (*HardshipRequest, error) {
	if guardianUserID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(req.InvoiceID) == "" {
		return nil, ErrMissingInvoice
	}
	if strings.TrimSpace(req.Reason) == "" {
		return nil, ErrMissingReason
	}

	out, err := s.store.Insert(ctx, HardshipRequest{
		InvoiceID:      req.InvoiceID,
		GuardianUserID: guardianUserID,
		Reason:         req.Reason,
		Status:         StatusPending, // the store forces 'pending'; set here for clarity too
	})
	if err != nil {
		return nil, err
	}
	// Audit the SUBMISSION only. Note: to_state is 'pending' — never approved/denied/frozen.
	_ = s.store.WriteAudit(ctx, guardianUserID, "hardship_request_submitted", out.ID, "", string(StatusPending),
		map[string]any{"invoiceId": req.InvoiceID})
	return out, nil
}

// ── Approve / Deny (HUMAN action only — the sole way off `pending`) ───────────────

// Approve is the HUMAN reviewer action that approves a pending hardship request AND freezes
// the invoice (overdue→frozen) through the injected invoice service's guarded state machine.
// Order of operations (fail-closed throughout):
//  1. authenticate + authorize the reviewer (ErrForbidden if not allowed),
//  2. load the request; reject if it is not still pending (ErrAlreadyReviewed),
//  3. confirm overdue→frozen is a LEGAL edge for this invoice via feesstatemachine,
//  4. freeze the invoice via the injected invoice service (never a direct status write),
//  5. record the request `approved` under the pending-guard, and audit.
//
// If the invoice cannot legally be frozen (not overdue), the approval is rejected with
// ErrInvoiceNotFreezable and the request STAYS pending — the human must resolve the invoice
// state first rather than the request silently succeeding without a freeze.
func (s *Service) Approve(ctx context.Context, reviewerID, requestID, note string) (*HardshipRequest, error) {
	req, err := s.authorizeReview(ctx, reviewerID, requestID)
	if err != nil {
		return nil, err
	}

	// 3) Pre-validate the overdue→frozen edge via the guarded state machine before touching
	//    the invoice. The invoice service performs the same guarded transition; validating
	//    here lets us fail-closed with a precise error and audit the true from-state.
	from, err := s.invoices.CurrentStatus(ctx, req.InvoiceID)
	if err != nil {
		return nil, err
	}
	if _, terr := feesstatemachine.InvoiceTransition(from, feesstatemachine.EvInvoiceFreeze); terr != nil {
		_ = s.store.WriteAudit(ctx, reviewerID, "hardship_approve_rejected", req.ID, string(StatusPending), string(StatusPending),
			map[string]any{"invoiceId": req.InvoiceID, "invoiceStatus": string(from), "reason": terr.Error()})
		return nil, ErrInvoiceNotFreezable
	}

	// 4) FREEZE the invoice via the injected service (overdue→frozen through feesstatemachine).
	to, ferr := s.invoices.Freeze(ctx, reviewerID, req.InvoiceID)
	if ferr != nil {
		return nil, ferr
	}

	// 5) Record the request approved (guarded on status='pending').
	out, err := s.store.SetReviewed(ctx, req.ID, reviewerID, StatusApproved, note)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, reviewerID, "hardship_request_approved", req.ID, string(StatusPending), string(StatusApproved),
		map[string]any{"invoiceId": req.InvoiceID, "invoiceFrom": string(from), "invoiceTo": string(to), "note": note})
	return out, nil
}

// Deny is the HUMAN reviewer action that denies a pending hardship request. It records the
// request `denied` and leaves the invoice EXACTLY as-is — no freeze, no other transition.
func (s *Service) Deny(ctx context.Context, reviewerID, requestID, note string) (*HardshipRequest, error) {
	req, err := s.authorizeReview(ctx, reviewerID, requestID)
	if err != nil {
		return nil, err
	}
	out, err := s.store.SetReviewed(ctx, req.ID, reviewerID, StatusDenied, note)
	if err != nil {
		return nil, err
	}
	// Deny touches NO invoice state — audit records the request-only transition.
	_ = s.store.WriteAudit(ctx, reviewerID, "hardship_request_denied", req.ID, string(StatusPending), string(StatusDenied),
		map[string]any{"invoiceId": req.InvoiceID, "note": note})
	return out, nil
}

// authorizeReview is the shared fail-closed guard for Approve/Deny: it requires an
// authenticated reviewer, an authorizer that grants review, and a request that is still
// pending. Returns the loaded request on success.
func (s *Service) authorizeReview(ctx context.Context, reviewerID, requestID string) (*HardshipRequest, error) {
	if reviewerID == "" {
		return nil, ErrUnauthenticated
	}
	req, err := s.store.Get(ctx, requestID)
	if err != nil {
		return nil, err
	}
	// Fail-closed authorization: no authorizer wired ⇒ deny. Authorizer error ⇒ deny.
	if s.authz == nil {
		return nil, ErrForbidden
	}
	ok, aerr := s.authz.CanReview(ctx, reviewerID, req.InvoiceID)
	if aerr != nil || !ok {
		return nil, ErrForbidden
	}
	// Reject double-review early (the store re-checks under the pending-guard too).
	if req.Status.IsTerminal() {
		return nil, ErrAlreadyReviewed
	}
	return req, nil
}

// ── Reads ─────────────────────────────────────────────────────────────────────────

// Get returns a single hardship request.
func (s *Service) Get(ctx context.Context, id string) (*HardshipRequest, error) {
	return s.store.Get(ctx, id)
}

// ListPending returns the pending review queue for a school (SF-9 human review queue).
func (s *Service) ListPending(ctx context.Context, schoolID string) ([]HardshipRequest, error) {
	if strings.TrimSpace(schoolID) == "" {
		return nil, ErrNotFound
	}
	return s.store.ListPendingBySchool(ctx, schoolID)
}
