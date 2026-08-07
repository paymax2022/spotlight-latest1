package healthlab

import "testing"

// TS-11 LR-004: a result is released only after authorized validation — i.e. only
// from a validated RESULT_READY (or already-ESCALATED) order, never from an
// un-validated state, and never re-released. Pure, deterministic assertions on the
// order state machine + release gate — no DB.

// canReleaseFrom permits exactly the two post-validation states.
func TestCanReleaseFrom(t *testing.T) {
	releasable := map[OrderState]bool{
		StateResultReady: true, StateEscalated: true,
		// everything before results are validated, and every terminal state, is not:
		StateCreated: false, StateScheduled: false, StateSampleCollected: false,
		StateInTransit: false, StateAccessioned: false, StateProcessing: false,
		StateReleased: false, StateClosed: false, StateCancelled: false, StateRefunded: false,
	}
	for st, want := range releasable {
		if got := canReleaseFrom(st); got != want {
			t.Errorf("canReleaseFrom(%s) = %v, want %v", st, got, want)
		}
	}
}

// LR-004 core: results can only reach RELEASED from a validated (RESULT_READY) or
// escalated order — never straight from PROCESSING or any pre-validation state.
func TestReleaseOnlyFromValidatedState(t *testing.T) {
	if !canTransitionOrder(StateResultReady, StateReleased) {
		t.Fatal("a validated RESULT_READY order must be releasable")
	}
	if !canTransitionOrder(StateEscalated, StateReleased) {
		t.Fatal("an ESCALATED order must be releasable (after human review)")
	}
	for _, from := range []OrderState{StateProcessing, StateAccessioned, StateSampleCollected, StateScheduled, StateCreated} {
		if canTransitionOrder(from, StateReleased) {
			t.Fatalf("must NOT release directly from un-validated state %s", from)
		}
	}
}

// No double / re-release, and terminal states are terminal (attribution + funds
// only ever fire once on the single RESULT_READY/ESCALATED → RELEASED edge).
func TestNoReReleaseTerminal(t *testing.T) {
	if canTransitionOrder(StateReleased, StateReleased) {
		t.Fatal("a released order must not be re-released")
	}
	if !canTransitionOrder(StateReleased, StateClosed) {
		t.Fatal("RELEASED must be able to CLOSE")
	}
	if canTransitionOrder(StateClosed, StateReleased) || len(allowedOrderTransitions[StateClosed]) != 0 {
		t.Fatal("CLOSED is terminal")
	}
}

// The critical-value path is available: a critical RESULT_READY escalates first,
// then releases (HL-7 escalate-before-release), and a non-critical RESULT_READY may
// release directly.
func TestEscalateBeforeReleasePathExists(t *testing.T) {
	if !canTransitionOrder(StateResultReady, StateEscalated) {
		t.Fatal("RESULT_READY must be able to ESCALATE (critical value path)")
	}
	if !canTransitionOrder(StateEscalated, StateReleased) {
		t.Fatal("ESCALATED must be able to RELEASE after review")
	}
}

// The full validated lifecycle is reachable edge-by-edge (no orphaned states).
func TestOrderLifecycleChain(t *testing.T) {
	chain := []OrderState{
		StateCreated, StateScheduled, StateSampleCollected, StateAccessioned,
		StateProcessing, StateResultReady, StateReleased, StateClosed,
	}
	for i := 0; i+1 < len(chain); i++ {
		if !canTransitionOrder(chain[i], chain[i+1]) {
			t.Fatalf("lifecycle edge %s -> %s must be allowed", chain[i], chain[i+1])
		}
	}
}
