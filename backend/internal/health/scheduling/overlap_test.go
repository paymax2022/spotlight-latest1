package healthscheduling

import (
	"testing"
	"time"
)

// TS-4 AP-002 (double-booking / slot race). Pure, deterministic assertions on the
// slot-conflict predicate the booking guard uses — no DB.

func at(h, m int) time.Time { return time.Date(2026, 7, 30, h, m, 0, 0, time.UTC) }

func TestSlotsOverlap(t *testing.T) {
	cases := []struct {
		name           string
		aS, aE, bS, bE time.Time
		want           bool
	}{
		{"identical slot", at(9, 0), at(9, 30), at(9, 0), at(9, 30), true},
		{"partial overlap", at(9, 0), at(9, 30), at(9, 15), at(9, 45), true},
		{"b inside a", at(9, 0), at(10, 0), at(9, 15), at(9, 45), true},
		{"a inside b", at(9, 15), at(9, 45), at(9, 0), at(10, 0), true},
		{"back-to-back (no overlap)", at(9, 0), at(9, 30), at(9, 30), at(10, 0), false},
		{"disjoint before", at(9, 0), at(9, 30), at(10, 0), at(10, 30), false},
		{"disjoint after", at(11, 0), at(11, 30), at(10, 0), at(10, 30), false},
	}
	for _, c := range cases {
		if got := slotsOverlap(c.aS, c.aE, c.bS, c.bE); got != c.want {
			t.Errorf("%s: slotsOverlap = %v, want %v", c.name, got, c.want)
		}
	}
}

// Only live appointments occupy a slot; cancelled/no-show/completed/rescheduled
// free it for re-booking.
func TestIsBlockingState(t *testing.T) {
	want := map[State]bool{
		StateRequested: true, StateAccepted: true, StateConfirmed: true, StateInProgress: true,
		StateCancelled: false, StateNoShow: false, StateCompleted: false, StateRescheduled: false,
	}
	for st, w := range want {
		if got := isBlockingState(st); got != w {
			t.Errorf("isBlockingState(%s) = %v, want %v", st, got, w)
		}
	}
}
