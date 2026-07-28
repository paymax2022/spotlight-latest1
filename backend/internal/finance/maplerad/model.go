// Package maplerad is the Maplerad WaaS DOMAIN layer (ADR-012, NGN v1).
//
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

// ── Domain errors (mapped to HTTP by the handler) ───────────────────────────

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
)

// RequiredTransferTier is the minimum KYC tier to move money out via Maplerad.
// Tier 1 (BVN verified) is the regulated minimum, mirroring the VA gate.
const RequiredTransferTier = 1

// ── Domain request/result models (never provider DTOs) ──────────────────────

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
