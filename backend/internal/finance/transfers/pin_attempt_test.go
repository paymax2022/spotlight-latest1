package transfers

import (
	"errors"
	"net/http"
	"testing"
)

// A wrong PIN is now wrapped so the customer can be told how many tries remain.
// Wrapping is only safe while errors.Is still matches the sentinel — every HTTP
// status and error code in this package is selected that way, so a break here
// would silently turn a 403 "pin_invalid" into a 500 with no code at all.
func TestPinAttemptErrorStillMatchesSentinel(t *testing.T) {
	err := error(&PinAttemptError{Err: ErrPinInvalid, Remaining: 2})

	if !errors.Is(err, ErrPinInvalid) {
		t.Fatal("errors.Is must still match ErrPinInvalid, or the status mapping breaks")
	}
	if got := HTTPStatusForError(err); got != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", got, http.StatusForbidden)
	}
	if got := ErrorCode(err); got != "pin_invalid" {
		t.Fatalf("code = %q, want %q", got, "pin_invalid")
	}
	if err.Error() != ErrPinInvalid.Error() {
		t.Fatalf("message changed: %q", err.Error())
	}
}

// errors.As is what the handler uses to read the count back out.
func TestPinAttemptErrorCarriesRemaining(t *testing.T) {
	var attempt *PinAttemptError
	if !errors.As(error(&PinAttemptError{Err: ErrPinInvalid, Remaining: 2}), &attempt) {
		t.Fatal("errors.As must extract the attempt error")
	}
	if attempt.Remaining != 2 {
		t.Fatalf("Remaining = %d, want 2", attempt.Remaining)
	}
}

// A lockout is NOT an attempt error: there is nothing left to count, and telling
// the customer "0 attempts remaining" alongside a lock reads as a second failure.
func TestLockoutIsNotAnAttemptError(t *testing.T) {
	var attempt *PinAttemptError
	if errors.As(ErrPinLocked, &attempt) {
		t.Fatal("ErrPinLocked must not carry an attempt count")
	}
	if got := ErrorCode(ErrPinLocked); got != "pin_locked" {
		t.Fatalf("code = %q, want pin_locked", got)
	}
}

// The threshold the count is derived from. If maxPinFailures moves, the message
// the customer sees moves with it.
func TestRemainingIsDerivedFromTheThreshold(t *testing.T) {
	for failedSoFar, want := range map[int]int{0: 4, 1: 3, 2: 2, 3: 1} {
		if got := maxPinFailures - (failedSoFar + 1); got != want {
			t.Fatalf("after %d failures: remaining = %d, want %d", failedSoFar, got, want)
		}
	}
}
