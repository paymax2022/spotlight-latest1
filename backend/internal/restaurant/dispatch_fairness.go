package restaurant

import (
	"sort"
	"time"
)

// Dispatch fairness + SLA tuning. These bounds shape rider sourcing so a ready order
// reaches a nearby rider quickly (SLA) without repeatedly dumping every order on the
// same one or two riders (fairness).
const (
	// baseDispatchFanOut is how many riders a fresh ready order is offered to.
	baseDispatchFanOut = 7
	// escalatedDispatchFanOut widens the net on a re-dispatch once the SLA target has
	// slipped (more riders, and the load cap is relaxed — see dispatchTuning).
	escalatedDispatchFanOut = 15
	// baseMaxRiderLoad caps how many in-flight deliveries a rider may hold before they
	// are skipped for new offers (protects delivery time + spreads work).
	baseMaxRiderLoad = 3
	// escalatedMaxRiderLoad relaxes the cap when the order is breaching SLA — getting
	// it moving beats perfect load-balancing.
	escalatedMaxRiderLoad = 6

	// dispatchSLATarget is the time-to-assign goal from "ready". Past it an order is
	// "at risk" and a re-dispatch escalates.
	dispatchSLATarget = 2 * time.Minute
	// dispatchSLABreach is when an unassigned order is considered breached (ops-visible).
	dispatchSLABreach = 5 * time.Minute
)

// riderCandidate is one sourcing candidate with the fairness signals: proximity to the
// restaurant, current in-flight load, and when they were last given an order.
type riderCandidate struct {
	RiderID      string
	HasDistance  bool       // false when the restaurant or rider has no pin
	DistanceSq   float64    // squared straight-line distance (monotonic; only compared, never shown)
	ActiveLoad   int        // non-terminal orders currently assigned to this rider
	LastAssigned *time.Time // nil = never assigned (gets fairness priority)
}

// selectFairRiders ranks and trims sourcing candidates. Riders at/over maxLoad are
// filtered out entirely (never pile more onto a saturated rider). The rest are ordered
// so food still reaches the customer fast while work is spread fairly:
//
//  1. known-distance riders before unknown (a pinned rider can be routed);
//  2. nearest first (fresher food);
//  3. lighter current load first (tiebreak among equally-near riders);
//  4. longest-waiting first — never-assigned, then oldest last-assignment (round-robin
//     fairness, and the ONLY signal when neither side has a pin, e.g. no restaurant
//     coordinates — which turns sourcing into a fair rotation instead of the old
//     most-recently-online bias).
//
// It returns at most fanOut candidates and never mutates its input.
func selectFairRiders(cands []riderCandidate, fanOut, maxLoad int) []riderCandidate {
	pool := make([]riderCandidate, 0, len(cands))
	for _, c := range cands {
		if c.ActiveLoad < maxLoad {
			pool = append(pool, c)
		}
	}
	sort.SliceStable(pool, func(i, j int) bool {
		a, b := pool[i], pool[j]
		if a.HasDistance != b.HasDistance {
			return a.HasDistance // known distance ranks ahead of unknown
		}
		if a.HasDistance && a.DistanceSq != b.DistanceSq {
			return a.DistanceSq < b.DistanceSq
		}
		if a.ActiveLoad != b.ActiveLoad {
			return a.ActiveLoad < b.ActiveLoad
		}
		return lastAssignedEarlier(a.LastAssigned, b.LastAssigned)
	})
	if len(pool) > fanOut && fanOut >= 0 {
		pool = pool[:fanOut]
	}
	return pool
}

// lastAssignedEarlier orders never-assigned (nil) first, then by oldest assignment —
// so the rider who has waited longest for work is offered first.
func lastAssignedEarlier(a, b *time.Time) bool {
	if a == nil && b == nil {
		return false
	}
	if a == nil {
		return true // never assigned wins
	}
	if b == nil {
		return false
	}
	return a.Before(*b)
}

// SLAStatus is the dispatch time-to-assign health of an order.
type SLAStatus string

const (
	SLAOnTime   SLAStatus = "on_time"
	SLAAtRisk   SLAStatus = "at_risk"
	SLABreached SLAStatus = "breached"
)

// dispatchSLAStatus computes the time-to-assign health of an order. `elapsed` is
// measured from readyAt to assignedAt when a rider has been assigned (the realized
// time-to-assign), otherwise from readyAt to now (still ticking). A nil readyAt (the
// order never reached "ready") is on_time with zero elapsed — there is no SLA clock yet.
func dispatchSLAStatus(readyAt, assignedAt *time.Time, now time.Time, target, breach time.Duration) (SLAStatus, time.Duration) {
	if readyAt == nil {
		return SLAOnTime, 0
	}
	end := now
	if assignedAt != nil {
		end = *assignedAt
	}
	elapsed := end.Sub(*readyAt)
	if elapsed < 0 {
		elapsed = 0
	}
	switch {
	case elapsed > breach:
		return SLABreached, elapsed
	case elapsed > target:
		return SLAAtRisk, elapsed
	default:
		return SLAOnTime, elapsed
	}
}

// dispatchTuning picks the fan-out + load cap for a (re-)dispatch. The first attempt on
// a fresh order uses the base bounds; once the order has been searching past the SLA
// target (an escalating re-dispatch), it widens the net and relaxes the load cap so a
// stuck order gets moving.
func dispatchTuning(readyAt *time.Time, now time.Time, attempt int) (fanOut, maxLoad int, escalated bool) {
	elapsed := time.Duration(0)
	if readyAt != nil {
		elapsed = now.Sub(*readyAt)
	}
	if attempt > 0 && elapsed > dispatchSLATarget {
		return escalatedDispatchFanOut, escalatedMaxRiderLoad, true
	}
	return baseDispatchFanOut, baseMaxRiderLoad, false
}
