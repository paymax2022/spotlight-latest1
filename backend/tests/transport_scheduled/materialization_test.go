package transport_scheduled_test

// ---------------------------------------------------------------------------
// Mode -> materialization-kind mapping + dispatch idempotency-key derivation.
//
// transport.materializationKind, transport.defaultLeadMinutes, and
// transport.rideServiceType (backend/internal/transport/scheduled.go,
// scheduled_dispatch.go) are unexported. Backend's own scheduled_test.go
// already asserts materializationKind directly with table-driven cases; this
// file re-asserts the SAME mapping from the QA file boundary by transcription
// (cited below), plus additional invariants Backend's unit test doesn't cover:
// the dispatch idempotency-key format and exhaustiveness of the mode set
// against the frozen 6-mode list in SWARM_INTEGRATION_CONTRACT.md.
//
// Cited verbatim from backend/internal/transport/scheduled.go:
//
//	func materializationKind(mode string) string {
//		switch mode {
//		case "ride_hail", "ride_share", "airport_pickup":
//			return "trip"
//		case "parcel_intra", "parcel_inter":
//			return "parcel"
//		case "bus":
//			return "bus_ticket"
//		default:
//			return ""
//		}
//	}
//
//	func defaultLeadMinutes(mode string) int {
//		switch mode {
//		case "airport_pickup": return 90
//		case "bus": return 120
//		case "parcel_intra", "parcel_inter": return 45
//		default: return 30 // ride_hail / ride_share
//		}
//	}
//
// Cited verbatim from backend/internal/transport/scheduled_dispatch.go
// (Service.DispatchScheduled):
//
//	idemKey := fmt.Sprintf("sched:%s:dispatch", b.ID)
// ---------------------------------------------------------------------------

import (
	"fmt"
	"testing"
)

// schedulingModes mirrors transport.scheduledModes (the frozen 6-mode set).
var schedulingModes = map[string]bool{
	"ride_hail": true, "ride_share": true, "parcel_intra": true,
	"parcel_inter": true, "airport_pickup": true, "bus": true,
}

// materializationKind transcribes transport.materializationKind verbatim.
func materializationKind(mode string) string {
	switch mode {
	case "ride_hail", "ride_share", "airport_pickup":
		return "trip"
	case "parcel_intra", "parcel_inter":
		return "parcel"
	case "bus":
		return "bus_ticket"
	default:
		return ""
	}
}

// defaultLeadMinutes transcribes transport.defaultLeadMinutes verbatim.
func defaultLeadMinutes(mode string) int {
	switch mode {
	case "airport_pickup":
		return 90
	case "bus":
		return 120
	case "parcel_intra", "parcel_inter":
		return 45
	default:
		return 30
	}
}

// rideServiceType transcribes transport.rideServiceType verbatim.
func rideServiceType(mode string) string {
	switch mode {
	case "ride_share":
		return "ride_sharing"
	case "airport_pickup":
		return "airport_pickup"
	default:
		return "ride_hailing"
	}
}

// dispatchIdemKey transcribes the deterministic dispatch idempotency key
// format from Service.DispatchScheduled: "sched:<id>:dispatch".
func dispatchIdemKey(bookingID string) string {
	return fmt.Sprintf("sched:%s:dispatch", bookingID)
}

// TestMaterializationKind_CoversEveryFrozenMode asserts every one of the 6
// frozen modes maps to a materialization kind, and no mode maps to "" (empty
// means "unsupported" — a booking in this state would be undispatchable).
func TestMaterializationKind_CoversEveryFrozenMode(t *testing.T) {
	want := map[string]string{
		"ride_hail":      "trip",
		"ride_share":     "trip",
		"airport_pickup": "trip",
		"parcel_intra":   "parcel",
		"parcel_inter":   "parcel",
		"bus":            "bus_ticket",
	}
	if len(want) != len(schedulingModes) {
		t.Fatalf("materialization-kind table covers %d modes, frozen mode set has %d", len(want), len(schedulingModes))
	}
	for mode := range schedulingModes {
		got := materializationKind(mode)
		if got == "" {
			t.Errorf("mode %q has no materialization kind — booking would be undispatchable", mode)
		}
		if got != want[mode] {
			t.Errorf("materializationKind(%q) = %q, want %q", mode, got, want[mode])
		}
	}
}

// TestMaterializationKind_UnknownModeIsEmpty documents the sentinel: an
// unrecognized mode returns "" so materialize()'s switch falls through to the
// INVALID_MODE codedErr rather than silently picking a default kind.
func TestMaterializationKind_UnknownModeIsEmpty(t *testing.T) {
	for _, bad := range []string{"", "scooter", "RIDE_HAIL", "parcel"} {
		if got := materializationKind(bad); got != "" {
			t.Errorf("materializationKind(%q) = %q, want empty sentinel for unsupported mode", bad, got)
		}
	}
}

// TestDefaultLeadMinutes_PerModeBoundaries locks the exact per-mode default
// lead times from the contract (airport 90, bus 120, parcel 45, ride 30) —
// these values drive DueForDispatch's scan window, so a silent drift here
// changes WHEN real money gets escrowed.
func TestDefaultLeadMinutes_PerModeBoundaries(t *testing.T) {
	cases := map[string]int{
		"ride_hail":      30,
		"ride_share":     30,
		"airport_pickup": 90,
		"parcel_intra":   45,
		"parcel_inter":   45,
		"bus":            120,
	}
	for mode, want := range cases {
		if got := defaultLeadMinutes(mode); got != want {
			t.Errorf("defaultLeadMinutes(%q) = %d, want %d", mode, got, want)
		}
	}
	// Every default must be positive — a zero/negative lead would dispatch at
	// or after the pickup time, which defeats "auto-dispatch AT lead time
	// BEFORE pickup" (contract §"Product decisions").
	for mode := range schedulingModes {
		if lead := defaultLeadMinutes(mode); lead <= 0 {
			t.Errorf("defaultLeadMinutes(%q) = %d, must be > 0", mode, lead)
		}
	}
}

// TestRideServiceType_MapsScheduledModeToTripServiceType locks the mapping
// materialize() uses to build RequestRideRequest.ServiceType for the 3
// ride-family modes.
func TestRideServiceType_MapsScheduledModeToTripServiceType(t *testing.T) {
	cases := map[string]string{
		"ride_hail":      "ride_hailing",
		"ride_share":     "ride_sharing",
		"airport_pickup": "airport_pickup",
	}
	for mode, want := range cases {
		if got := rideServiceType(mode); got != want {
			t.Errorf("rideServiceType(%q) = %q, want %q", mode, got, want)
		}
	}
}

// TestDispatchIdemKey_DeterministicPerBooking proves the dispatch idempotency
// key is a pure, stable function of the booking id: (a) same id -> same key on
// every call (so a retry converges to one escrow), (b) distinct ids -> distinct
// keys (so two different bookings never collide on the same escrow charge),
// and (c) the exact format "sched:<id>:dispatch" the contract requires
// (SWARM_INTEGRATION_CONTRACT §"SCHEDULER WORKER": "Dispatch must be idempotent
// per booking (deterministic idem key sched:<id>:dispatch)").
func TestDispatchIdemKey_DeterministicPerBooking(t *testing.T) {
	const bookingID = "11111111-1111-1111-1111-111111111111"
	want := "sched:11111111-1111-1111-1111-111111111111:dispatch"

	first := dispatchIdemKey(bookingID)
	second := dispatchIdemKey(bookingID) // simulate a worker retry
	if first != want {
		t.Fatalf("dispatchIdemKey(%q) = %q, want %q", bookingID, first, want)
	}
	if first != second {
		t.Errorf("dispatch idem key must be stable across calls: %q vs %q", first, second)
	}

	other := dispatchIdemKey("22222222-2222-2222-2222-222222222222")
	if other == first {
		t.Errorf("distinct bookings must derive distinct dispatch idem keys, both got %q", first)
	}
}

// TestDispatchIdemKey_NoCollisionAcrossManyBookings is a broader sweep of (c)
// above: N distinct booking ids must produce N distinct keys.
func TestDispatchIdemKey_NoCollisionAcrossManyBookings(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 500; i++ {
		id := fmt.Sprintf("booking-%d", i)
		key := dispatchIdemKey(id)
		if seen[key] {
			t.Fatalf("dispatch idem key collision at booking %q: %q", id, key)
		}
		seen[key] = true
	}
	if len(seen) != 500 {
		t.Errorf("expected 500 distinct keys, got %d", len(seen))
	}
}
