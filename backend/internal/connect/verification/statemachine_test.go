package connectverification

import "testing"

// The verification state machine must reject illegal transitions
// (architecture.md §26.5): none → pending → l0_passed → l1_passed | failed | rejected.
func TestVerificationStateMachine(t *testing.T) {
	ok := [][2]string{
		{StatusNone, StatusPending},
		{StatusPending, StatusL0Passed},
		{StatusPending, StatusL1Passed},
		{StatusL0Passed, StatusL1Passed},
		{StatusPending, StatusFailed},
		{StatusFailed, StatusPending},
		{StatusL1Passed, StatusL1Passed}, // idempotent re-assert
	}
	for _, c := range ok {
		if !canTransition(c[0], c[1]) {
			t.Errorf("expected %s → %s to be allowed", c[0], c[1])
		}
	}
	bad := [][2]string{
		{StatusNone, StatusL1Passed},     // cannot skip straight to verified
		{StatusL1Passed, StatusL0Passed}, // no downgrade
		{StatusRejected, StatusPending},  // rejected is terminal
		{StatusL0Passed, StatusNone},     // cannot regress to none
	}
	for _, c := range bad {
		if canTransition(c[0], c[1]) {
			t.Errorf("expected %s → %s to be rejected", c[0], c[1])
		}
	}
}
