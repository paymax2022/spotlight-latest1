package ledger

import "testing"

// Pins the reward state machine: earned → pending → vesting → eligible → paid
// is the only forward chain; 'clawed_back' is reachable from every prior state;
// 'paid' is terminal.
func TestForwardTransitions(t *testing.T) {
	legal := [][2]string{
		{StateEarned, StatePending},
		{StateEarned, StateClawedBack},
		{StatePending, StateVesting},
		{StatePending, StateClawedBack},
		{StateVesting, StateEligible},
		{StateVesting, StateClawedBack},
		{StateEligible, StatePaid},
		{StateEligible, StateClawedBack},
		{StatePaid, StateClawedBack},
	}
	for _, tc := range legal {
		if !forwardTransitions[tc[0]][tc[1]] {
			t.Errorf("expected %s → %s to be legal", tc[0], tc[1])
		}
	}

	illegal := [][2]string{
		{StateEarned, StatePaid},       // cannot skip vesting/eligibility
		{StatePending, StatePaid},      // cannot skip eligibility
		{StateVesting, StatePaid},      // cannot skip eligibility
		{StatePaid, StateEarned},       // paid is terminal (no un-paying)
		{StateClawedBack, StatePaid},   // clawed-back is terminal
		{StateClawedBack, StateEarned}, // no resurrection
		{StateEligible, StateEarned},   // no backward moves
		{StatePaid, StateEligible},
	}
	for _, tc := range illegal {
		if forwardTransitions[tc[0]][tc[1]] {
			t.Errorf("expected %s → %s to be ILLEGAL", tc[0], tc[1])
		}
	}
}
