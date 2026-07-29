package ladder

import "testing"

func req() Requirements {
	return Requirements{ShadowMinTrackRecordDays: 30, CanaryMinTrackRecordDays: 60, LiveMinTrackRecordDays: 90}
}

// Full evidence that clears every gate up to and including Live.
func fullEv() Evidence {
	return Evidence{
		ValidationPassed: true, TrackRecordDays: 120,
		MakerID: "admin-A", CheckerID: "admin-B",
		RiskSignedOff: true, LegalSignedOff: true,
	}
}

func mustAllow(t *testing.T, from, to Stage, ev Evidence) {
	t.Helper()
	if ok, reason := CanTransition(from, to, ev, req()); !ok {
		t.Fatalf("%s → %s should be allowed, denied: %s", from, to, reason)
	}
}
func mustDeny(t *testing.T, from, to Stage, ev Evidence) {
	t.Helper()
	if ok, _ := CanTransition(from, to, ev, req()); ok {
		t.Fatalf("%s → %s should be denied, was allowed", from, to)
	}
}

// The happy path climbs one rung at a time with full evidence.
func TestLadder_FullClimb(t *testing.T) {
	mustAllow(t, StageNotPromoted, StagePaper, Evidence{})
	mustAllow(t, StagePaper, StageShadow, fullEv())
	mustAllow(t, StageShadow, StageCanary, fullEv())
	mustAllow(t, StageCanary, StageLive, fullEv())
}

// Every rung-skip is illegal — you cannot leap over a stage.
func TestLadder_NoRungSkipping(t *testing.T) {
	mustDeny(t, StagePaper, StageCanary, fullEv())
	mustDeny(t, StagePaper, StageLive, fullEv())
	mustDeny(t, StageShadow, StageLive, fullEv())
	mustDeny(t, StageNotPromoted, StageShadow, fullEv())
}

// Each gate's evidence is enforced.
func TestLadder_GatesEnforced(t *testing.T) {
	// Shadow needs a passing verdict + track record.
	ev := fullEv(); ev.ValidationPassed = false
	mustDeny(t, StagePaper, StageShadow, ev)
	ev = fullEv(); ev.TrackRecordDays = 10
	mustDeny(t, StagePaper, StageShadow, ev)

	// Canary needs maker≠checker.
	ev = fullEv(); ev.CheckerID = ev.MakerID
	mustDeny(t, StageShadow, StageCanary, ev)
	ev = fullEv(); ev.CheckerID = ""
	mustDeny(t, StageShadow, StageCanary, ev)

	// Live needs Risk AND legal sign-off on top of maker-checker.
	ev = fullEv(); ev.RiskSignedOff = false
	mustDeny(t, StageCanary, StageLive, ev)
	ev = fullEv(); ev.LegalSignedOff = false
	mustDeny(t, StageCanary, StageLive, ev)
	ev = fullEv(); ev.MakerID = "solo"; ev.CheckerID = "solo"
	mustDeny(t, StageCanary, StageLive, ev)
}

// A tripped circuit blocks every forward promotion, even with otherwise-full evidence.
func TestLadder_CircuitBlocksPromotion(t *testing.T) {
	ev := fullEv(); ev.CircuitTripped = true
	mustDeny(t, StagePaper, StageShadow, ev)
	mustDeny(t, StageShadow, StageCanary, ev)
	mustDeny(t, StageCanary, StageLive, ev)
	// ...but a tripped circuit must NOT block halting or de-risking.
	mustAllow(t, StageLive, StageHalted, ev)
	mustAllow(t, StageLive, StageCanary, ev)
}

// Demotion is always allowed: halt from any active stage, and any step down.
func TestLadder_DemotionAlwaysAllowed(t *testing.T) {
	for _, s := range []Stage{StagePaper, StageShadow, StageCanary, StageLive} {
		mustAllow(t, s, StageHalted, Evidence{})
	}
	mustAllow(t, StageLive, StageCanary, Evidence{})
	mustAllow(t, StageCanary, StageShadow, Evidence{})
	mustAllow(t, StageShadow, StagePaper, Evidence{})
	// Nothing to halt from an off-ladder stage.
	mustDeny(t, StageHalted, StageHalted, Evidence{})
	mustDeny(t, StageNotPromoted, StageHalted, Evidence{})
}

// Halted re-enters only at Paper (must re-climb the whole ladder).
func TestLadder_HaltedReentry(t *testing.T) {
	mustAllow(t, StageHalted, StagePaper, Evidence{})
	mustDeny(t, StageHalted, StageShadow, fullEv())
	mustDeny(t, StageHalted, StageCanary, fullEv())
	mustDeny(t, StageHalted, StageLive, fullEv())
}

// Self-transition and unknown stages are denied (fail-closed).
func TestLadder_SelfAndUnknown(t *testing.T) {
	mustDeny(t, StageLive, StageLive, fullEv())
	mustDeny(t, "bogus", StagePaper, fullEv())
	mustDeny(t, StagePaper, "bogus", fullEv())
}

func TestLadder_TransitionAndForceHalt(t *testing.T) {
	got, err := Transition(StageCanary, StageLive, fullEv(), req())
	if err != nil || got != StageLive {
		t.Fatalf("Transition to Live failed: got %s err %v", got, err)
	}
	if _, err := Transition(StagePaper, StageLive, fullEv(), req()); err == nil {
		t.Fatal("rung-skip Transition must error")
	}
	if got, _ := ForceHalt(StageLive); got != StageHalted {
		t.Fatalf("ForceHalt should reach Halted, got %s", got)
	}
}

func TestLadder_AllowsRealCapital(t *testing.T) {
	if AllowsRealCapital(StagePaper) || AllowsRealCapital(StageShadow) || AllowsRealCapital(StageHalted) {
		t.Fatal("only Canary/Live are real-capital eligibility states")
	}
	if !AllowsRealCapital(StageCanary) || !AllowsRealCapital(StageLive) {
		t.Fatal("Canary and Live must be real-capital eligibility states")
	}
}
