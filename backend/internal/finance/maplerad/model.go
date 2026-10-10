// Package maplerad is the Maplerad WaaS DOMAIN layer (ADR-012, NGN v1).
// INVARIANT 1 — this package imports ONLY the gateway ports in
// `spotlight/backend/internal/provider`. It never imports
// `spotlight/backend/internal/provider/maplerad` (the adapter) or any Maplerad
// SDK/HTTP type. All provider interaction is through the ports below.
package maplerad

import (
	"errors"

	"spotlight/backend/internal/provider"
)

// Gateway is the composite of the provider ports this domain service consumes.
// The Maplerad adapter (internal/provider/maplerad.Client) satisfies all of
// these; the domain depends only on the interface, never the concrete client.
type Gateway interface {
	provider.IdentityProvider
	provider.WalletProvider
	provider.VirtualAccountProvider
	provider.DisbursementProvider
	provider.BillsProvider
}

var (
	// ErrTierTooLow — the user has not reached the required KYC tier (gate is
	// enforced BEFORE any adapter call; invariant 7). 403.
	ErrTierTooLow = errors.New("maplerad: required KYC tier not reached")
	// ErrProviderUnavailable — Maplerad gateway not configured. 503.
	ErrProviderUnavailable = errors.New("maplerad: provider not configured")
	// ErrMissingRef — a money op was attempted without a client reference. 400.
	ErrMissingRef = errors.New("maplerad: client reference (ref) required")
	// ErrInvalidAmount — non-positive kobo amount. 400.
	ErrInvalidAmount = errors.New("maplerad: amount must be a positive kobo integer")
	// ErrInvalidAccount — bank code / NUBAN failed validation. 404.
	ErrInvalidAccount = errors.New("maplerad: invalid destination account")
	// ErrNotFound — no provider_reference / customer row for the lookup. 404.
	ErrNotFound = errors.New("maplerad: not found")
	// ErrForbidden — object-level authz: caller does not own the resource. 403.
	ErrForbidden = errors.New("maplerad: not authorized for this resource")
	// ErrIllegalTransition — a guarded state transition was rejected. 409.
	ErrIllegalTransition = errors.New("maplerad: illegal state transition")
	// ErrLedgerReconPending — a ledger leg key was claimed duplicate but no
	// durable legs back the claim (bare Redis-lock replay). Retryable: the
	// caller must retry, never proceed as though the journal posted. 503-class.
	ErrLedgerReconPending = errors.New("maplerad: ledger leg not durably posted — retry")
)

// RequiredTransferTier is the minimum KYC tier to move money out via Maplerad.
// Tier 1 (BVN verified) is the regulated minimum, mirroring the VA gate.
const RequiredTransferTier = 1

// TransferRequest is a member-initiated bank payout via Maplerad.
type TransferRequest struct {
	BankCode      string
	AccountNumber string
	AmountKobo    int64
	Narration     string
	Ref           string // client reference = ledger posting ref = provider_reference.ref
	PIN           string // optional second factor (verified upstream if set)
}

// TransferRecord is the domain view of a provider_reference transfer row.
type TransferRecord struct {
	Ref           string   `json:"ref"`
	ProviderRef   string   `json:"provider_ref,omitempty"`
	Status        OpStatus `json:"status"`
	UserID        string   `json:"user_id"`
	AmountKobo    int64    `json:"amount_kobo"`
	FeeKobo       int64    `json:"fee_kobo"`
	Currency      string   `json:"currency"`
	BankCode      string   `json:"bank_code,omitempty"`
	AccountLast4  string   `json:"account_number_last4,omitempty"`
	FailureReason string   `json:"failure_reason,omitempty"`
}

// BillResult is the domain view of a bill purchase resolution.
type BillResult struct {
	Ref         string   `json:"ref"`
	ProviderRef string   `json:"provider_ref,omitempty"`
	Type        string   `json:"type"`
	Status      OpStatus `json:"status"`
	AmountKobo  int64    `json:"amount_kobo"`
}

// TransferFee returns the Maplerad transfer fee (kobo) for an amount. Same
// banded schedule as the existing bank-transfer fee so pricing stays consistent.
func TransferFee(amountKobo int64) int64 {
	switch {
	case amountKobo <= 500_000:
		return 1_000
	case amountKobo <= 5_000_000:
		return 2_500
	default:
		return 5_000
	}
}

// looksLikeNUBAN does the cheap 10-digit structural check before any money path.
func looksLikeNUBAN(acct string) bool {
	if len(acct) != 10 {
		return false
	}
	for _, r := range acct {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// validate is the DB-free pre-flight for a transfer request.
func (r TransferRequest) validate() error {
	if r.Ref == "" {
		return ErrMissingRef
	}
	if r.AmountKobo <= 0 {
		return ErrInvalidAmount
	}
	if !looksLikeNUBAN(r.AccountNumber) || r.BankCode == "" {
		return ErrInvalidAccount
	}
	return nil
}

// last4 returns the trailing 4 digits of an account number (for storage; never
// the full PAN/NUBAN in logs).
func last4(acct string) string {
	if len(acct) <= 4 {
		return acct
	}
	return acct[len(acct)-4:]
}

// kycRecord is the BVN/NIN-bearing identity forwarded to the Identity port. It
// is read from the KYC store at customer-creation time and NEVER logged.
type kycRecord struct {
	FirstName string
	LastName  string
	Email     string
	Phone     string
	BVN       string
	NIN       string
}

// State machine for the Maplerad money-op state row (provider_reference.status).
// This file is PURE LOGIC — no DB, no network, no provider types. It is the
// locked, unit-tested core that every transition (sync initiate, webhook,
// orphan sweep) must pass through. The ledger effect of each transition is
// described declaratively here; the service applies it (statemachine never
// touches the ledger itself).

// OpStatus mirrors provider_reference.status (the migration CHECK constraint).
type OpStatus string

const (
	StatusInitiated OpStatus = "INITIATED"
	StatusPending   OpStatus = "PENDING"
	StatusSuccess   OpStatus = "SUCCESS"
	StatusFailed    OpStatus = "FAILED"
	StatusReversed  OpStatus = "REVERSED"
)

// IsTerminal reports whether a status is final (no further transition allowed).
func (s OpStatus) IsTerminal() bool {
	return s == StatusSuccess || s == StatusFailed || s == StatusReversed
}

// LedgerEffect names the ledger action a transition implies. The service maps
// each to concrete postings; the state machine only decides which one applies.
type LedgerEffect string

const (
	// EffectNone — no ledger movement (e.g. INITIATED→PENDING is the hold, but
	// the hold posting is driven by EffectHold; a no-op replay is EffectNone).
	EffectNone LedgerEffect = ""
	// EffectHold — INITIATED→PENDING: DR user_wallet → CR failed_transfer_suspense.
	EffectHold LedgerEffect = "hold"
	// EffectFinalize — PENDING→SUCCESS: DR suspense → CR settlement (+fee → revenue).
	EffectFinalize LedgerEffect = "finalize"
	// EffectReverseHold — PENDING→FAILED (and PENDING→REVERSED): the funds are
	// still held in suspense, so PostReversal restores user_wallet and drains suspense.
	EffectReverseHold LedgerEffect = "reverse_hold"
	// EffectCompensate — SUCCESS→REVERSED: a transfer that already SETTLED is
	// recalled/charged-back by the provider AFTER success; compensate the settled
	// debit (restore user_wallet, drain settlement).
	EffectCompensate LedgerEffect = "compensate"
)

// TransitionResult is the pure decision for one attempted transition.
type TransitionResult struct {
	// Allowed is true when the (from→to) edge is a legal forward transition.
	Allowed bool
	// NoOp is true when the transition is a benign idempotent replay (from==to,
	// or replaying a terminal that already matches the requested terminal). The
	// service must treat NoOp as success-with-no-ledger-effect.
	NoOp bool
	// Effect is the ledger action to apply (only meaningful when Allowed && !NoOp).
	Effect LedgerEffect
}

// DecideTransition is the single guard for the transfer/bill state machine.
// Legal forward edges:
//
//	INITIATED → PENDING                      (post the hold)
//	PENDING   → SUCCESS | FAILED | REVERSED  (finalize / reverse-hold / reverse-hold)
//	SUCCESS   → REVERSED                     (provider recall/chargeback after settle)
//
// Everything else is rejected — terminal states are truly terminal, and a
// terminal can only be reached via PENDING.
// REVERSED effect depends on the prior state: from PENDING funds are still in
// suspense (EffectReverseHold); from SUCCESS the settled debit must be
// compensated (EffectCompensate). Idempotent replays (from == to) return
// NoOp=true, Allowed=true.
func DecideTransition(from, to OpStatus) TransitionResult {
	// Idempotent replay of the same state is always a benign no-op.
	if from == to {
		return TransitionResult{Allowed: true, NoOp: true, Effect: EffectNone}
	}

	switch from {
	case StatusInitiated:
		// Only INITIATED→PENDING is legal; INITIATED→<terminal> is rejected
		// (terminal MUST be reached via the PENDING webhook path).
		if to == StatusPending {
			return TransitionResult{Allowed: true, Effect: EffectHold}
		}
		return TransitionResult{Allowed: false}
	case StatusPending:
		switch to {
		case StatusSuccess:
			return TransitionResult{Allowed: true, Effect: EffectFinalize}
		case StatusFailed:
			return TransitionResult{Allowed: true, Effect: EffectReverseHold}
		case StatusReversed:
			// Reversal before settlement: funds are still in suspense → undo the
			// hold (restore wallet, drain suspense), NOT a settled-debit compensation.
			return TransitionResult{Allowed: true, Effect: EffectReverseHold}
		default:
			return TransitionResult{Allowed: false}
		}
	case StatusSuccess:
		// A SETTLED transfer can still be reversed by the provider (recall/
		// chargeback); that webhook arrives after success. Compensate the settled
		// debit. Every other move out of SUCCESS is rejected.
		if to == StatusReversed {
			return TransitionResult{Allowed: true, Effect: EffectCompensate}
		}
		return TransitionResult{Allowed: false}
	default:
		// FAILED and REVERSED are truly terminal — nothing moves out of them.
		return TransitionResult{Allowed: false}
	}
}

// NormalizeWebhookStatus maps a provider webhook status string to our OpStatus
// terminal, reporting whether it is recognized. Pure + unit-tested so an
// unexpected status never silently drives a transition.
func NormalizeWebhookStatus(providerStatus string) (OpStatus, bool) {
	switch providerStatus {
	case "success", "successful", "completed", "SUCCESS":
		return StatusSuccess, true
	case "failed", "failure", "declined", "FAILED":
		return StatusFailed, true
	case "reversed", "reversal", "refunded", "REVERSED":
		return StatusReversed, true
	case "pending", "processing", "PENDING":
		return StatusPending, true
	default:
		return "", false
	}
}

// LegKey derives a per-leg idempotency key from the base ref + leg name so each
// ledger posting (hold / finalize / fee / reversal) is uniquely keyed and a
// duplicate webhook is a benign ledger-unique-constraint no-op. Pure.
func LegKey(ref, leg string) string {
	return ref + ":" + leg
}

// Leg names for the Maplerad transfer money path.
const (
	LegHold       = "hold"       // INITIATED→PENDING: DR wallet → CR suspense
	LegSettle     = "settle"     // SUCCESS: DR suspense(amount) → CR settlement
	LegFee        = "fee"        // SUCCESS: DR suspense(fee) → CR paymax_revenue
	LegReversal   = "reversal"   // FAILED: restore wallet from suspense
	LegCompensate = "compensate" // REVERSED: compensating reversal of a settled debit
)
