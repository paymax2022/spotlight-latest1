package transport

import (
	"errors"
	"net/http"
	"testing"
)

// TestScheduledFSM_LegalTransitions asserts every FROZEN-FSM edge is accepted.
func TestScheduledFSM_LegalTransitions(t *testing.T) {
	legal := []struct{ from, to ScheduledStatus }{
		{SchedScheduled, SchedDispatchPending},
		{SchedScheduled, SchedCancelled},
		{SchedScheduled, SchedExpired},
		{SchedDispatchPending, SchedDispatched},
		{SchedDispatchPending, SchedFailedNoDriver},
		{SchedDispatchPending, SchedCancelled},
		{SchedDispatched, SchedCompleted},
	}
	for _, tc := range legal {
		if !canTransitionScheduled(tc.from, tc.to) {
			t.Errorf("expected %s → %s to be LEGAL", tc.from, tc.to)
		}
		if err := guardScheduled(tc.from, tc.to); err != nil {
			t.Errorf("guardScheduled(%s→%s) returned error for a legal edge: %v", tc.from, tc.to, err)
		}
	}
}

// TestScheduledFSM_IllegalTransitions asserts illegal moves are rejected with a
// typed CodedError (409 INVALID_STATE) — no implicit transitions.
func TestScheduledFSM_IllegalTransitions(t *testing.T) {
	illegal := []struct{ from, to ScheduledStatus }{
		// terminal states have no outgoing edges
		{SchedCompleted, SchedScheduled},
		{SchedCancelled, SchedScheduled},
		{SchedCancelled, SchedDispatched},
		{SchedFailedNoDriver, SchedDispatched},
		{SchedExpired, SchedScheduled},
		// skipping states
		{SchedScheduled, SchedDispatched}, // must go via dispatch_pending
		{SchedScheduled, SchedCompleted},  // can't complete an un-dispatched booking
		{SchedScheduled, SchedFailedNoDriver},
		{SchedDispatchPending, SchedExpired}, // expiry only from scheduled
		{SchedDispatched, SchedCancelled},    // cannot cancel a dispatched booking
		{SchedDispatched, SchedFailedNoDriver},
		// self-transitions are never legal
		{SchedScheduled, SchedScheduled},
		{SchedDispatched, SchedDispatched},
	}
	for _, tc := range illegal {
		if canTransitionScheduled(tc.from, tc.to) {
			t.Errorf("expected %s → %s to be ILLEGAL", tc.from, tc.to)
		}
		err := guardScheduled(tc.from, tc.to)
		if err == nil {
			t.Errorf("guardScheduled(%s→%s) accepted an illegal edge", tc.from, tc.to)
			continue
		}
		var ce *CodedError
		if !errors.As(err, &ce) {
			t.Errorf("guardScheduled(%s→%s) returned non-CodedError: %v", tc.from, tc.to, err)
			continue
		}
		if ce.Status != http.StatusConflict {
			t.Errorf("guardScheduled(%s→%s) status = %d, want 409", tc.from, tc.to, ce.Status)
		}
		if ce.Code != CodeInvalidState {
			t.Errorf("guardScheduled(%s→%s) code = %q, want %q", tc.from, tc.to, ce.Code, CodeInvalidState)
		}
	}
}

// TestScheduledFSM_TerminalStates asserts terminal states are recognized and
// have no outgoing transitions.
func TestScheduledFSM_TerminalStates(t *testing.T) {
	terminal := []ScheduledStatus{SchedCompleted, SchedCancelled, SchedFailedNoDriver, SchedExpired}
	for _, s := range terminal {
		if !isTerminalScheduled(s) {
			t.Errorf("expected %s to be terminal", s)
		}
	}
	nonTerminal := []ScheduledStatus{SchedScheduled, SchedDispatchPending, SchedDispatched}
	for _, s := range nonTerminal {
		if isTerminalScheduled(s) {
			t.Errorf("expected %s to be NON-terminal", s)
		}
	}
}

// TestMaterializationKind maps each mode to the right underlying artifact.
func TestMaterializationKind(t *testing.T) {
	cases := map[string]string{
		"ride_hail": "trip", "ride_share": "trip", "airport_pickup": "trip",
		"parcel_intra": "parcel", "parcel_inter": "parcel",
		"bus":     "bus_ticket",
		"unknown": "",
	}
	for mode, want := range cases {
		if got := materializationKind(mode); got != want {
			t.Errorf("materializationKind(%q) = %q, want %q", mode, got, want)
		}
	}
}
