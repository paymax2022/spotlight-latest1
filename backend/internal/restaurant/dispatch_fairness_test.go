package restaurant

import (
	"testing"
	"time"
)

func riderIDs(cs []riderCandidate) []string {
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = c.RiderID
	}
	return out
}

func TestSelectFairRiders_LoadCapFilters(t *testing.T) {
	cands := []riderCandidate{
		{RiderID: "over", HasDistance: true, DistanceSq: 1, ActiveLoad: 3}, // at cap → excluded
		{RiderID: "ok", HasDistance: true, DistanceSq: 5, ActiveLoad: 2},
		{RiderID: "way-over", HasDistance: true, DistanceSq: 0, ActiveLoad: 9}, // nearest but saturated → excluded
	}
	got := riderIDs(selectFairRiders(cands, 7, baseMaxRiderLoad))
	if len(got) != 1 || got[0] != "ok" {
		t.Fatalf("load cap should exclude saturated riders even if nearer; got %v", got)
	}
}

func TestSelectFairRiders_NearestFirst(t *testing.T) {
	cands := []riderCandidate{
		{RiderID: "far", HasDistance: true, DistanceSq: 100, ActiveLoad: 0},
		{RiderID: "near", HasDistance: true, DistanceSq: 1, ActiveLoad: 0},
		{RiderID: "mid", HasDistance: true, DistanceSq: 25, ActiveLoad: 0},
	}
	got := riderIDs(selectFairRiders(cands, 7, baseMaxRiderLoad))
	want := []string{"near", "mid", "far"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("nearest-first order = %v, want %v", got, want)
		}
	}
}

func TestSelectFairRiders_LoadTiebreakAmongEquidistant(t *testing.T) {
	cands := []riderCandidate{
		{RiderID: "busy", HasDistance: true, DistanceSq: 10, ActiveLoad: 2},
		{RiderID: "idle", HasDistance: true, DistanceSq: 10, ActiveLoad: 0},
	}
	got := riderIDs(selectFairRiders(cands, 7, baseMaxRiderLoad))
	if got[0] != "idle" {
		t.Fatalf("equidistant → lighter load first; got %v", got)
	}
}

func TestSelectFairRiders_NoPinsRotateFairly(t *testing.T) {
	// No distance info anywhere (e.g. restaurant has no pin): sourcing must become a
	// fair rotation — never-assigned first, then longest-waiting — not arbitrary.
	old := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	recent := time.Date(2026, 7, 27, 11, 0, 0, 0, time.UTC)
	cands := []riderCandidate{
		{RiderID: "recent", ActiveLoad: 0, LastAssigned: &recent},
		{RiderID: "never", ActiveLoad: 0, LastAssigned: nil},
		{RiderID: "stale", ActiveLoad: 0, LastAssigned: &old},
	}
	got := riderIDs(selectFairRiders(cands, 7, baseMaxRiderLoad))
	want := []string{"never", "stale", "recent"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("no-pin rotation = %v, want %v", got, want)
		}
	}
}

func TestSelectFairRiders_KnownDistanceBeatsUnknown(t *testing.T) {
	cands := []riderCandidate{
		{RiderID: "unknown", ActiveLoad: 0},
		{RiderID: "pinned", HasDistance: true, DistanceSq: 999, ActiveLoad: 0},
	}
	got := riderIDs(selectFairRiders(cands, 7, baseMaxRiderLoad))
	if got[0] != "pinned" {
		t.Fatalf("a routable (pinned) rider should rank ahead of an unknown-distance one; got %v", got)
	}
}

func TestSelectFairRiders_TrimsToFanOut(t *testing.T) {
	var cands []riderCandidate
	for i := 0; i < 20; i++ {
		cands = append(cands, riderCandidate{RiderID: string(rune('a' + i)), HasDistance: true, DistanceSq: float64(i)})
	}
	if got := selectFairRiders(cands, 5, baseMaxRiderLoad); len(got) != 5 {
		t.Fatalf("fanOut 5 should return 5, got %d", len(got))
	}
}

func TestDispatchSLAStatus(t *testing.T) {
	ready := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	rp := &ready
	at := func(sec int) time.Time { return ready.Add(time.Duration(sec) * time.Second) }

	cases := []struct {
		name       string
		assignedAt *time.Time
		now        time.Time
		want       SLAStatus
	}{
		{"unassigned, 30s → on_time", nil, at(30), SLAOnTime},
		{"unassigned, 3m → at_risk", nil, at(180), SLAAtRisk},
		{"unassigned, 6m → breached", nil, at(360), SLABreached},
		{"assigned in 1m → on_time (frozen at assign)", tPtr(at(60)), at(600), SLAOnTime},
		{"assigned in 4m → at_risk (frozen at assign)", tPtr(at(240)), at(999), SLAAtRisk},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, _ := dispatchSLAStatus(rp, c.assignedAt, c.now, dispatchSLATarget, dispatchSLABreach)
			if got != c.want {
				t.Fatalf("status = %v, want %v", got, c.want)
			}
		})
	}

	// No ready time yet → no SLA clock.
	if got, elapsed := dispatchSLAStatus(nil, nil, ready, dispatchSLATarget, dispatchSLABreach); got != SLAOnTime || elapsed != 0 {
		t.Fatalf("nil readyAt should be on_time/0, got %v/%v", got, elapsed)
	}
}

func TestDispatchTuning_EscalatesOnStuckRedispatch(t *testing.T) {
	ready := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	rp := &ready

	// First attempt on a fresh order → base bounds, no escalation.
	if fo, ml, esc := dispatchTuning(rp, ready.Add(time.Second), 0); esc || fo != baseDispatchFanOut || ml != baseMaxRiderLoad {
		t.Fatalf("fresh dispatch should use base bounds, got fo=%d ml=%d esc=%v", fo, ml, esc)
	}
	// Re-dispatch while still fresh (under target) → still base.
	if _, _, esc := dispatchTuning(rp, ready.Add(30*time.Second), 1); esc {
		t.Fatal("re-dispatch under SLA target should not escalate")
	}
	// Re-dispatch after the target has slipped → escalate (wider net, relaxed cap).
	if fo, ml, esc := dispatchTuning(rp, ready.Add(3*time.Minute), 2); !esc || fo != escalatedDispatchFanOut || ml != escalatedMaxRiderLoad {
		t.Fatalf("stuck re-dispatch should escalate, got fo=%d ml=%d esc=%v", fo, ml, esc)
	}
}

func tPtr(t time.Time) *time.Time { return &t }
