package transport

import (
	"fmt"
	"net/http"
)

// ─── Scheduled-booking FSM ───────────────────────────────────────────────────
//
// FROZEN state machine (SWARM_INTEGRATION_CONTRACT.md §"FROZEN FSM"):
//
//   scheduled        --(scheduler: pickup_at - lead_time ≤ now)--> dispatch_pending
//   dispatch_pending --(materialize via mode service + escrow OK)--> dispatched
//   dispatch_pending --(no driver / mode error, attempts exhausted)--> failed_no_driver
//   dispatched       --(underlying trip/parcel/bus completes)--> completed
//   scheduled|dispatch_pending --(user or admin cancel)--> cancelled
//   scheduled        --(pickup_at passed with no dispatch, safety net)--> expired
//
// Illegal transitions return a typed CodedError (CodeInvalidState). There are NO
// implicit transitions — every status change routes through guardScheduled first.

// ScheduledStatus is the lifecycle status of a scheduled booking. Mirrors the
// scheduled_booking_status Postgres enum exactly (migration
// 20260906000000_transport_scheduled_bookings.sql).
type ScheduledStatus string

const (
	SchedScheduled       ScheduledStatus = "scheduled"
	SchedDispatchPending ScheduledStatus = "dispatch_pending"
	SchedDispatched      ScheduledStatus = "dispatched"
	SchedCompleted       ScheduledStatus = "completed"
	SchedCancelled       ScheduledStatus = "cancelled"
	SchedFailedNoDriver  ScheduledStatus = "failed_no_driver"
	SchedExpired         ScheduledStatus = "expired"
)

// scheduledTransitions is the ONLY source of truth for legal moves. Any pair not
// listed here is rejected. Terminal states (completed, cancelled,
// failed_no_driver, expired) have no outgoing edges.
var scheduledTransitions = map[ScheduledStatus]map[ScheduledStatus]bool{
	SchedScheduled: {
		SchedDispatchPending: true, // scheduler: due for dispatch
		SchedCancelled:       true, // user/admin cancel
		SchedExpired:         true, // safety-net: pickup_at passed, never dispatched
	},
	SchedDispatchPending: {
		SchedDispatched:     true, // materialized + escrowed
		SchedFailedNoDriver: true, // no driver / mode error, attempts exhausted
		SchedCancelled:      true, // user/admin cancel mid-dispatch
	},
	SchedDispatched: {
		SchedCompleted: true, // underlying trip/parcel/bus completed
	},
	// terminal — no outgoing transitions:
	SchedCompleted:      {},
	SchedCancelled:      {},
	SchedFailedNoDriver: {},
	SchedExpired:        {},
}

// canTransitionScheduled reports whether moving from→to is a legal FSM edge.
// A self-transition (from == to) is never legal.
func canTransitionScheduled(from, to ScheduledStatus) bool {
	if from == to {
		return false
	}
	m, ok := scheduledTransitions[from]
	if !ok {
		return false
	}
	return m[to]
}

// isTerminalScheduled reports whether a status has no legal outgoing transition.
func isTerminalScheduled(s ScheduledStatus) bool {
	m, ok := scheduledTransitions[s]
	return ok && len(m) == 0
}

// guardScheduled returns a typed CodedError (409 INVALID_STATE) when from→to is
// not an allowed FSM edge, and nil when it is. Every scheduled-booking status
// mutation MUST call this before writing — there are no implicit transitions.
func guardScheduled(from, to ScheduledStatus) error {
	if canTransitionScheduled(from, to) {
		return nil
	}
	return codedErr(http.StatusConflict, CodeInvalidState,
		fmt.Sprintf("illegal scheduled-booking transition %s → %s", from, to))
}
