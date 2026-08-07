package healthscheduling

import (
	"errors"
	"time"
)

// ErrSlotTaken is returned when a booking would collide with an existing active
// appointment for the same provider slot (AP-002).
var ErrSlotTaken = errors.New("scheduling: slot already booked")

// blockingStates are the appointment states that occupy a provider's slot — a new
// booking must not overlap an appointment in any of these. CANCELLED, NO_SHOW,
// COMPLETED, and RESCHEDULED free the slot for re-booking.
var blockingStates = map[State]bool{
	StateRequested:  true,
	StateAccepted:   true,
	StateConfirmed:  true,
	StateInProgress: true,
}

// isBlockingState reports whether an appointment in `s` occupies its slot.
func isBlockingState(s State) bool { return blockingStates[s] }

// blockingStateList returns the blocking states as strings for SQL IN (...).
func blockingStateList() []string {
	return []string{string(StateRequested), string(StateAccepted), string(StateConfirmed), string(StateInProgress)}
}

// slotsOverlap reports whether two half-open time intervals [aStart,aEnd) and
// [bStart,bEnd) intersect. Two appointments conflict iff their slots overlap for
// the same provider. Half-open so back-to-back slots (aEnd == bStart) do NOT
// conflict. This mirrors the SQL guard `a.slot_start < b.slot_end AND a.slot_end >
// b.slot_start` used in Request.
func slotsOverlap(aStart, aEnd, bStart, bEnd time.Time) bool {
	return aStart.Before(bEnd) && bStart.Before(aEnd)
}
