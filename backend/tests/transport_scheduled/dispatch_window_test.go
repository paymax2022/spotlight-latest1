package transport_scheduled_test

// ---------------------------------------------------------------------------
// DueForDispatch / ExpireStale window predicates.
//
// Both are SQL WHERE-clause predicates evaluated inside Postgres
// (backend/internal/transport/scheduled_dispatch.go); no Go-level branch
// exists to unit test directly. This file transcribes each predicate verbatim
// and proves the boundary behavior the contract depends on, so the SQL text
// itself is the thing a reviewer diffs against these comments on any future
// change.
//
// Cited verbatim, DueForDispatch:
//
//	WHERE status='scheduled'
//	  AND scheduled_pickup_at - make_interval(mins => lead_time_minutes) <= now()
//	ORDER BY scheduled_pickup_at ASC LIMIT $1
//
// Cited verbatim, ExpireStale:
//
//	const grace = 15 * time.Minute
//	WHERE status='scheduled' AND scheduled_pickup_at < now() - $1::interval
// ---------------------------------------------------------------------------

import (
	"testing"
	"time"
)

const expireGrace = 15 * time.Minute // transcribed from ExpireStale's `grace`

// isDueForDispatch transcribes the DueForDispatch WHERE predicate (status
// check happens at the query/caller level; this isolates the TIME predicate:
// scheduled_pickup_at - lead_time_minutes <= now()).
func isDueForDispatch(pickupAt time.Time, leadMinutes int, now time.Time) bool {
	dispatchAt := pickupAt.Add(-time.Duration(leadMinutes) * time.Minute)
	return !dispatchAt.After(now) // dispatchAt <= now
}

// isExpiredStale transcribes the ExpireStale WHERE predicate:
// scheduled_pickup_at < now() - grace.
func isExpiredStale(pickupAt, now time.Time) bool {
	return pickupAt.Before(now.Add(-expireGrace))
}

// TestDueForDispatch_FiresExactlyAtLeadWindowBoundary proves the boundary is
// inclusive (<=): a booking becomes due the INSTANT pickup-lead reaches now(),
// not one tick later — matters because the contract requires materialization
// to start AT the lead time, not after it.
func TestDueForDispatch_FiresExactlyAtLeadWindowBoundary(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name    string
		pickup  time.Time
		lead    int
		wantDue bool
	}{
		{"exactly at boundary (dispatch time == now)", now.Add(30 * time.Minute), 30, true},
		{"1 second past boundary (overdue)", now.Add(30*time.Minute - time.Second), 30, true},
		{"1 second before boundary (not yet due)", now.Add(30*time.Minute + time.Second), 30, false},
		{"far in the future", now.Add(6 * time.Hour), 30, false},
		{"already past pickup entirely", now.Add(-1 * time.Hour), 30, true},
		{"zero lead time — due only once pickup itself has arrived", now.Add(-time.Second), 0, true},
		{"zero lead time, pickup still ahead", now.Add(time.Second), 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isDueForDispatch(tc.pickup, tc.lead, now); got != tc.wantDue {
				t.Errorf("isDueForDispatch(pickup=%s, lead=%d) = %v, want %v", tc.pickup, tc.lead, got, tc.wantDue)
			}
		})
	}
}

// TestDueForDispatch_PerModeDefaultLeadTimes cross-checks the per-mode
// defaults (from materialization_test.go's defaultLeadMinutes) against the
// due-window predicate — e.g. a bus booking (120 min default) becomes due
// materially earlier before pickup than a ride_hail booking (30 min default).
func TestDueForDispatch_PerModeDefaultLeadTimes(t *testing.T) {
	now := time.Now()
	pickup := now.Add(100 * time.Minute)
	// ride_hail (lead 30): dispatch at now+70min -> NOT due yet.
	if isDueForDispatch(pickup, defaultLeadMinutes("ride_hail"), now) {
		t.Error("ride_hail booking 100min out with 30min lead should not be due yet")
	}
	// bus (lead 120): dispatch at now-20min -> already due.
	if !isDueForDispatch(pickup, defaultLeadMinutes("bus"), now) {
		t.Error("bus booking 100min out with 120min lead should already be due (lead exceeds time-to-pickup)")
	}
}

// TestExpireStale_OnlyFiresAfterGracePeriod proves the 15-minute grace margin:
// a booking whose pickup has JUST passed (within grace) is not yet expired —
// giving DispatchScheduled a window to still succeed — but once grace elapses
// with no dispatch, it is stale.
func TestExpireStale_OnlyFiresAfterGracePeriod(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name        string
		pickup      time.Time
		wantExpired bool
	}{
		{"pickup 1 minute ago (within grace)", now.Add(-1 * time.Minute), false},
		{"pickup exactly at grace boundary", now.Add(-expireGrace), false}, // strict "<", not "<="
		{"pickup 1 second past grace", now.Add(-expireGrace - time.Second), true},
		{"pickup 1 hour ago (well past grace)", now.Add(-1 * time.Hour), true},
		{"pickup in the future", now.Add(1 * time.Hour), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isExpiredStale(tc.pickup, now); got != tc.wantExpired {
				t.Errorf("isExpiredStale(pickup=%s) = %v, want %v", tc.pickup, got, tc.wantExpired)
			}
		})
	}
}

// TestExpireStale_NeverAppliesToNonScheduledStatus documents that ExpireStale's
// WHERE clause filters status='scheduled' — a dispatch_pending/dispatched
// booking, even if wildly overdue (e.g. stuck mid-materialization), is NEVER
// touched by ExpireStale; that path is exclusively onDispatchFailure's job.
// Cross-checked against the FSM: expired is reachable only from scheduled
// (see fsm_invariant_test.go TestSchedFSM_IllegalTransitionsRejected).
func TestExpireStale_NeverAppliesToNonScheduledStatus(t *testing.T) {
	if canTransitionSched(schedDispatchPending, schedExpired) {
		t.Fatal("dispatch_pending must never transition to expired — that path belongs to onDispatchFailure/failed_no_driver")
	}
	if canTransitionSched(schedDispatched, schedExpired) {
		t.Fatal("dispatched must never transition to expired")
	}
}

// TestDueForDispatch_LimitClampingBoundaries documents the limit-clamping rule
// in DueForDispatch: `if limit <= 0 || limit > 200 { limit = 100 }`.
func clampDueLimit(limit int) int {
	if limit <= 0 || limit > 200 {
		return 100
	}
	return limit
}

func TestDueForDispatch_LimitClampingBoundaries(t *testing.T) {
	cases := map[int]int{
		0:   100,
		-5:  100,
		201: 100,
		1:   1,
		200: 200,
		50:  50,
	}
	for in, want := range cases {
		if got := clampDueLimit(in); got != want {
			t.Errorf("clampDueLimit(%d) = %d, want %d", in, got, want)
		}
	}
}
