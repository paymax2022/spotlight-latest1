package transfers

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Wallet-to-wallet PRE-FLIGHT ORDER.
//
// The idempotency replay lookup used to run AFTER recipient resolution and the
// tier guard. Replaying an already-completed transfer therefore re-ran both,
// and either could refuse: the daily cap now counts the very transfer being
// replayed (403), and a recipient whose number has since become ambiguous
// answers 409. The caller is then told its completed transfer failed.
//
// A replay can only ever wrongly REFUSE — the money moved on the first call, and
// wallet_transfers.idempotency_key is UNIQUE, so nothing here can double-spend.
// But "your transfer failed" about a transfer that succeeded is the kind of
// answer that makes a user send it a second time with a fresh key.
//
// The order below is the invariant; these tests fail if anyone reorders it.
// ---------------------------------------------------------------------------

func fixedRequest() WalletTransferRequest {
	return WalletTransferRequest{
		RecipientPhone: "08159491618",
		AmountKobo:     500_00,
		IdempotencyKey: "key-1",
	}
}

// recordingPreflight builds a preflight whose seams append to a call log.
func recordingPreflight(t *testing.T, calls *[]string, replay *WalletTransfer, resolveErr, tierErr error) walletPreflight {
	t.Helper()
	return walletPreflight{
		findReplay: func(_ context.Context, key string) (*WalletTransfer, error) {
			*calls = append(*calls, "findReplay")
			return replay, nil
		},
		resolve: func(_ context.Context, _ string) (*WalletTransferResolveResponse, error) {
			*calls = append(*calls, "resolve")
			if resolveErr != nil {
				return nil, resolveErr
			}
			return &WalletTransferResolveResponse{UserID: "recipient-id", FullName: "Ada Obi"}, nil
		},
		enforceTier: func(_ context.Context, _ string, _ int64) error {
			*calls = append(*calls, "enforceTier")
			return tierErr
		},
	}
}

// TestPreflightReplayShortCircuits is the fix: a replay must be detected BEFORE
// anything that can refuse it.
func TestPreflightReplayShortCircuits(t *testing.T) {
	var calls []string
	prior := &WalletTransfer{ID: "wt-1", Reference: "ww-original"}
	p := recordingPreflight(t, &calls, prior,
		ErrAmbiguousRecipient,            // resolve would now refuse
		errors.New("daily cap exceeded"), // and so would the tier guard
	)

	replay, recipient, err := p.run(context.Background(), "sender-id", fixedRequest())
	if err != nil {
		t.Fatalf("replay must not surface an error, got %v", err)
	}
	if replay == nil || replay.ID != "wt-1" {
		t.Fatalf("replay = %+v, want the prior transfer wt-1", replay)
	}
	if recipient != nil {
		t.Errorf("replay must not resolve a recipient, got %+v", recipient)
	}
	if got := strings.Join(calls, ","); got != "findReplay" {
		t.Errorf("calls = %q, want only findReplay — resolve/tier must not run on a replay", got)
	}
}

// TestPreflightFreshOrder pins the order for a first-time request.
func TestPreflightFreshOrder(t *testing.T) {
	var calls []string
	p := recordingPreflight(t, &calls, nil, nil, nil)

	replay, recipient, err := p.run(context.Background(), "sender-id", fixedRequest())
	if err != nil {
		t.Fatalf("unexpected error %v", err)
	}
	if replay != nil {
		t.Fatalf("no prior transfer, but got replay %+v", replay)
	}
	if recipient == nil || recipient.UserID != "recipient-id" {
		t.Fatalf("recipient = %+v, want recipient-id", recipient)
	}
	if got := strings.Join(calls, ","); got != "findReplay,resolve,enforceTier" {
		t.Errorf("calls = %q, want findReplay,resolve,enforceTier", got)
	}
}

// TestPreflightValidationRunsFirst: a malformed request must never reach the DB.
func TestPreflightValidationRunsFirst(t *testing.T) {
	var calls []string
	p := recordingPreflight(t, &calls, nil, nil, nil)

	req := fixedRequest()
	req.IdempotencyKey = "" // money mutation without a key
	if _, _, err := p.run(context.Background(), "sender-id", req); !errors.Is(err, ErrMissingIdempotencyKey) {
		t.Fatalf("got %v, want ErrMissingIdempotencyKey", err)
	}
	if len(calls) != 0 {
		t.Errorf("calls = %v, want none — validation must precede every lookup", calls)
	}
}

// TestPreflightSelfTransferStopsBeforeTier: refusing a self-transfer must not
// consume any part of the tier allowance.
func TestPreflightSelfTransferStopsBeforeTier(t *testing.T) {
	var calls []string
	p := recordingPreflight(t, &calls, nil, nil, nil)
	p.resolve = func(_ context.Context, _ string) (*WalletTransferResolveResponse, error) {
		calls = append(calls, "resolve")
		return &WalletTransferResolveResponse{UserID: "sender-id"}, nil
	}

	if _, _, err := p.run(context.Background(), "sender-id", fixedRequest()); !errors.Is(err, ErrSelfTransfer) {
		t.Fatalf("got %v, want ErrSelfTransfer", err)
	}
	if got := strings.Join(calls, ","); got != "findReplay,resolve" {
		t.Errorf("calls = %q, want findReplay,resolve — tier guard must not run", got)
	}
}

// TestPreflightResolveErrorPropagates: an ambiguous recipient (409) surfaces
// unchanged and stops before the tier guard.
func TestPreflightResolveErrorPropagates(t *testing.T) {
	var calls []string
	p := recordingPreflight(t, &calls, nil, ErrAmbiguousRecipient, nil)

	if _, _, err := p.run(context.Background(), "sender-id", fixedRequest()); !errors.Is(err, ErrAmbiguousRecipient) {
		t.Fatalf("got %v, want ErrAmbiguousRecipient", err)
	}
	if got := strings.Join(calls, ","); got != "findReplay,resolve" {
		t.Errorf("calls = %q, want findReplay,resolve", got)
	}
}
