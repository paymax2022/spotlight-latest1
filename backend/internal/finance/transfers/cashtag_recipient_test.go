package transfers

// Cashtag recipients on the wallet-to-wallet rail.
//
// contracts/openapi.yaml has always promised that a transfer recipient can be
// "phone, email, or Paymax username", but only phone and email were ever
// implemented here. These tests pin the missing leg: a `@`/`$`-sigil'd handle
// addresses an account through the cashtag directory, and the money movement
// that follows is the SAME wallet-to-wallet mutation — PIN second factor, tier
// daily limit, fee schedule, one wallet_transfers row — not a different rail.
//
// The sigil is mandatory. A wallet credit cannot be clawed back, so an input
// that is a valid phone number, a valid email and a valid handle at once must
// never be resolved by guessing which one the sender meant. The rail's existing
// answer for "we cannot tell" is to refuse (ErrAmbiguousRecipient); the same
// rule decides that a bare `bisi` is not a cashtag.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/cashtag"
)

func TestParseCashtagRecipient(t *testing.T) {
	cases := []struct {
		name       string
		in         string
		wantHandle string
		wantOK     bool
	}{
		{"at sigil", "@bisi", "bisi", true},
		{"dollar sigil", "$bisi", "bisi", true},
		{"sigil is case folded", "$BISI", "bisi", true},
		{"surrounding spaces are trimmed", "  @Ada_2  ", "ada_2", true},
		{"digits are legal in a handle", "@1234567", "1234567", true},
		{"minimum length", "@bi", "", false},
		{"maximum length is 30", "@" + strings.Repeat("a", 30), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", true},
		{"31 characters is too long", "@" + strings.Repeat("a", 31), "", false},
		{"must start alphanumeric", "@_bisi", "", false},
		{"no punctuation", "@bi!si", "", false},
		{"dots are not handle characters", "@ada.eze", "", false},
		{"sigil alone is nothing", "@", "", false},
		// The negatives that matter: these inputs keep their current meaning.
		{"bare handle is never guessed", "bisi", "", false},
		{"email is not a cashtag", "ada@paymax.com", "", false},
		{"phone is not a cashtag", "08159491618", "", false},
		{"empty", "", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			handle, ok := ParseCashtagRecipient(tc.in)
			if ok != tc.wantOK || handle != tc.wantHandle {
				t.Fatalf("ParseCashtagRecipient(%q) = (%q, %v), want (%q, %v)",
					tc.in, handle, ok, tc.wantHandle, tc.wantOK)
			}
		})
	}
}

// TestValidateWalletTransferRequestAcceptsCashtag: the contract's
// recipient_identifier carries a handle for the POST body too, and a body that
// uses it must not be rejected for a missing recipient_phone.
func TestValidateWalletTransferRequestAcceptsCashtag(t *testing.T) {
	req := WalletTransferRequest{
		RecipientIdentifier: "@bisi",
		AmountKobo:          50_000,
		IdempotencyKey:      "key-1",
	}
	if err := ValidateWalletTransferRequest(req); err != nil {
		t.Fatalf("cashtag recipient body: got %v, want no error", err)
	}
}

// TestEffectiveRecipient: identifier wins, legacy recipient_phone still works,
// and a body carrying neither is still the pinned ErrRecipientNotFound (404) —
// the status decision_test.go already asserts for a missing recipient.
func TestEffectiveRecipient(t *testing.T) {
	if got := (WalletTransferRequest{RecipientIdentifier: "  @bisi "}).EffectiveRecipient(); got != "@bisi" {
		t.Errorf("identifier should be the effective recipient, got %q", got)
	}
	if got := (WalletTransferRequest{RecipientPhone: "08159491618"}).EffectiveRecipient(); got != "08159491618" {
		t.Errorf("legacy recipient_phone must keep working, got %q", got)
	}
	empty := WalletTransferRequest{AmountKobo: 1000, IdempotencyKey: "k"}
	if got := empty.EffectiveRecipient(); got != "" {
		t.Errorf("no recipient supplied: got %q, want empty", got)
	}
	if err := ValidateWalletTransferRequest(empty); !errors.Is(err, ErrRecipientNotFound) {
		t.Errorf("missing recipient: got %v, want ErrRecipientNotFound", err)
	}
}

// TestCashtagLookupFailureKeepsOutageApartFromUnclaimed: "nobody holds this
// handle" and "we could not read the directory" are different answers, and only
// one of them is the sender's fault. The Next BFF already throws 500 for the
// second (wallet-to-wallet.ts); if this rail answers 404 instead, the same
// existing recipient is unclaimable for web users during an outage the app
// shrugs off — and a 404 tells the sender to abandon a payment that would have
// gone through a moment later.
func TestCashtagLookupFailureKeepsOutageApartFromUnclaimed(t *testing.T) {
	cases := []struct {
		name       string
		in         error
		wantStatus int
		want404    bool
	}{
		{"unclaimed handle is a 404", cashtag.ErrNotFound, http.StatusNotFound, true},
		{"directory says missing, wrapped", fmt.Errorf("cashtag: %w", cashtag.ErrNotFound), http.StatusNotFound, true},
		{"claimed handle, no profile row", pgx.ErrNoRows, http.StatusNotFound, true},
		// Everything below is the database failing, not the recipient existing.
		{"pool timeout must not look like an empty directory", fmt.Errorf("cashtag: resolve: %w", context.DeadlineExceeded), http.StatusInternalServerError, false},
		{"cancelled request", context.Canceled, http.StatusInternalServerError, false},
		{"raw driver error", errors.New("conn closed"), http.StatusInternalServerError, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := cashtagLookupFailure(tc.in)
			if status := HTTPStatusForError(got); status != tc.wantStatus {
				t.Errorf("cashtagLookupFailure(%v) → %d, want %d", tc.in, status, tc.wantStatus)
			}
			if is404 := errors.Is(got, ErrRecipientNotFound); is404 != tc.want404 {
				t.Errorf("errors.Is(err, ErrRecipientNotFound) = %v, want %v", is404, tc.want404)
			}
			// An outage must stay diagnosable: the driver's reason has to survive.
			if tc.wantStatus == http.StatusInternalServerError && !errors.Is(got, tc.in) && got != tc.in {
				t.Errorf("outage error %v lost its cause (returned %v)", tc.in, got)
			}
		})
	}
}

// TestResolveByCashtagWithoutDirectoryIsNotAFakeNotFound: an unwired directory is
// a server misconfiguration. Answering "no such recipient" would blame the
// sender's typing for a wiring bug and hide it from ops.
func TestResolveByCashtagWithoutDirectoryIsNotAFakeNotFound(t *testing.T) {
	svc := &Service{} // no SetCashtagDirectory, as a forgotten app-wiring line leaves it
	_, err := svc.ResolvePaymaxUser(context.Background(), "@bisi")
	if status := HTTPStatusForError(err); status != http.StatusInternalServerError {
		t.Errorf("unwired cashtag directory: got %d (%v), want 500 — never a 404 that blames the handle", status, err)
	}
	// It must still never fall through to phone matching: no query is attempted,
	// and s.db is nil here, so a fall-through would panic rather than resolve.
}

// TestPreflightResolvesTheCashtagIdentifier is the money-path guarantee: the
// identifier the sender typed is what reaches recipient resolution. If pre-flight
// kept reading RecipientPhone, a cashtag body would resolve an empty string and
// every handle send would 404 — or, worse, a caller who sent BOTH fields would
// pay the person behind the phone while believing they paid the handle.
func TestPreflightResolvesTheCashtagIdentifier(t *testing.T) {
	var resolvedWith string
	transfer, recipient, err := walletPreflight{
		findReplay: func(context.Context, string) (*WalletTransfer, error) { return nil, nil },
		verifyPIN:  func(context.Context, string, string) error { return nil },
		resolve: func(_ context.Context, identifier string) (*WalletTransferResolveResponse, error) {
			resolvedWith = identifier
			return &WalletTransferResolveResponse{UserID: "u-ada", FullName: "Ada Eze"}, nil
		},
		enforceTier: func(context.Context, string, int64) error { return nil },
	}.run(context.Background(), "u-femi", WalletTransferRequest{
		RecipientIdentifier: "@ada",
		AmountKobo:          10_000,
		IdempotencyKey:      "key-1",
	})
	if err != nil {
		t.Fatalf("preflight: got %v, want success", err)
	}
	if transfer != nil {
		t.Fatalf("no replay was seeded, got %v", transfer)
	}
	if recipient == nil {
		t.Fatal("preflight must return the resolved recipient")
	}
	if resolvedWith != "@ada" {
		t.Errorf("resolution received %q, want the cashtag the sender typed (@ada)", resolvedWith)
	}
}

// TestPreflightCashtagSelfSendIsRefused: resolving through the directory lands
// on the same self-transfer guard the phone leg uses, so paying your own handle
// cannot mint a zero-movement transfer row.
func TestPreflightCashtagSelfSendIsRefused(t *testing.T) {
	_, _, err := walletPreflight{
		findReplay: func(context.Context, string) (*WalletTransfer, error) { return nil, nil },
		verifyPIN:  func(context.Context, string, string) error { return nil },
		resolve: func(context.Context, string) (*WalletTransferResolveResponse, error) {
			return &WalletTransferResolveResponse{UserID: "u-femi"}, nil
		},
		enforceTier: func(context.Context, string, int64) error { return nil },
	}.run(context.Background(), "u-femi", WalletTransferRequest{
		RecipientIdentifier: "@femi",
		AmountKobo:          10_000,
		IdempotencyKey:      "key-1",
	})
	if !errors.Is(err, ErrSelfTransfer) {
		t.Fatalf("self-send by cashtag: got %v, want ErrSelfTransfer (422)", err)
	}
}
