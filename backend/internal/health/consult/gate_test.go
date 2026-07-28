package healthconsult

import "testing"

// gate_test.go — the pre-consult intake gate (ADR-010). The gate is a one-way door:
// once a consult is moved to INTAKE_PENDING (on prompt), IN_PROGRESS is unreachable
// except via READY_FOR_CONSULT (which only intake submit produces). The legacy
// direct SCHEDULED → IN_PROGRESS edge is kept for non-intake flows (vet), so it is
// the INTAKE_PENDING node — not SCHEDULED — that enforces "no consult on empty
// intake".

func TestGate_InProgressUnreachableFromIntakePending(t *testing.T) {
	if canTransition(StateIntakePending, StateInProgress) {
		t.Fatal("INTAKE_PENDING → IN_PROGRESS must be illegal (intake not submitted)")
	}
}

func TestGate_InProgressReachableFromReady(t *testing.T) {
	if !canTransition(StateReadyForConsult, StateInProgress) {
		t.Fatal("READY_FOR_CONSULT → IN_PROGRESS must be legal")
	}
}

func TestGate_LegacyDirectStartKept(t *testing.T) {
	// Non-intake (vet) flow: SCHEDULED → IN_PROGRESS must remain legal (brownfield).
	if !canTransition(StateScheduled, StateInProgress) {
		t.Fatal("SCHEDULED → IN_PROGRESS must remain legal for non-intake flows")
	}
}

func TestGate_HappyPath(t *testing.T) {
	steps := []struct{ from, to State }{
		{StateScheduled, StateIntakePending},
		{StateIntakePending, StateReadyForConsult},
		{StateReadyForConsult, StateInProgress},
		{StateInProgress, StateCompleted},
	}
	for _, s := range steps {
		if !canTransition(s.from, s.to) {
			t.Fatalf("expected legal transition %s → %s", s.from, s.to)
		}
	}
}

func TestGate_NoSkippingIntake(t *testing.T) {
	// Cannot jump SCHEDULED straight to READY_FOR_CONSULT either.
	if canTransition(StateScheduled, StateReadyForConsult) {
		t.Fatal("SCHEDULED → READY_FOR_CONSULT must be illegal")
	}
}
