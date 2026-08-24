package transfers

import (
	"errors"
	"net/http"
	"strings"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

// ---------------------------------------------------------------------------
// Typed error sentinels for the money path.
//
// Each maps to an exact HTTP status in HTTPStatusForError so the handler never
// has to string-match. Iron rule: fail-closed — anything unrecognised is 500.
// ---------------------------------------------------------------------------

var (
	// ErrSelfTransfer — sender == recipient (422).
	ErrSelfTransfer = errors.New("transfers: self-transfer not allowed")
	// ErrRecipientNotFound — no Paymax user for the supplied phone (404).
	ErrRecipientNotFound = errors.New("transfers: recipient not found")
	// ErrInvalidAccount — bank account/code failed resolution (404).
	ErrInvalidAccount = errors.New("transfers: invalid bank account")
	// ErrMissingIdempotencyKey — money mutation without an Idempotency-Key (400).
	ErrMissingIdempotencyKey = errors.New("transfers: Idempotency-Key required")
	// ErrInvalidAmount — non-positive kobo amount (400).
	ErrInvalidAmount = errors.New("transfers: amount must be a positive kobo integer")
	// ErrPinNotSet — money movement attempted before a transaction PIN exists (403).
	ErrPinNotSet = errors.New("transfers: transaction PIN not set")
	// ErrPinInvalid — wrong PIN supplied (403).
	ErrPinInvalid = errors.New("transfers: invalid transaction PIN")
	// ErrPinLocked — too many failed PIN attempts (403).
	ErrPinLocked = errors.New("transfers: transaction PIN locked — try again later")

	// ErrPinCurrentRequired is returned when a PIN already exists and the caller
	// asked to set a new one WITHOUT supplying the current PIN.
	//
	// It exists so this case never reaches pinStore.Verify. An absent current PIN
	// is a malformed request, not a wrong guess: verifying "" fails, and the
	// failure counts toward the 5-attempt lockout. A client that forgets the
	// field can therefore lock a user out of transfers entirely — which is
	// exactly what a mobile PIN screen did, five taps at a time, while never
	// asking for the PIN it was being scored against.
	ErrPinCurrentRequired = errors.New("transfers: current transaction PIN is required to change it")
	// ErrProviderUnavailable — no disbursement provider configured / all failed (502).
	ErrProviderUnavailable = errors.New("transfers: no disbursement provider available")
)

// HTTPStatusForError maps a money-path error to its acceptance-gate HTTP status.
// Unwraps wrapped errors so callers may decorate with %w freely.
//
// Mapping (locked by the go-live gates):
//
//	self-transfer            → 422
//	insufficient funds       → 402
//	tier 0 wallet disabled   → 403
//	daily limit exceeded     → 403
//	recipient / account 404  → 404
//	missing key / bad amount → 400
//	anything else            → 500 (fail closed)
func HTTPStatusForError(err error) int {
	switch {
	case err == nil:
		return http.StatusOK
	case errors.Is(err, ErrSelfTransfer):
		return http.StatusUnprocessableEntity // 422
	case errors.Is(err, ledger.ErrInsufficientFunds):
		return http.StatusPaymentRequired // 402
	case errors.Is(err, tiers.ErrWalletDisabled):
		return http.StatusForbidden // 403
	case errors.Is(err, tiers.ErrDailyLimitExceeded):
		return http.StatusForbidden // 403
	case errors.Is(err, ErrRecipientNotFound):
		return http.StatusNotFound // 404
	case errors.Is(err, ErrInvalidAccount):
		return http.StatusNotFound // 404
	case errors.Is(err, ErrMissingIdempotencyKey):
		return http.StatusBadRequest // 400
	case errors.Is(err, ErrInvalidAmount):
		return http.StatusBadRequest // 400
	case errors.Is(err, ErrPinNotSet):
		return http.StatusForbidden // 403
	case errors.Is(err, ErrPinInvalid):
		return http.StatusForbidden // 403
	case errors.Is(err, ErrPinCurrentRequired):
		return http.StatusBadRequest // 400 — malformed request, NOT a failed guess
	case errors.Is(err, ErrPinLocked):
		return http.StatusForbidden // 403
	case errors.Is(err, ErrProviderUnavailable):
		return http.StatusBadGateway // 502
	default:
		return http.StatusInternalServerError // 500 — fail closed
	}
}

// ErrorCode returns a stable machine-readable code for the API envelope.
func ErrorCode(err error) string {
	switch {
	case errors.Is(err, ErrSelfTransfer):
		return "self_transfer_not_allowed"
	case errors.Is(err, ledger.ErrInsufficientFunds):
		return "insufficient_funds"
	case errors.Is(err, tiers.ErrWalletDisabled):
		return "wallet_disabled"
	case errors.Is(err, tiers.ErrDailyLimitExceeded):
		return "daily_limit_exceeded"
	case errors.Is(err, ErrRecipientNotFound):
		return "recipient_not_found"
	case errors.Is(err, ErrInvalidAccount):
		return "invalid_account"
	case errors.Is(err, ErrMissingIdempotencyKey):
		return "idempotency_key_required"
	case errors.Is(err, ErrInvalidAmount):
		return "invalid_amount"
	case errors.Is(err, ErrPinNotSet):
		return "pin_not_set"
	case errors.Is(err, ErrPinInvalid):
		return "pin_invalid"
	case errors.Is(err, ErrPinCurrentRequired):
		return "pin_current_required"
	case errors.Is(err, ErrPinLocked):
		return "pin_locked"
	case errors.Is(err, ErrProviderUnavailable):
		return "provider_unavailable"
	default:
		return "internal_error"
	}
}

// ValidateWalletTransferRequest runs the DB-free pre-flight checks for a P2P
// transfer. Returns a typed sentinel so the handler maps it to the right status.
func ValidateWalletTransferRequest(req WalletTransferRequest) error {
	if strings.TrimSpace(req.IdempotencyKey) == "" {
		return ErrMissingIdempotencyKey
	}
	if req.AmountKobo <= 0 {
		return ErrInvalidAmount
	}
	if strings.TrimSpace(req.RecipientPhone) == "" {
		return ErrRecipientNotFound
	}
	return nil
}

// ValidateBankTransferRequest runs the DB-free pre-flight checks for a payout.
func ValidateBankTransferRequest(req BankTransferRequest) error {
	if strings.TrimSpace(req.IdempotencyKey) == "" {
		return ErrMissingIdempotencyKey
	}
	if req.AmountKobo <= 0 {
		return ErrInvalidAmount
	}
	if !looksLikeNUBAN(req.AccountNumber) || strings.TrimSpace(req.BankCode) == "" {
		return ErrInvalidAccount
	}
	return nil
}

// looksLikeNUBAN does the cheap structural check (10 numeric digits). Full
// resolution still happens against the provider; this just rejects obvious junk
// before we touch the money path.
func looksLikeNUBAN(acct string) bool {
	acct = strings.TrimSpace(acct)
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

// MaskPhone reveals only the trailing 4 digits of a phone number. Used by the
// resolve endpoint so a caller can confirm the recipient without learning the
// full number of an arbitrary user.
func MaskPhone(phone string) string {
	if len(phone) < 7 {
		return "****"
	}
	return strings.Repeat("*", len(phone)-4) + phone[len(phone)-4:]
}

// ReversalEntry is the balanced pair that restores a user's wallet when a bank
// transfer fails or is reversed. The user-side entry is REVERSAL_DEBIT (which
// the ledger projection counts as +balance), the suspense-side is
// REVERSAL_CREDIT (drains the hold). Corrections are reversing entries only —
// we never UPDATE a balance or post a fresh CREDIT that would misread history.
type ReversalEntry struct {
	Reference         string
	IdempotencyKey    string
	AmountKobo        int64
	UserAccountID     string
	SuspenseAccountID string
	UserEntryType     ledger.EntryType
	SuspenseEntryType ledger.EntryType
	Description       string
}

// BuildReversalEntry constructs the reversing pair for a terminal (failed /
// reversed) bank transfer. The idempotency key is namespaced by terminal status
// so success vs fail can never collide and a duplicate webhook is a no-op at the
// ledger unique-constraint layer.
func BuildReversalEntry(reference, userAccountID, suspenseAccountID string, amountKobo int64, baseIdempotencyKey string, terminal BankTransferStatus) ReversalEntry {
	return ReversalEntry{
		Reference:         reference,
		IdempotencyKey:    baseIdempotencyKey + ":reversal:" + string(terminal),
		AmountKobo:        amountKobo,
		UserAccountID:     userAccountID,
		SuspenseAccountID: suspenseAccountID,
		UserEntryType:     ledger.EntryReversalDebit,
		SuspenseEntryType: ledger.EntryReversalCredit,
		Description:       "bank transfer reversal: " + string(terminal),
	}
}

// ClassifyWebhookStatus maps a Paystack transfer status string to our internal
// enum, and reports whether this status releases reserved funds (failed /
// reversed) and whether the status is one we recognise at all.
func ClassifyWebhookStatus(providerStatus string) (status BankTransferStatus, releasesFunds bool, known bool) {
	switch providerStatus {
	case "successful", "success":
		return BankTransferSuccessful, false, true
	case "failed", "failure":
		return BankTransferFailed, true, true
	case "reversed", "reversal":
		return BankTransferReversed, true, true
	default:
		return "", false, false
	}
}

// NextStatusOnProviderError returns the status a transfer should hold after the
// provider call errors during initiation. Funds stay reserved — never lost,
// never double-debited — until a webhook or reconciliation resolves it.
// For a wallet-source transfer the hold is funds_reserved; for a bank-source
// transfer that has already been funded into provider_clearing, the hold is
// funded (the clearing balance is the parked money).
func NextStatusOnProviderError(current BankTransferStatus) BankTransferStatus {
	if current == BankTransferFunded {
		return BankTransferFunded
	}
	return BankTransferFundsReserved
}

// ---------------------------------------------------------------------------
// Per-leg idempotency key derivation.
//
// Every money leg of a transfer derives a distinct idempotency key from the
// base key (or reference) suffixed by the leg name, so the ledger unique
// constraint makes a duplicate webhook a benign no-op and success vs reversal
// can never collide. These are pure and unit-tested.
// ---------------------------------------------------------------------------

// Leg names for the bank-transfer money path.
const (
	LegReserve  = "reserve"  // wallet→bank: DR wallet → CR suspense
	LegFund     = "fund"     // bank→bank: DR provider_clearing → CR suspense
	LegSettle   = "settle"   // success: DR suspense(amount) → CR settlement
	LegFeeRev   = "fee"      // success: DR suspense(fee) → CR paymax_revenue
	LegReversal = "reversal" // failure/reversed: restore source from suspense
)

// LegKey derives the per-leg idempotency key from a base key and the leg name.
func LegKey(base, leg string) string {
	return base + ":" + leg
}

// CanAdvanceBankToBank guards the bank→bank state machine. A transfer may only
// move forward along: awaiting_funding → funded → provider_initiated →
// successful, with failed/reversed reachable as terminal states. Returns false
// for an illegal (backwards or skipping) transition so the funding webhook can't
// re-fund or re-initiate. Equal states (idempotent replay) return false (no-op).
func CanAdvanceBankToBank(from, to BankTransferStatus) bool {
	rank := map[BankTransferStatus]int{
		BankTransferAwaitingFunding:   1,
		BankTransferFunded:            2,
		BankTransferProviderInitiated: 3,
		BankTransferSuccessful:        4,
	}
	// Terminal failure/reversal may be reached from any non-terminal state.
	if to == BankTransferFailed || to == BankTransferReversed {
		return from != BankTransferSuccessful && from != BankTransferFailed && from != BankTransferReversed
	}
	rf, okF := rank[from]
	rt, okT := rank[to]
	if !okF || !okT {
		return false
	}
	return rt == rf+1
}
