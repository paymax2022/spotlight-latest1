package feesinvoice

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	feesfeeschedule "spotlight/backend/internal/academy/fees/feeschedule"
	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// Service owns the Invoice lifecycle (build-spec §3.1) + the SF-2 derived-balance discipline.
//
// SF-2 (release blocker): balance and amount_paid are ALWAYS derived — balance =
// total_amount_minor − SUM(succeeded payments). The service NEVER writes a balance column
// (none exists) and never caches amount_paid. Every read hydrates them from the payment rows.
//
// State changes go through feesstatemachine.InvoiceTransition ONLY (never a raw status write).
//
// On first issue the service LOCKS the referenced fee schedule (SF-1) via the injected
// feeScheduleLocker (feeschedule.Service.Lock) so the schedule becomes immutable. The lock
// is an interface so tests inject a fake and assert Lock was called (SF-1 interplay).
//
// Money is int64 minor units (kobo). RecordPayment records the thin payment row and derives
// status; the REAL ledger move (guardian wallet → school) is E3's payment-adapter concern —
// see the E3 hook comment on RecordPayment.
type Service struct {
	store  Store
	locker feeScheduleLocker
	feeSvc feeScheduleReader
}

// feeScheduleLocker is the slice of the feeschedule service this package calls on first
// issue to engage SF-1 immutability. Implemented by *feesfeeschedule.Service.Lock.
type feeScheduleLocker interface {
	Lock(ctx context.Context, actorID, id string) (*feesfeeschedule.FeeSchedule, error)
}

// feeScheduleReader lets the service resolve a schedule's amount when total is not supplied
// (single source of truth for price). Implemented by *feesfeeschedule.Service.Get. Optional.
type feeScheduleReader interface {
	Get(ctx context.Context, id string) (*feesfeeschedule.FeeSchedule, error)
}

// NewService wires the invoice service over the pgx pool, using the real feeschedule
// service for the SF-1 lock + amount resolution.
func NewService(db *pgxpool.Pool) *Service {
	fs := feesfeeschedule.NewService(db)
	return &Service{store: NewRepository(db), locker: fs, feeSvc: fs}
}

// NewServiceWithDeps injects a Store + fee-schedule locker/reader (tests / integration).
func NewServiceWithDeps(store Store, locker feeScheduleLocker, feeSvc feeScheduleReader) *Service {
	return &Service{store: store, locker: locker, feeSvc: feeSvc}
}

const dateLayout = "2006-01-02"

func parseDate(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse(dateLayout, s)
	if err != nil {
		return nil, ErrInvalidDate
	}
	return &t, nil
}

// ── Issue (draft → issued) ────────────────────────────────────────────────────────

// Issue creates + issues an invoice for a student against an immutable fee schedule. It:
//  1. resolves total_amount_minor (from the request or the fee schedule),
//  2. inserts the invoice in 'draft',
//  3. LOCKS the fee schedule (SF-1 — feeScheduleLocker.Lock) so it can no longer be edited,
//  4. transitions draft → issued via feesstatemachine.InvoiceTransition (never a raw write),
//  5. audits the issuance.
//
// If the lock fails the issue fails (fail-closed): an invoice must never exist against a
// still-mutable schedule.
func (s *Service) Issue(ctx context.Context, actorID string, req IssueInvoiceRequest) (*Invoice, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(req.StudentID) == "" {
		return nil, ErrMissingStudent
	}
	if strings.TrimSpace(req.FeeScheduleID) == "" {
		return nil, ErrMissingFeeSchedule
	}

	total := req.TotalAmountMinor
	if total <= 0 {
		// Derive the price from the immutable fee schedule (single source of truth).
		if s.feeSvc == nil {
			return nil, ErrInvalidAmount
		}
		fs, err := s.feeSvc.Get(ctx, req.FeeScheduleID)
		if err != nil {
			return nil, err
		}
		total = fs.AmountMinor
	}
	if total <= 0 {
		return nil, ErrInvalidAmount
	}

	due, err := parseDate(req.DueDate)
	if err != nil {
		return nil, err
	}

	// 1) Insert in draft.
	inv, err := s.store.InsertInvoice(ctx, Invoice{
		StudentID:        req.StudentID,
		FeeScheduleID:    req.FeeScheduleID,
		TotalAmountMinor: total,
		Status:           feesstatemachine.InvoiceDraft,
	}, due)
	if err != nil {
		return nil, err
	}

	// 2) SF-1: lock the fee schedule on first issue — fail-closed if it can't be locked.
	if s.locker != nil {
		if _, lerr := s.locker.Lock(ctx, actorID, req.FeeScheduleID); lerr != nil {
			_ = s.store.WriteAudit(ctx, actorID, "invoice_issue_rejected", inv.ID, string(feesstatemachine.InvoiceDraft), "",
				map[string]any{"reason": "fee_schedule_lock_failed", "feeScheduleId": req.FeeScheduleID})
			return nil, lerr
		}
	}

	// 3) draft → issued via the guarded state machine (never a raw status write).
	to, err := feesstatemachine.InvoiceTransition(feesstatemachine.InvoiceDraft, feesstatemachine.EvInvoiceIssue)
	if err != nil {
		return nil, err
	}
	out, err := s.store.SetInvoiceStatus(ctx, inv.ID, feesstatemachine.InvoiceDraft, to, true /*setIssuedAt*/)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "invoice_issued", inv.ID, string(feesstatemachine.InvoiceDraft), string(to),
		map[string]any{"studentId": req.StudentID, "feeScheduleId": req.FeeScheduleID, "totalAmountMinor": total})

	return s.hydrate(ctx, out)
}

// ── Reads (with derived balance) ──────────────────────────────────────────────────

// GetInvoice returns an invoice with its SF-2 derived amount_paid + balance.
func (s *Service) GetInvoice(ctx context.Context, id string) (*Invoice, error) {
	inv, err := s.store.GetInvoice(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.hydrate(ctx, inv)
}

// ListInvoicesByStudent returns a student's invoices, each with derived balance.
func (s *Service) ListInvoicesByStudent(ctx context.Context, studentID string) ([]Invoice, error) {
	invs, err := s.store.ListInvoicesByStudent(ctx, studentID)
	if err != nil {
		return nil, err
	}
	out := make([]Invoice, 0, len(invs))
	for i := range invs {
		h, herr := s.hydrate(ctx, &invs[i])
		if herr != nil {
			return nil, herr
		}
		out = append(out, *h)
	}
	return out, nil
}

// ListPayments returns the append-only payment rows for an invoice.
func (s *Service) ListPayments(ctx context.Context, invoiceID string) ([]Payment, error) {
	return s.store.ListPayments(ctx, invoiceID)
}

// DerivedBalance is the SF-2 computation, exposed for callers/tests: balance =
// total_amount_minor − SUM(succeeded payments). Never reads a stored balance column.
func (s *Service) DerivedBalance(ctx context.Context, invoiceID string) (paid int64, balance int64, err error) {
	inv, err := s.store.GetInvoice(ctx, invoiceID)
	if err != nil {
		return 0, 0, err
	}
	paid, err = s.store.SumSucceededPayments(ctx, invoiceID)
	if err != nil {
		return 0, 0, err
	}
	return paid, inv.TotalAmountMinor - paid, nil
}

// hydrate populates the DERIVED AmountPaidMinor + Balance on an invoice from the payment
// rows (SF-2). This is the ONLY place those fields are set, and they are never persisted.
func (s *Service) hydrate(ctx context.Context, inv *Invoice) (*Invoice, error) {
	paid, err := s.store.SumSucceededPayments(ctx, inv.ID)
	if err != nil {
		return nil, err
	}
	inv.AmountPaidMinor = paid
	inv.Balance = inv.TotalAmountMinor - paid
	return inv, nil
}

// ── RecordPayment (append + derive status) ────────────────────────────────────────

// RecordPayment APPENDS a payment against an invoice and recomputes the invoice status from
// the DERIVED balance (SF-2). It is a thin record: the real money move (guardian wallet →
// school escrow/VA via the double-entry ledger) is E3's payment-adapter concern.
//
// >>> E3 HOOK <<<
// E3's payment adapter should perform the actual ledger debit/credit (finance/ledger
// Debit/Credit or edupay CollectRail) and pass the resulting ledger reference in as
// ledgerReference here, calling RecordPayment as the invoice-side record of a settled move.
// This method itself posts NO ledger entry — it only records the row + derives status. The
// natural attach point is right before AppendPayment (do the ledger move, then record it),
// sharing the SAME idempotencyKey so the money move and the invoice record replay together.
//
// IDEMPOTENCY (money path, required): idempotencyKey is mandatory. AppendPayment is
// idempotent on the globally-UNIQUE idempotency_key — a replay returns the EXISTING payment
// row (Replayed=true), inserts nothing, and re-derives (unchanged) status. Never a double
// insert, never a double state advance.
//
// Status derivation (never a raw write; always via feesstatemachine):
//   - past due_date with a positive balance  → mark_overdue (issued/partially_paid → overdue)
//   - balance == 0 after the payment          → pay_full (→ paid)
//   - balance > 0 with some payment recorded  → pay_partial (→ partially_paid)
func (s *Service) RecordPayment(ctx context.Context, actorID, invoiceID, guardianUserID string, amountMinor int64, gatewayRef, ledgerReference, idempotencyKey string) (*RecordPaymentResult, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, ErrIdempotencyRequired
	}
	if amountMinor <= 0 {
		return nil, ErrInvalidAmount
	}

	inv, err := s.store.GetInvoice(ctx, invoiceID)
	if err != nil {
		return nil, err
	}
	// Only payable states accept payments. Terminal (paid/waived/written_off) + draft reject.
	if !isPayable(inv.Status) {
		return nil, ErrInvoiceNotPayable
	}

	// APPEND the payment (idempotent on idempotency_key). Payment is recorded 'succeeded'
	// here because the money move is either already settled by E3's adapter (ledgerReference
	// set) or, in the record-only path, treated as the source of truth for the invoice.
	p, inserted, err := s.store.AppendPayment(ctx, Payment{
		InvoiceID:       invoiceID,
		GuardianUserID:  guardianUserID,
		AmountMinor:     amountMinor,
		GatewayRef:      ptrOrNil(gatewayRef),
		LedgerReference: ptrOrNil(ledgerReference),
		Status:          PaymentSucceeded,
		IdempotencyKey:  idempotencyKey,
	})
	if err != nil {
		return nil, err
	}

	if !inserted {
		// Replay: the same idempotency key already recorded this payment. Return the current
		// (derived) invoice state WITHOUT re-inserting or re-advancing status.
		hydrated, herr := s.hydrate(ctx, inv)
		if herr != nil {
			return nil, herr
		}
		return &RecordPaymentResult{Payment: p, Invoice: hydrated, Replayed: true}, nil
	}

	_ = s.store.WriteAudit(ctx, actorID, "invoice_payment_recorded", invoiceID, "", "",
		map[string]any{"paymentId": p.ID, "amountMinor": amountMinor, "guardianUserId": guardianUserID,
			"gatewayRef": gatewayRef, "ledgerReference": ledgerReference, "idempotencyKey": idempotencyKey})

	// Derive the new balance from the (now-updated) payment rows — SF-2.
	paid, err := s.store.SumSucceededPayments(ctx, invoiceID)
	if err != nil {
		return nil, err
	}
	balance := inv.TotalAmountMinor - paid

	updated, err := s.deriveStatusAfterPayment(ctx, actorID, inv, balance)
	if err != nil {
		return nil, err
	}
	hydrated, err := s.hydrate(ctx, updated)
	if err != nil {
		return nil, err
	}
	return &RecordPaymentResult{Payment: p, Invoice: hydrated, Replayed: false}, nil
}

// deriveStatusAfterPayment picks the correct invoice event from the DERIVED balance and the
// due date, then applies it via the guarded state machine. Returns the invoice as it stands
// after the transition (or unchanged when no transition is warranted / it is idempotent).
func (s *Service) deriveStatusAfterPayment(ctx context.Context, actorID string, inv *Invoice, balance int64) (*Invoice, error) {
	from := inv.Status

	// Fully paid → pay_full (→ paid). Highest priority: a zero balance always means paid.
	if balance <= 0 {
		return s.applyEvent(ctx, actorID, inv, feesstatemachine.EvInvoicePayFull)
	}

	// Positive balance past the due date → overdue (issued/partially_paid → overdue).
	if inv.DueDate != nil && time.Now().After(*inv.DueDate) {
		// Only issued/partially_paid may move to overdue; if already overdue this is a no-op.
		if from == feesstatemachine.InvoiceIssued || from == feesstatemachine.InvoicePartiallyPaid {
			return s.applyEvent(ctx, actorID, inv, feesstatemachine.EvInvoiceMarkOverdue)
		}
		// Already overdue (or frozen) with a remaining balance — record the partial and stay.
		return inv, nil
	}

	// Positive balance, not overdue → partially_paid.
	return s.applyEvent(ctx, actorID, inv, feesstatemachine.EvInvoicePayPartial)
}

// applyEvent runs one guarded transition and persists it (status only). ErrAlreadyInState is
// treated as a benign no-op (the invoice is already where the event would land). Never a raw
// status write.
func (s *Service) applyEvent(ctx context.Context, actorID string, inv *Invoice, event feesstatemachine.Event) (*Invoice, error) {
	from := inv.Status
	to, err := feesstatemachine.InvoiceTransition(from, event)
	if err != nil {
		if err == feesstatemachine.ErrAlreadyInState {
			return inv, nil // benign: already in the target state
		}
		return nil, ErrIllegalTransition
	}
	if to == from {
		// Explicit self-loop (partially_paid → partially_paid): no DB status change needed.
		return inv, nil
	}
	setIssuedAt := false
	out, err := s.store.SetInvoiceStatus(ctx, inv.ID, from, to, setIssuedAt)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "invoice_status_derived", inv.ID, string(from), string(to),
		map[string]any{"event": string(event)})
	return out, nil
}

// isPayable reports whether an invoice in this state accepts a payment. Draft (not yet
// issued) and terminal states reject; issued / partially_paid / overdue accept. Frozen
// (hardship, SF-9) rejects new payments until unfrozen by human review.
func isPayable(state feesstatemachine.InvoiceState) bool {
	switch state {
	case feesstatemachine.InvoiceIssued, feesstatemachine.InvoicePartiallyPaid, feesstatemachine.InvoiceOverdue:
		return true
	default:
		return false
	}
}
