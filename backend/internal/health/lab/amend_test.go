package healthlab

import "testing"

// TS (LR-006 / §4.8): a released result may be re-issued as a versioned correction;
// a result that has not been released yet is corrected via entry, not "amended".
// Pure, deterministic — no I/O.
func TestCanAmendResult(t *testing.T) {
	amendable := map[OrderState]bool{
		StateCreated:         false,
		StateScheduled:       false,
		StateSampleCollected: false,
		StateInTransit:       false,
		StateAccessioned:     false,
		StateProcessing:      false,
		StateResultReady:     false, // entered but not published → correct via entry
		StateEscalated:       false, // still pre-release
		StateReleased:        true,  // published → versioned amendment
		StateClosed:          true,  // post-release terminal → still amendable
	}
	for st, want := range amendable {
		if got := canAmendResult(st); got != want {
			t.Errorf("canAmendResult(%s) = %v, want %v", st, got, want)
		}
	}
}
