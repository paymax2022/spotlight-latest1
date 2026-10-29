package crypto

// =============================================================================
// TDD PLACEHOLDER - NOT THE IMPLEMENTATION.
//
// This file defines ONLY the proposed API surface for crypto wallet-to-wallet
// transfer (contracts/openapi.yaml: POST /transfers/paymax/crypto,
// operationId initiateCryptoWalletToWalletTransfer, schema CryptoWalletTransfer)
// so the red-phase tests in transfer_wallet_*_test.go compile and FAIL with
// errNotImplemented instead of failing to build.
//
// The implementation PR must DELETE this file and replace it with
// transfer_wallet.go (+ repository/handler files). The no-float and
// ledger-immutability source-scan tests look for transfer_wallet*.go
// (excluding this stub and *_test.go) and fail while none exists.
//
// PROPOSED SCHEMA (additive migration, to be written by the implementer):
//   crypto_wallet_transfers(id, reference, sender_id, recipient_id, asset_id,
//       units bigint, fee_units bigint, ngn_value_kobo bigint, narration,
//       status, idempotency_key, request_hash, created_at,
//       UNIQUE(sender_id, idempotency_key))
//   crypto_ledger_entries(id, transfer_id, user_id, asset_id,
//       direction 'DEBIT'|'CREDIT', units bigint, idempotency_key, created_at)
//       -- immutable (UPDATE/DELETE blocked by trigger); one DEBIT + one CREDIT
//       -- of equal units per transfer, a reversal is a NEW pair.
//   audit row in crypto_audit_log, action "crypto.wallet_transfer".
// =============================================================================

import (
	"context"
	"errors"
	"sync"
	"time"

	"spotlight/backend/internal/finance/tiers"
)

// errNotImplemented is what every placeholder returns (red phase).
var errNotImplemented = errors.New("crypto: wallet transfer not implemented (TDD placeholder)")

// Proposed sentinel errors.
var (
	ErrPinRequired            = errors.New("crypto: transaction PIN required")                   // 400, never verified
	ErrPinInvalid             = errors.New("crypto: invalid transaction PIN")                    // 403, counts toward lockout
	ErrAMLRefused             = errors.New("crypto: transfer refused by AML screening")          // 403
	ErrInsufficientHoldings   = errors.New("crypto: insufficient holdings")                      // 402 insufficient_holdings
	ErrSelfTransfer           = errors.New("crypto: cannot transfer to yourself")                // 422 self_transfer
	ErrAmbiguousRecipient     = errors.New("crypto: recipient identifier is ambiguous")          // 409 ambiguous_recipient
	ErrIdempotencyConflict    = errors.New("crypto: idempotency key reused with different body") // 409
	ErrIdempotencyKeyRequired = errors.New("crypto: Idempotency-Key required")                   // 400
	ErrTransfersDisabled      = errors.New("crypto: wallet transfers disabled")                  // 503
	ErrInvalidUnits           = errors.New("crypto: units is not a plain decimal string")        // 422
	ErrUnitsNotPositive       = errors.New("crypto: units must be greater than zero")            // 422
	ErrUnitsPrecision         = errors.New("crypto: units finer than asset minor-unit scale")    // 422
)

// TransferFlags mirrors FEATURE_CRYPTO_ENABLED and
// FEATURE_CRYPTO_WALLET_TRANSFERS_ENABLED. The zero value is OFF (fail closed).
type TransferFlags struct {
	CryptoEnabled          bool
	WalletTransfersEnabled bool
}

// PINVerifier verifies the caller's transaction PIN; a wrong PIN returns
// ErrPinInvalid (and bumps the lockout counter inside the verifier).
type PINVerifier interface {
	VerifyPin(ctx context.Context, userID, pin string) error
}

// TransferScreener is the crypto AML screen, called BEFORE any debit with the
// sender, recipient and amount. A non-nil error refuses (ErrAMLRefused for a
// policy refusal; any other error is also fail-closed).
type TransferScreener interface {
	ScreenTransfer(ctx context.Context, senderID, recipientID, assetSymbol string, minorUnits, ngnValueKobo int64) error
}

// RecipientResolver resolves phone/email/username to a user id using the same
// rules as /transfers/paymax. ErrNotFound => 404, ErrAmbiguousRecipient => 409.
type RecipientResolver interface {
	ResolveRecipient(ctx context.Context, identifier string) (userID, displayName string, err error)
}

// TransferCommand is what the service hands the store to execute atomically.
type TransferCommand struct {
	SenderID, RecipientID string
	AssetID, AssetSymbol  string
	MinorUnits            int64 // asset minor units (integer, never float)
	NgnValueKobo          int64
	Narration             string
	IdempotencyKey        string
	RequestHash           string // canonical hash of recipient+asset+units+narration (NOT the pin)
}

// TransferRecord is the persisted transfer.
type TransferRecord struct {
	ID, Reference, SenderID, RecipientID string
	AssetSymbol                          string
	MinorUnits, FeeMinorUnits            int64
	NgnValueKobo                         int64
	Narration                            *string
	Status                               string // successful|failed|reversed
	ReceiverDisplayName                  *string
	CreatedAt                            time.Time
}

// TransferStore is the atomic persistence seam. Execute MUST, in ONE tx:
// dedupe on (SenderID, IdempotencyKey) (same hash => replayed=true, different
// hash => ErrIdempotencyConflict), fail ErrInsufficientHoldings without moving
// anything, post the balanced DEBIT/CREDIT pair, move both holding projections,
// and write the audit event. Reverse posts a NEW opposite pair (never edits).
type TransferStore interface {
	LookupAsset(ctx context.Context, symbol string) (*Asset, error) // ErrNotFound if unknown
	Execute(ctx context.Context, cmd TransferCommand) (rec *TransferRecord, replayed bool, err error)
	Reverse(ctx context.Context, transferID, actorID, reason, idempotencyKey string) (*TransferRecord, error)
}

// TransferDeps groups the injectable seams. Store nil => pgx-backed default
// (implementation PR); the other seams have no default and fail closed if nil.
type TransferDeps struct {
	PIN      PINVerifier
	AML      TransferScreener
	Resolver RecipientResolver
	Store    TransferStore
	Flags    TransferFlags
}

// TransferInput is the service-level request.
type TransferInput struct {
	SenderID            string
	RecipientIdentifier string
	Asset               string // symbol
	Units               string // decimal string, whole-asset units
	PIN                 string // empty => ErrPinRequired
	Narration           string
	IdempotencyKey      string
}

// TransferResult mirrors schema CryptoWalletTransfer plus already_processed.
type TransferResult struct {
	ID                  string
	Reference           string
	Asset               string
	Units               string // decimal string
	FeeUnits            string // decimal string ("0" until a fee schedule exists)
	NgnValueKobo        int64
	Narration           *string
	Status              string
	ReceiverDisplayName *string
	CreatedAt           time.Time
	AlreadyProcessed    bool
}

// The real implementation adds a field on Service; the placeholder cannot touch
// service.go, so deps live in a side table keyed by *Service.
var transferDepsBySvc sync.Map

// WithTransferDeps installs the transfer seams (wiring / tests). Chainable.
func (s *Service) WithTransferDeps(d TransferDeps) *Service {
	transferDepsBySvc.Store(s, d)
	return s
}

// ParseUnitsToMinor converts a plain decimal string in whole-asset units to
// integer asset minor units using integer/big arithmetic only. Rejections:
// ErrInvalidUnits (format, exponent, sign, whitespace, overflow),
// ErrUnitsNotPositive (zero), ErrUnitsPrecision (finer than scale).
func ParseUnitsToMinor(units string, scale int64) (int64, error) {
	return 0, errNotImplemented
}

// FormatMinorUnits renders asset minor units as a minimal decimal string
// ("12.5", "0.000001", "0") without floats.
func FormatMinorUnits(minor, scale int64) string { return "" }

// TransferHoldings executes the wallet-to-wallet transfer described by the spec.
func (s *Service) TransferHoldings(ctx context.Context, in TransferInput) (*TransferResult, error) {
	return nil, errNotImplemented
}

// ReverseTransfer posts a reversal (new opposite pair) for a transfer.
func (s *Service) ReverseTransfer(ctx context.Context, transferID, actorID, reason, idempotencyKey string) (*TransferResult, error) {
	return nil, errNotImplemented
}

// TransferErrorStatus maps a transfer error to (HTTP status, error code) per the
// OpenAPI responses. Unknown errors map to (500, "internal_error").
func TransferErrorStatus(err error) (int, string) {
	_ = tiers.ErrWalletDisabled // the real mapping covers tier refusals (403)
	return 0, ""
}
