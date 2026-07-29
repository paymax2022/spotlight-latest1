package healthconsult

import "testing"

// TS-5 TM-008 (follow-up scheduling from a consult). Pure decision: a follow-up may
// only be scheduled once the originating consult is under way or done.
func TestCanScheduleFollowUp(t *testing.T) {
	allowed := map[State]bool{
		StateScheduled:       false, // consult hasn't happened yet
		StateIntakePending:   false,
		StateReadyForConsult: false,
		StateInProgress:      true, // during the consult
		StateCompleted:       true, // after the consult
	}
	for st, want := range allowed {
		if got := canScheduleFollowUp(st); got != want {
			t.Errorf("canScheduleFollowUp(%s) = %v, want %v", st, got, want)
		}
	}
}
