package invest

// Wave-10 sweep: Deposit/Withdraw are money mutations and MUST refuse a missing
// caller Idempotency-Key with ErrInvalidOrder (handler errMap → 400), the same
// contract Buy/Sell/ApplyPublicOffer/AcceptRightsIssue already enforce. They
// previously synthesized "invdep:<user>:<ns>" / "invwd:<user>:<ns>" server-side
// when the caller omitted one — a key-less client retry then became a second,
// REAL debit/credit, the exact failure the header exists to prevent.
//
// DB-free: the key check precedes every pool/verifier touch, so a nil-pool
// service exercises the real code path.

import (
	"context"
	"errors"
	"testing"
)

func TestDeposit_MissingIdempotencyKey_Refused(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil)
	_, err := svc.Deposit(context.Background(), "u-1", "", 100_000, "paymax_wallet")
	if !errors.Is(err, ErrInvalidOrder) {
		t.Fatalf("Deposit without Idempotency-Key: got %v, want ErrInvalidOrder", err)
	}
}

func TestWithdraw_MissingIdempotencyKey_Refused(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil)
	_, err := svc.Withdraw(context.Background(), "u-1", "", 100_000, "paymax_wallet", "1234")
	if !errors.Is(err, ErrInvalidOrder) {
		t.Fatalf("Withdraw without Idempotency-Key: got %v, want ErrInvalidOrder", err)
	}
}

// The key check runs BEFORE the PIN verifier: a malformed request must never
// burn a PIN-verification attempt (lockout counters are real side effects).
func TestWithdraw_MissingKey_DoesNotReachPINVerifier(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil)
	var pinCalls int
	svc.SetPINVerifier(pinVerifierFunc(func(_ context.Context, _, _ string) error {
		pinCalls++
		return nil
	}))
	if _, err := svc.Withdraw(context.Background(), "u-1", "", 100_000, "paymax_wallet", "1234"); !errors.Is(err, ErrInvalidOrder) {
		t.Fatalf("expected ErrInvalidOrder, got %v", err)
	}
	if pinCalls != 0 {
		t.Fatalf("PIN verifier called %d times for a key-less request — must be 0", pinCalls)
	}
}

// Compile-time seam: the verifier fake satisfies the PINVerifier port.
type pinVerifierFunc func(ctx context.Context, userID, pin string) error

func (f pinVerifierFunc) Verify(ctx context.Context, userID, pin string) error {
	return f(ctx, userID, pin)
}
