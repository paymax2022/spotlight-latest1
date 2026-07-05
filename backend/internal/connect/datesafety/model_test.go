package connectdatesafety_test

import (
	"testing"

	connectdatesafety "spotlight/backend/internal/connect/datesafety"
)

// TestCheckinStateMachine: only the allowed check-in transitions are permitted;
// illegal jumps and reversals are rejected (guarded transitions).
func TestCheckinStateMachine(t *testing.T) {
	allowed := []struct{ from, to string }{
		{connectdatesafety.StatePlanned, connectdatesafety.StateShared},
		{connectdatesafety.StatePlanned, connectdatesafety.StateCheckedIn},
		{connectdatesafety.StateShared, connectdatesafety.StateCheckedIn},
		{connectdatesafety.StateCheckedIn, connectdatesafety.StateCompleted},
		{connectdatesafety.StateCheckedIn, connectdatesafety.StateMissed},
	}
	for _, tc := range allowed {
		if !connectdatesafety.CanTransition(tc.from, tc.to) {
			t.Errorf("expected %s→%s to be allowed", tc.from, tc.to)
		}
	}

	rejected := []struct{ from, to string }{
		{connectdatesafety.StateCompleted, connectdatesafety.StateCheckedIn}, // no reversal
		{connectdatesafety.StateMissed, connectdatesafety.StateCompleted},    // terminal
		{connectdatesafety.StateShared, connectdatesafety.StatePlanned},      // no backward
		{connectdatesafety.StateCompleted, connectdatesafety.StateCompleted}, // no self-loop
	}
	for _, tc := range rejected {
		if connectdatesafety.CanTransition(tc.from, tc.to) {
			t.Errorf("expected %s→%s to be rejected", tc.from, tc.to)
		}
	}
}
