package transfers_test

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/transfers"
)

// ---------------------------------------------------------------------------
// Wallet P2P + Bank transfer go-live invariants.
//
// These tests exercise the *pure* decision surface of the transfers package
// (validation + error→HTTP mapping + reversal-entry shape). They require no DB
// and lock in the acceptance gates from the playbook:
//
//	flag-off → 503, resolve → masked phone, self-transfer → 422,
//	insufficient → 402, Tier 0 → 403, daily-limit → 403,
//	invalid account → 404, idempotency replay → already_processed,
//	provider-fail keeps funds_reserved, REVERSAL_DEBIT restores balance.
// ---------------------------------------------------------------------------

// TestHTTPStatusForError maps every money-path error to its acceptance-gate
// HTTP status. This is the single source of truth the handler must obey.
func TestHTTPStatusForError(t *testing.T) {
	cases := []struct {
		name     string
		err      error
		wantCode int
	}{
		{"self transfer", transfers.ErrSelfTransfer, http.StatusUnprocessableEntity},    // 422
		{"insufficient funds", ledger.ErrInsufficientFunds, http.StatusPaymentRequired}, // 402
		{"tier 0 wallet disabled", tiers.ErrWalletDisabled, http.StatusForbidden},       // 403
		{"daily limit exceeded", tiers.ErrDailyLimitExceeded, http.StatusForbidden},     // 403
		{"recipient not found", transfers.ErrRecipientNotFound, http.StatusNotFound},    // 404
		{"invalid bank account", transfers.ErrInvalidAccount, http.StatusNotFound},      // 404
		{"missing idempotency key", transfers.ErrMissingIdempotencyKey, http.StatusBadRequest},
		{"wrapped insufficient", fmt.Errorf("transfers: %w", ledger.ErrInsufficientFunds), http.StatusPaymentRequired},
		{"wrapped tier0", fmt.Errorf("tiers: enforce (fail closed): %w", tiers.ErrWalletDisabled), http.StatusForbidden},
		// 400, NOT 403. A missing current PIN is a malformed request; scoring it
		// as a wrong guess is what let a client lock users out of transfers.
		{"missing current pin", transfers.ErrPinCurrentRequired, http.StatusBadRequest},
		{"wrong pin is still a guess", transfers.ErrPinInvalid, http.StatusForbidden},
		{"unknown internal error", errors.New("db exploded"), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := transfers.HTTPStatusForError(tc.err)
			if got != tc.wantCode {
				t.Fatalf("HTTPStatusForError(%v) = %d, want %d", tc.err, got, tc.wantCode)
			}
		})
	}
}

// TestValidateWalletTransferRequest enforces the pre-flight rules that don't
// need a DB: idempotency key required, positive kobo amount, recipient phone.
func TestValidateWalletTransferRequest(t *testing.T) {
	good := transfers.WalletTransferRequest{
		RecipientPhone: "08012345678",
		AmountKobo:     100_000,
		IdempotencyKey: "idem-1",
	}
	if err := transfers.ValidateWalletTransferRequest(good); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}

	missingKey := good
	missingKey.IdempotencyKey = ""
	if err := transfers.ValidateWalletTransferRequest(missingKey); !errors.Is(err, transfers.ErrMissingIdempotencyKey) {
		t.Fatalf("missing idempotency key: got %v, want ErrMissingIdempotencyKey", err)
	}

	zeroAmount := good
	zeroAmount.AmountKobo = 0
	if err := transfers.ValidateWalletTransferRequest(zeroAmount); !errors.Is(err, transfers.ErrInvalidAmount) {
		t.Fatalf("zero amount: got %v, want ErrInvalidAmount", err)
	}

	negAmount := good
	negAmount.AmountKobo = -500
	if err := transfers.ValidateWalletTransferRequest(negAmount); !errors.Is(err, transfers.ErrInvalidAmount) {
		t.Fatalf("negative amount: got %v, want ErrInvalidAmount", err)
	}

	noPhone := good
	noPhone.RecipientPhone = ""
	if err := transfers.ValidateWalletTransferRequest(noPhone); !errors.Is(err, transfers.ErrRecipientNotFound) {
		t.Fatalf("missing phone: got %v, want ErrRecipientNotFound", err)
	}
}

// TestValidateBankTransferRequest enforces bank-transfer pre-flight rules.
func TestValidateBankTransferRequest(t *testing.T) {
	good := transfers.BankTransferRequest{
		AccountNumber:  "0123456789",
		BankCode:       "058",
		AmountKobo:     200_000,
		IdempotencyKey: "idem-bt-1",
	}
	if err := transfers.ValidateBankTransferRequest(good); err != nil {
		t.Fatalf("valid bank request rejected: %v", err)
	}

	missingKey := good
	missingKey.IdempotencyKey = ""
	if err := transfers.ValidateBankTransferRequest(missingKey); !errors.Is(err, transfers.ErrMissingIdempotencyKey) {
		t.Fatalf("missing idempotency key: got %v, want ErrMissingIdempotencyKey", err)
	}

	badAcct := good
	badAcct.AccountNumber = "123" // not 10 digits
	if err := transfers.ValidateBankTransferRequest(badAcct); !errors.Is(err, transfers.ErrInvalidAccount) {
		t.Fatalf("short account number: got %v, want ErrInvalidAccount", err)
	}

	noBank := good
	noBank.BankCode = ""
	if err := transfers.ValidateBankTransferRequest(noBank); !errors.Is(err, transfers.ErrInvalidAccount) {
		t.Fatalf("missing bank code: got %v, want ErrInvalidAccount", err)
	}
}

// TestMaskPhone verifies resolve never leaks the full phone number.
func TestMaskPhone(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"08012345678", "*******5678"},
		{"2348012345678", "*********5678"},
		{"12345", "****"}, // too short to mask meaningfully
		{"", "****"},
	}
	for _, tc := range cases {
		got := transfers.MaskPhone(tc.in)
		if got != tc.want {
			t.Errorf("MaskPhone(%q) = %q, want %q", tc.in, got, tc.want)
		}
		// Invariant: last 4 digits are the only digits ever revealed.
		if len(tc.in) >= 7 {
			if got[len(got)-4:] != tc.in[len(tc.in)-4:] {
				t.Errorf("MaskPhone(%q) must preserve only the last 4 digits", tc.in)
			}
			for i := 0; i < len(got)-4; i++ {
				if got[i] != '*' {
					t.Errorf("MaskPhone(%q)=%q leaked a digit at position %d", tc.in, got, i)
				}
			}
		}
	}
}

// TestReversalEntryRestoresBalance verifies that a failed/reversed bank transfer
// posts a REVERSAL_DEBIT to the user wallet — which the ledger projection treats
// as a positive (balance-restoring) entry — NOT a fresh CREDIT/DEBIT pair that
// would mis-state transaction history.
func TestReversalEntryRestoresBalance(t *testing.T) {
	rev := transfers.BuildReversalEntry("bt-ref-1", "user-acct", "suspense-acct", 201_000, "idem-1", transfers.BankTransferFailed)

	// The entry that lands on the USER wallet must be REVERSAL_DEBIT (balance up).
	if rev.UserEntryType != ledger.EntryReversalDebit {
		t.Fatalf("user-side entry = %q, want REVERSAL_DEBIT", rev.UserEntryType)
	}
	// The suspense counter-entry must be REVERSAL_CREDIT (drains the hold).
	if rev.SuspenseEntryType != ledger.EntryReversalCredit {
		t.Fatalf("suspense-side entry = %q, want REVERSAL_CREDIT", rev.SuspenseEntryType)
	}
	// Balanced: both sides carry the same positive amount.
	if rev.AmountKobo != 201_000 || rev.AmountKobo <= 0 {
		t.Fatalf("reversal amount = %d, want 201000 positive", rev.AmountKobo)
	}
	// Idempotency key namespaced by terminal status so success+fail can't collide
	// and a duplicate webhook is a no-op at the unique-constraint layer.
	if rev.IdempotencyKey == "idem-1" {
		t.Fatalf("reversal idempotency key must be namespaced, got raw %q", rev.IdempotencyKey)
	}
	if rev.UserAccountID != "user-acct" || rev.SuspenseAccountID != "suspense-acct" {
		t.Fatalf("reversal account wiring incorrect: %+v", rev)
	}
}

// TestWebhookStatusTransition locks the provider→internal status mapping and the
// rule that only failed/reversed terminal states release reserved funds.
func TestWebhookStatusTransition(t *testing.T) {
	cases := []struct {
		providerStatus string
		wantStatus     transfers.BankTransferStatus
		wantRelease    bool
		wantKnown      bool
	}{
		{"successful", transfers.BankTransferSuccessful, false, true},
		{"failed", transfers.BankTransferFailed, true, true},
		{"reversed", transfers.BankTransferReversed, true, true},
		{"pending", "", false, false},
		{"garbage", "", false, false},
	}
	for _, tc := range cases {
		got, release, known := transfers.ClassifyWebhookStatus(tc.providerStatus)
		if known != tc.wantKnown {
			t.Errorf("ClassifyWebhookStatus(%q) known=%v, want %v", tc.providerStatus, known, tc.wantKnown)
		}
		if known && got != tc.wantStatus {
			t.Errorf("ClassifyWebhookStatus(%q) status=%q, want %q", tc.providerStatus, got, tc.wantStatus)
		}
		if release != tc.wantRelease {
			t.Errorf("ClassifyWebhookStatus(%q) release=%v, want %v", tc.providerStatus, release, tc.wantRelease)
		}
	}
}

// TestProviderFailureKeepsFundsReserved verifies that when the provider call
// fails at initiation time (before any webhook), the transfer stays in
// funds_reserved — funds are held, never lost, never double-debited.
func TestProviderFailureKeepsFundsReserved(t *testing.T) {
	// On provider error during initiation, the next state is still funds_reserved
	// (a later webhook or reconciliation moves it to successful/failed).
	next := transfers.NextStatusOnProviderError(transfers.BankTransferFundsReserved)
	if next != transfers.BankTransferFundsReserved {
		t.Fatalf("provider error must keep funds_reserved, got %q", next)
	}
}
