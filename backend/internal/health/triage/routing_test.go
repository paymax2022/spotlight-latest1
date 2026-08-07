package triage

import "testing"

// TS-2 emergency red-flag routing: TR-002 (red-flag → emergency), TR-007 (fail
// safe: uncertain → escalate/caution, never self-care), EC-006 (red-flag takes
// precedence over the engine level). Pure, deterministic — no DB.

// TR-002 / EC-006: a red-flag hit forces the disposition to the more-urgent level
// and never lowers it — it overrides the engine.
func TestApplyRedFlagOnlyRaisesUrgency(t *testing.T) {
	// Engine said routine consult (4); an EMERGENCY red flag (1) overrides it.
	if lvl, rf := ApplyRedFlag(LevelConsult, &RedFlagHit{Level: LevelEmergencyAmbulance}); lvl != LevelEmergencyAmbulance || !rf {
		t.Fatalf("red flag must force emergency: level=%d redFlag=%v", lvl, rf)
	}
	// A less-urgent "hit" never lowers a more-urgent engine level.
	if lvl, rf := ApplyRedFlag(LevelEmergencyAmbulance, &RedFlagHit{Level: LevelSelfCare}); lvl != LevelEmergencyAmbulance || !rf {
		t.Fatalf("red flag must never lower urgency: level=%d", lvl)
	}
	// No hit → engine level unchanged, no red flag.
	if lvl, rf := ApplyRedFlag(LevelConsult, nil); lvl != LevelConsult || rf {
		t.Fatalf("no hit should pass engine level through: level=%d redFlag=%v", lvl, rf)
	}
	// Engine returned 0 (uncertain) but a red flag fired → red-flag level wins.
	if lvl, _ := ApplyRedFlag(0, &RedFlagHit{Level: LevelEmergencyUrgent}); lvl != LevelEmergencyUrgent {
		t.Fatalf("red flag must win over an unset engine level: %d", lvl)
	}
}

// TR-007: an out-of-range / uncertain level fails SAFE to a clinician consult —
// never self-care.
func TestSafeLevelFailsSafe(t *testing.T) {
	for _, bad := range []int{0, -1, -100, 6, 99} {
		got := SafeLevel(bad)
		if got != LevelConsult {
			t.Errorf("SafeLevel(%d) = %d, want LevelConsult(%d)", bad, got, LevelConsult)
		}
		if RouteForLevel(got) == "self_care" {
			t.Errorf("an uncertain level (%d) must not route to self_care", bad)
		}
	}
	// Valid levels pass through untouched.
	for lvl := LevelEmergencyAmbulance; lvl <= LevelSelfCare; lvl++ {
		if SafeLevel(lvl) != lvl {
			t.Errorf("SafeLevel(%d) must pass through, got %d", lvl, SafeLevel(lvl))
		}
	}
}

// TR-002: emergency levels route to the emergency loop; mid levels to telemed;
// only genuine self-care (5) routes to self-care.
func TestRouteForLevel(t *testing.T) {
	want := map[int]string{
		LevelEmergencyAmbulance: "emergency",
		LevelEmergencyUrgent:    "emergency",
		LevelConsult24h:         "telemed",
		LevelConsult:            "telemed",
		LevelSelfCare:           "self_care",
	}
	for lvl, route := range want {
		if got := RouteForLevel(lvl); got != route {
			t.Errorf("RouteForLevel(%d) = %q, want %q", lvl, got, route)
		}
	}
}

// Composed TR-007: an uncertain engine result with NO red flag still fails safe to
// a clinician (telemed), never self-care.
func TestUncertainResultRoutesToClinicianNotSelfCare(t *testing.T) {
	level, _ := ApplyRedFlag(0, nil) // uncertain engine, no red flag → 0
	level = SafeLevel(level)
	if route := RouteForLevel(level); route == "self_care" {
		t.Fatalf("uncertain result must not land in self_care, got %q (level %d)", route, level)
	}
}
