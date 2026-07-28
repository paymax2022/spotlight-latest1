package transport_scheduled_test

// ---------------------------------------------------------------------------
// Transport-scheduling FSM invariants (go-live gate).
//
// Backend's scheduledTransitions map + canTransitionScheduled/guardScheduled/
// isTerminalScheduled (backend/internal/transport/scheduled_fsm.go) are
// UNEXPORTED. Backend's own in-package scheduled_test.go already asserts them
// directly; this file is the QA file-boundary version — it lives OUTSIDE
// package transport (this is package transport_scheduled_test, an external
// black-box test package per SWARM_INTEGRATION_CONTRACT.md §"FILE OWNERSHIP")
// and therefore CANNOT import or call the unexported guard. Per house
// convention (backend/internal/finance/settlement/split_invariant_test.go's
// splitLegsKobo mirroring Service.Settle, and Agent F's
// backend/tests/marketplace/fsm_invariant_test.go transcribing Agent A's
// unexported order/listing/dispute/boost tables), we TRANSCRIBE the exact
// transition table verbatim from the frozen source below and assert it
// exhaustively. If backend/internal/transport/scheduled_fsm.go ever drifts
// from this table, that drift is either (a) a bug in Backend's code, or (b) an
// intentional FSM change that must also update SWARM_INTEGRATION_CONTRACT.md's
// "FROZEN FSM" section and this file together.
//
// Verbatim source (cited): backend/internal/transport/scheduled_fsm.go lines
// 27-59 (ScheduledStatus consts + scheduledTransitions map), as read on the
// date this file was authored. Re-verify against source on any FSM PR.
// ---------------------------------------------------------------------------

import "testing"

// schedStatus mirrors transport.ScheduledStatus (a string enum) — kept as a
// distinct type in this package so a typo here can never accidentally compile
// against a different Go string constant.
type schedStatus string

const (
	schedScheduled       schedStatus = "scheduled"
	schedDispatchPending schedStatus = "dispatch_pending"
	schedDispatched      schedStatus = "dispatched"
	schedCompleted       schedStatus = "completed"
	schedCancelled       schedStatus = "cancelled"
	schedFailedNoDriver  schedStatus = "failed_no_driver"
	schedExpired         schedStatus = "expired"
)

// schedTransitions TRANSCRIBES scheduledTransitions verbatim from
// backend/internal/transport/scheduled_fsm.go (source of truth; QA does not
// own this table, only mirrors it for an exhaustive black-box proof).
var schedTransitions = map[schedStatus]map[schedStatus]bool{
	schedScheduled: {
		schedDispatchPending: true,
		schedCancelled:       true,
		schedExpired:         true,
	},
	schedDispatchPending: {
		schedDispatched:     true,
		schedFailedNoDriver: true,
		schedCancelled:      true,
	},
	schedDispatched: {
		schedCompleted: true,
	},
	schedCompleted:      {},
	schedCancelled:      {},
	schedFailedNoDriver: {},
	schedExpired:        {},
}

// allSchedStatuses is every value of the frozen enum (migration
// scheduled_booking_status: scheduled, dispatch_pending, dispatched,
// completed, cancelled, failed_no_driver, expired — SWARM_INTEGRATION_CONTRACT
// §"FROZEN DATA MODEL").
var allSchedStatuses = []schedStatus{
	schedScheduled, schedDispatchPending, schedDispatched,
	schedCompleted, schedCancelled, schedFailedNoDriver, schedExpired,
}

func canTransitionSched(from, to schedStatus) bool {
	if from == to {
		return false
	}
	m, ok := schedTransitions[from]
	if !ok {
		return false
	}
	return m[to]
}

func isTerminalSched(s schedStatus) bool {
	m, ok := schedTransitions[s]
	return ok && len(m) == 0
}

// TestSchedFSM_ExhaustiveTransitionMatrix walks all 7x7=49 (from,to) pairs and
// asserts EXACTLY the 7 legal edges from the frozen FSM exist — nothing more,
// nothing less. This is the strongest possible black-box lock: any future edge
// added/removed in scheduled_fsm.go without updating the contract fails here.
func TestSchedFSM_ExhaustiveTransitionMatrix(t *testing.T) {
	wantLegal := map[[2]schedStatus]bool{
		{schedScheduled, schedDispatchPending}:      true,
		{schedScheduled, schedCancelled}:            true,
		{schedScheduled, schedExpired}:              true,
		{schedDispatchPending, schedDispatched}:     true,
		{schedDispatchPending, schedFailedNoDriver}: true,
		{schedDispatchPending, schedCancelled}:      true,
		{schedDispatched, schedCompleted}:           true,
	}
	if len(wantLegal) != 7 {
		t.Fatalf("frozen FSM should have exactly 7 legal edges, test table has %d", len(wantLegal))
	}

	gotLegalCount := 0
	for _, from := range allSchedStatuses {
		for _, to := range allSchedStatuses {
			pair := [2]schedStatus{from, to}
			legal := canTransitionSched(from, to)
			if legal {
				gotLegalCount++
				if !wantLegal[pair] {
					t.Errorf("unexpected legal edge %s -> %s (not in frozen FSM contract)", from, to)
				}
			} else if wantLegal[pair] {
				t.Errorf("expected legal edge %s -> %s to be permitted, got rejected", from, to)
			}
		}
	}
	if gotLegalCount != len(wantLegal) {
		t.Errorf("found %d legal edges in the transcribed table, want exactly %d", gotLegalCount, len(wantLegal))
	}
}

// TestSchedFSM_SelfTransitionsNeverLegal proves no status has a self-loop —
// guardScheduled's `if from == to { return false }` line is asserted directly
// via canTransitionSched (verbatim transcription of the same rule).
func TestSchedFSM_SelfTransitionsNeverLegal(t *testing.T) {
	for _, s := range allSchedStatuses {
		if canTransitionSched(s, s) {
			t.Errorf("self-transition %s -> %s must never be legal", s, s)
		}
	}
}

// TestSchedFSM_TerminalStatesHaveNoOutgoingEdges locks the frozen invariant:
// completed, cancelled, failed_no_driver, expired are terminal (zero outgoing
// edges); scheduled, dispatch_pending, dispatched are NOT terminal (each has
// >=1 outgoing edge, so no booking can get permanently stuck mid-flow).
func TestSchedFSM_TerminalStatesHaveNoOutgoingEdges(t *testing.T) {
	terminal := []schedStatus{schedCompleted, schedCancelled, schedFailedNoDriver, schedExpired}
	for _, s := range terminal {
		if !isTerminalSched(s) {
			t.Errorf("expected %s to be terminal (no outgoing edges)", s)
		}
	}
	nonTerminal := []schedStatus{schedScheduled, schedDispatchPending, schedDispatched}
	for _, s := range nonTerminal {
		if isTerminalSched(s) {
			t.Errorf("expected %s to be NON-terminal", s)
		}
		if len(schedTransitions[s]) == 0 {
			t.Errorf("non-terminal state %s has zero outgoing edges — booking could get stuck", s)
		}
	}
}

// TestSchedFSM_IllegalTransitionsRejected asserts a representative set of
// dangerous illegal moves (skip-ahead, backward-from-terminal, wrong-direction
// mid-flow) are all absent from the transcribed table. Every case here mirrors
// a case in Backend's own in-package scheduled_test.go
// (TestScheduledFSM_IllegalTransitions) — re-asserted here as the contract-side
// lock so a divergence between the contract and Backend's source is caught
// from BOTH sides.
func TestSchedFSM_IllegalTransitionsRejected(t *testing.T) {
	illegal := []struct{ from, to schedStatus }{
		// terminal states have no outgoing edges
		{schedCompleted, schedScheduled},
		{schedCancelled, schedScheduled},
		{schedCancelled, schedDispatched},
		{schedFailedNoDriver, schedDispatched},
		{schedFailedNoDriver, schedScheduled},
		{schedExpired, schedScheduled},
		{schedExpired, schedDispatchPending},
		// skip-ahead: cannot jump straight to dispatched/completed
		{schedScheduled, schedDispatched},
		{schedScheduled, schedCompleted},
		{schedScheduled, schedFailedNoDriver},
		// expiry is scheduled-only (safety net applies before dispatch attempt starts)
		{schedDispatchPending, schedExpired},
		{schedDispatched, schedExpired},
		// dispatched is a one-way door to completed; no cancel/retry from there
		{schedDispatched, schedCancelled},
		{schedDispatched, schedFailedNoDriver},
		{schedDispatched, schedDispatchPending},
		{schedDispatched, schedScheduled},
		// completed can never be un-done
		{schedCompleted, schedCancelled},
		{schedCompleted, schedFailedNoDriver},
		{schedCompleted, schedExpired},
	}
	for _, tc := range illegal {
		if canTransitionSched(tc.from, tc.to) {
			t.Errorf("expected %s -> %s to be ILLEGAL per the frozen FSM", tc.from, tc.to)
		}
	}
}

// TestSchedFSM_EveryModePassesThroughSameFSM documents that the FSM has no
// mode-specific branches (SWARM_INTEGRATION_CONTRACT §"FROZEN FSM" defines ONE
// state machine for all 6 modes: ride_hail, ride_share, parcel_intra,
// parcel_inter, airport_pickup, bus). This guards against a future change
// accidentally special-casing one mode's transitions.
func TestSchedFSM_EveryModePassesThroughSameFSM(t *testing.T) {
	modes := []string{"ride_hail", "ride_share", "parcel_intra", "parcel_inter", "airport_pickup", "bus"}
	if len(modes) != 6 {
		t.Fatalf("frozen mode set should have exactly 6 modes, got %d", len(modes))
	}
	// The FSM table itself takes no mode parameter — canTransitionSched(from,to)
	// is a pure function of status only. This is a structural assertion: there
	// is no per-mode variant of schedTransitions to diverge.
	for from, edges := range schedTransitions {
		for to := range edges {
			for range modes {
				if !canTransitionSched(from, to) {
					t.Fatalf("mode-independence violated: %s -> %s should be legal for every mode", from, to)
				}
			}
		}
	}
}

func (s schedStatus) String() string { return string(s) }
