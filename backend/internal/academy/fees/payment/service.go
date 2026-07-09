package feespayment

import (
	"context"
	"strings"

	"spotlight/backend/internal/provider"
)

// ── Injected collaborators (adapter, not SDK leak) ──────────────────────────────────
//
// Every collaborator is a SMALL locally-declared interface so payment_test.go can inject
// in-memory fakes (no live gateway / DB / ledger) and ASSERT the money-path invariants:
// end-to-end idempotency, SF-2 (record a payment, never write a balance), and the balanced
// guardian-wallet → school-settlement ledger move. The concrete adapters are wired at the
// composition root (integration task): the real *provider.PaymentProvider satisfies Gateway
// directly; a thin shim over *finance/ledger.Service satisfies LedgerMover; a thin shim over
// *fees/invoice.Service satisfies InvoiceRecorder.

// Gateway is the slice of provider.PaymentProvider this adapter uses. The concrete
// provider.PaymentProvider (Paystack, etc.) satisfies it as-is — NO new provider integration.
type Gateway interface {
	InitializePayment(ctx context.Context, req provider.InitializePaymentRequest) (*provider.InitializePaymentResponse, error)
	VerifyPayment(ctx context.Context, reference string) (*provider.PaymentStatus, error)
}

// LedgerMover posts the REAL money move for a confirmed fee charge: the balanced double-entry
// transfer of the guardian wallet → the school settlement account. It is idempotent on
// idempotencyKey (a replayed confirmation posts nothing). It NEVER exposes or mutates a balance
// column — it only appends balanced ledger entries.
//
// The concrete shim resolves the school settlement standing account and calls
// ledger.Service.Debit(guardianUserID → settlementAccountID) (TOCTOU-safe, fail-closed on
// insufficient funds), returning the ledger reference actually posted so the invoice record and
// the money leg share one identity.
type LedgerMover interface {
	// MoveGuardianToSchool debits the guardian wallet and credits the school settlement account
	// for schoolID, atomically + idempotently. Returns the ledger reference posted.
	MoveGuardianToSchool(ctx context.Context, guardianUserID, schoolID, reference, idempotencyKey string, amountMinor int64) (ledgerRef string, err error)
}

// InvoiceRecorder is the E2 invoice hook. After the ledger move settles, the adapter records the
// invoice-side payment through this interface using the SAME idempotency key, so the money leg
// and the invoice record replay together (SF-2: the invoice balance is DERIVED from its payment
// events; we RECORD a payment, we NEVER mutate a balance). The concrete shim adapts
// fees/invoice.Service.RecordPayment (whose full signature is
// RecordPayment(ctx, actorID, invoiceID, guardianUserID, amountMinor, gatewayRef,
// ledgerReference, idempotencyKey) (*RecordPaymentResult, error)) down to this surface.
type InvoiceRecorder interface {
	// RecordPayment appends an idempotent payment against invoiceID for guardianUserID, carrying
	// the gateway + ledger references. Returns the invoice's derived status after the payment and
	// whether the call was a replay (existing idempotency key). Idempotent on idempotencyKey.
	RecordPayment(ctx context.Context, invoiceID, guardianUserID string, amountMinor int64, gatewayRef, ledgerReference, idempotencyKey string) (invoiceStatus string, replayed bool, err error)
	// SchoolIDForInvoice resolves which school settlement account a payment for this invoice
	// should credit (the invoice → fee schedule → school chain). Used by the confirmation path
	// to route the ledger move.
	SchoolIDForInvoice(ctx context.Context, invoiceID string) (schoolID string, err error)
	// InstallmentPolicyForInvoice reports whether the invoice's immutable fee schedule carries
	// an installment_policy (SF-6). hasPolicy=true means installments are permitted and the
	// first one needs the locked-terms disclosure.
	InstallmentPolicyForInvoice(ctx context.Context, invoiceID string) (hasPolicy bool, err error)
	// HasAnyPayment reports whether ANY payment has been recorded against the invoice yet, used
	// to decide DisclosureRequired (only the FIRST installment needs the disclosure gate).
	HasAnyPayment(ctx context.Context, invoiceID string) (bool, error)
}

// IntentStore persists the thin pending-intent record: (reference → invoiceID, guardianUserID,
// amountMinor, idempotencyKey). It stores NOTHING that duplicates the ledger — only the mapping
// needed to (a) make CreatePaymentIntent idempotent on the Idempotency-Key and (b) let
// OnChargeSuccess resolve the invoice/guardian/amount/idempotency key from the gateway reference
// echoed back on the webhook. The concrete impl is a pgx repo (repository.go is out of scope for
// this task — the integration task provides it or reuses an existing intents table); tests use an
// in-memory fake.
type IntentStore interface {
	// PutIntent records a pending intent keyed by BOTH reference and idempotencyKey. Idempotent:
	// a replay with the same idempotencyKey returns the EXISTING intent (inserted=false) so a
	// retried CreatePaymentIntent yields the same reference/URL. The URL is not stored (it is a
	// short-lived gateway handle); on replay the caller re-initializes with the same reference,
	// which the gateway itself treats idempotently via the shared reference.
	PutIntent(ctx context.Context, in intentRecord) (existing *intentRecord, inserted bool, err error)
	// GetByReference resolves a pending intent from the gateway reference (confirmation path).
	GetByReference(ctx context.Context, reference string) (*intentRecord, error)
	// MarkConfirmed flips a pending intent to confirmed (audit/idempotency aid). Best-effort.
	MarkConfirmed(ctx context.Context, reference string) error
}

// intentRecord is the stored pending-intent row. It is deliberately minimal — no money state,
// no balance. The ledger + invoice_payments are the sources of truth for settled money.
type intentRecord struct {
	Reference      string
	InvoiceID      string
	GuardianUserID string
	SchoolID       string
	AmountMinor    int64
	IdempotencyKey string
	IsInstallment  bool
	Confirmed      bool
}

// Service is the fees payment adapter. It owns no money state — it orchestrates the gateway, the
// ledger, and the invoice recorder, all injected.
type Service struct {
	gateway Gateway
	ledger  LedgerMover
	invoice InvoiceRecorder
	intents IntentStore
}

// NewService wires the adapter with its collaborators. All are injected at the composition root
// (no vendor SDK, no concrete ledger/invoice import here).
func NewService(gateway Gateway, ledger LedgerMover, invoice InvoiceRecorder, intents IntentStore) *Service {
	return &Service{gateway: gateway, ledger: ledger, invoice: invoice, intents: intents}
}

// referenceFor derives our deterministic gateway reference from the idempotency key so a retried
// intent (same key) reuses the same reference — the gateway then treats the re-initialization as
// the same session, and the confirmation resolves back to one intent.
func referenceFor(idempotencyKey string) string {
	return "feespay:" + idempotencyKey
}

// ── 1) Payment intent ───────────────────────────────────────────────────────────────

// CreatePaymentIntent starts a full-invoice checkout session. It calls the injected Gateway to
// InitializePayment and returns the authorization URL + reference to the caller (parent app). It
// persists ONLY the thin pending-intent mapping (never anything that duplicates the ledger); the
// actual money capture reconciles later via OnChargeSuccess (webhook/verify).
//
// Idempotent (money path, required): idempotencyKey is mandatory. The reference is derived from
// the key, and PutIntent is idempotent on the key — a replay returns the same reference/intent,
// and re-initializing the gateway with the same reference is a safe no-op session.
func (s *Service) CreatePaymentIntent(ctx context.Context, guardianUserID string, req CreatePaymentIntentRequest, idempotencyKey string) (*PaymentIntent, error) {
	if guardianUserID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(req.InvoiceID) == "" {
		return nil, ErrMissingInvoice
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, ErrIdempotencyRequired
	}
	if req.AmountMinor <= 0 {
		return nil, ErrInvalidAmount
	}
	return s.startIntent(ctx, guardianUserID, req.InvoiceID, req.AmountMinor, req.Email, req.CallbackURL, idempotencyKey, false /*installment*/, false /*acknowledged*/)
}

// ── 3) Installments (SF-6) ────────────────────────────────────────────────────────

// PayInstallment starts a checkout session for a PARTIAL payment against an invoice whose
// immutable fee schedule carries an installment_policy. The terms were locked/disclosed at
// issuance (SF-1); here we only accept the partial amount and drive the same intent flow. The
// invoice will derive partially_paid on confirmation (SF-2).
//
// SF-6 disclosure: if this is the FIRST payment on a policy-bearing invoice and the guardian has
// not acknowledged the locked terms, we return an intent with DisclosureRequired=true and DO NOT
// start the gateway session — the UI must surface the disclosure and re-call with Acknowledged.
func (s *Service) PayInstallment(ctx context.Context, guardianUserID string, req PayInstallmentRequest, idempotencyKey string) (*PaymentIntent, error) {
	if guardianUserID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(req.InvoiceID) == "" {
		return nil, ErrMissingInvoice
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, ErrIdempotencyRequired
	}
	if req.AmountMinor <= 0 {
		return nil, ErrInvalidAmount
	}

	hasPolicy, err := s.invoice.InstallmentPolicyForInvoice(ctx, req.InvoiceID)
	if err != nil {
		return nil, err
	}
	// If there is no installment policy this is simply a partial payment; still allowed, but no
	// disclosure gate applies. If there IS a policy, enforce the first-installment disclosure.
	if hasPolicy && !req.Acknowledged {
		hasPrior, err := s.invoice.HasAnyPayment(ctx, req.InvoiceID)
		if err != nil {
			return nil, err
		}
		if !hasPrior {
			// First installment, terms not yet acknowledged → surface the disclosure, do not
			// start the gateway session. No money moves.
			return &PaymentIntent{
				InvoiceID:          req.InvoiceID,
				GuardianUserID:     guardianUserID,
				AmountMinor:        req.AmountMinor,
				DisclosureRequired: true,
				IsInstallment:      true,
			}, nil
		}
	}

	return s.startIntent(ctx, guardianUserID, req.InvoiceID, req.AmountMinor, req.Email, req.CallbackURL, idempotencyKey, true /*installment*/, req.Acknowledged)
}

// startIntent is the shared intent-creation path for full + installment payments. It resolves the
// school (for later settlement routing), records the thin idempotent intent, initializes the
// gateway session, and returns the auth URL/reference. No money moves here.
func (s *Service) startIntent(ctx context.Context, guardianUserID, invoiceID string, amountMinor int64, email, callbackURL, idempotencyKey string, installment, acknowledged bool) (*PaymentIntent, error) {
	schoolID, err := s.invoice.SchoolIDForInvoice(ctx, invoiceID)
	if err != nil {
		return nil, err
	}

	reference := referenceFor(idempotencyKey)

	// Persist the thin pending-intent mapping (idempotent on the key). On replay we reuse the
	// existing record — same reference, so the gateway session is the same.
	existing, inserted, err := s.intents.PutIntent(ctx, intentRecord{
		Reference:      reference,
		InvoiceID:      invoiceID,
		GuardianUserID: guardianUserID,
		SchoolID:       schoolID,
		AmountMinor:    amountMinor,
		IdempotencyKey: idempotencyKey,
		IsInstallment:  installment,
	})
	if err != nil {
		return nil, err
	}
	if !inserted && existing != nil {
		// Idempotent replay: reuse the recorded intent's reference/amount.
		reference = existing.Reference
		amountMinor = existing.AmountMinor
	}

	// Initialize the gateway session (idempotent via the shared reference). No new provider
	// integration — this is the existing PaymentProvider interface.
	resp, err := s.gateway.InitializePayment(ctx, provider.InitializePaymentRequest{
		Email:          email,
		AmountKobo:     amountMinor,
		Reference:      reference,
		CallbackURL:    callbackURL,
		IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		return nil, err
	}

	out := &PaymentIntent{
		InvoiceID:      invoiceID,
		GuardianUserID: guardianUserID,
		Reference:      resp.Reference,
		AmountMinor:    amountMinor,
		IsInstallment:  installment,
	}
	if out.Reference == "" {
		out.Reference = reference
	}
	out.AuthorizationURL = resp.AuthorizationURL
	out.AccessCode = resp.AccessCode
	return out, nil
}

// ── 2) Confirmation path (confirm-and-record; SF-2; end-to-end idempotent) ───────────

// OnChargeSuccess is the confirmation entry point. It is called by the EXISTING academy webhook
// pipeline on a charge.success for a fees reference (the integration task hooks it there — no new
// receiver). Flow:
//
//  1. Resolve the pending intent from the gateway reference (unknown reference ⇒ benign no-op).
//  2. VERIFY the charge via provider.VerifyPayment (fail-closed: not-success ⇒ no money moves).
//  3. Cross-check the verified amount against the intent amount (mismatch ⇒ abort, no move).
//  4. Post the REAL balanced ledger move: guardian wallet → school settlement account, keyed by
//     the intent's idempotency key (TOCTOU-safe + idempotent in the ledger).
//  5. RECORD the invoice-side payment via the invoice recorder with the SAME idempotency key and
//     the ledger reference from step 4 — so the money leg and the invoice record replay together
//     (SF-2: never a balance write; the invoice derives its status from the payment event).
//
// End-to-end idempotency: the shared idempotency key makes step 4 (ledger unique key) and step 5
// (invoice_payments unique key) each idempotent, so a redelivered webhook produces exactly one
// ledger move + one invoice payment. Replayed is surfaced when the invoice recorder reports the
// payment already existed.
func (s *Service) OnChargeSuccess(ctx context.Context, reference, gatewayRef string) (*ConfirmResult, error) {
	rec, err := s.intents.GetByReference(ctx, reference)
	if err != nil {
		// No pending fees intent for this reference — not ours / already GC'd. Benign no-op so
		// the webhook pipeline can move on (and other consumers can claim the reference).
		return nil, ErrUnknownReference
	}

	// Verify the charge with the gateway (fail-closed). We NEVER move money on an unverified
	// or non-success charge.
	status, err := s.gateway.VerifyPayment(ctx, reference)
	if err != nil {
		return nil, err
	}
	if status == nil || strings.ToLower(status.Status) != "success" {
		return nil, ErrChargeNotSuccessful
	}
	// The verified gateway amount must equal what we intend to move + record.
	if status.AmountKobo != rec.AmountMinor {
		return nil, ErrAmountMismatch
	}

	// 4) REAL money move: guardian wallet → school settlement account. Idempotent + fail-closed.
	ledgerRef, err := s.ledger.MoveGuardianToSchool(ctx, rec.GuardianUserID, rec.SchoolID, reference, rec.IdempotencyKey, rec.AmountMinor)
	if err != nil {
		return nil, err
	}

	// 5) Record the invoice-side payment with the SAME idempotency key + the ledger reference, so
	// the money leg and invoice record replay together (SF-2 — record, never mutate a balance).
	effectiveGatewayRef := gatewayRef
	if effectiveGatewayRef == "" {
		effectiveGatewayRef = status.Reference
	}
	invoiceStatus, replayed, err := s.invoice.RecordPayment(ctx, rec.InvoiceID, rec.GuardianUserID, rec.AmountMinor, effectiveGatewayRef, ledgerRef, rec.IdempotencyKey)
	if err != nil {
		return nil, err
	}

	_ = s.intents.MarkConfirmed(ctx, reference)

	return &ConfirmResult{
		InvoiceID:       rec.InvoiceID,
		GuardianUserID:  rec.GuardianUserID,
		Reference:       reference,
		GatewayRef:      effectiveGatewayRef,
		LedgerReference: ledgerRef,
		AmountMinor:     rec.AmountMinor,
		Replayed:        replayed,
		InvoiceStatus:   invoiceStatus,
	}, nil
}
