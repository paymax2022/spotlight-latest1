package core

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"spotlight/backend/internal/health/triage"
)

// core_test.go — pure, DB-free unit tests. They exercise the safety invariants at
// the seams that do NOT require a pgx pool: the session state machine, the
// always-overriding red-flag layer, the LLM extractor fallback (SC-10), the engine
// interview loop, and the SC-1 "never diagnosis" disposition framing.

// --- session state machine (SC-12 guarded transitions) ---

func TestSessionStateMachine(t *testing.T) {
	legal := [][2]triage.SessionState{
		{triage.SessStarted, triage.SessConsented},
		{triage.SessConsented, triage.SessInterviewing},
		{triage.SessInterviewing, triage.SessRedFlag},
		{triage.SessInterviewing, triage.SessAssessed},
		{triage.SessRedFlag, triage.SessDisposition},
		{triage.SessAssessed, triage.SessDisposition},
	}
	for _, e := range legal {
		if !triage.CanSession(e[0], e[1]) {
			t.Fatalf("expected legal transition %s -> %s", e[0], e[1])
		}
	}
	illegal := [][2]triage.SessionState{
		{triage.SessStarted, triage.SessInterviewing}, // must consent first (SC-7)
		{triage.SessStarted, triage.SessDisposition},
		{triage.SessConsented, triage.SessDisposition},
		{triage.SessClosed, triage.SessInterviewing},
	}
	for _, e := range illegal {
		if triage.CanSession(e[0], e[1]) {
			t.Fatalf("expected ILLEGAL transition %s -> %s", e[0], e[1])
		}
	}
}

// --- red-flag override forces the more urgent (lower) level (SC-2/SC-3) ---

func TestApplyRedFlagForcesLowerLevel(t *testing.T) {
	// Engine says self-care (5); red flag forces emergency ambulance (1).
	hit := &triage.RedFlagHit{RuleID: "rf_test", Level: triage.LevelEmergencyAmbulance, Severity: "emergency"}
	level, red := triage.ApplyRedFlag(triage.LevelSelfCare, hit)
	if !red || level != triage.LevelEmergencyAmbulance {
		t.Fatalf("red flag must force level 1, got level=%d red=%v", level, red)
	}
	// A red flag must never LOWER urgency: engine already at level 1, hit at 2.
	hit2 := &triage.RedFlagHit{Level: triage.LevelEmergencyUrgent}
	level2, red2 := triage.ApplyRedFlag(triage.LevelEmergencyAmbulance, hit2)
	if level2 != triage.LevelEmergencyAmbulance || !red2 {
		t.Fatalf("red flag must not lower urgency, got level=%d", level2)
	}
	// No hit → engine level unchanged, no red flag.
	level3, red3 := triage.ApplyRedFlag(triage.LevelConsult, nil)
	if level3 != triage.LevelConsult || red3 {
		t.Fatalf("nil hit must pass through, got level=%d red=%v", level3, red3)
	}
}

// --- LayeredRedFlag: deterministic safety net always runs; most urgent wins ---

func TestLayeredRedFlagSafetyNet(t *testing.T) {
	lf := NewLayeredRedFlag(nil, nil) // nil base → DefaultRedFlagEngine
	ev := []triage.Evidence{{Kind: "symptom", Code: "s_unconscious", Value: "present"}}
	hit, err := lf.Evaluate(context.Background(), ev, 30, false)
	if err != nil {
		t.Fatal(err)
	}
	if hit == nil || hit.Level != triage.LevelEmergencyAmbulance {
		t.Fatalf("unconscious must force ambulance, got %+v", hit)
	}
}

func TestLayeredRedFlagExtraRaisesUrgency(t *testing.T) {
	// base fires urgent (2); extra fires ambulance (1) → most urgent (1) wins.
	extra := fakeRedFlag{hit: &triage.RedFlagHit{RuleID: "rf_db", Level: triage.LevelEmergencyAmbulance, Severity: "emergency"}}
	lf := NewLayeredRedFlag(triage.DefaultRedFlagEngine{}, extra)
	ev := []triage.Evidence{{Kind: "symptom", Code: "s_breathlessness", Value: "present"}}
	hit, err := lf.Evaluate(context.Background(), ev, 30, false)
	if err != nil {
		t.Fatal(err)
	}
	if hit == nil || hit.Level != triage.LevelEmergencyAmbulance {
		t.Fatalf("extra rule must raise urgency to ambulance, got %+v", hit)
	}
}

type fakeRedFlag struct{ hit *triage.RedFlagHit }

func (f fakeRedFlag) Evaluate(_ context.Context, _ []triage.Evidence, _ int, _ bool) (*triage.RedFlagHit, error) {
	return f.hit, nil
}

// --- LLM extractor: never returns conclusions; falls back on error (SC-10) ---

func TestLLMExtractorFallsBackToMock(t *testing.T) {
	x := NewLLMExtractor(disabledGen{}) // disabled → mock keyword extractor
	ev, err := x.Extract(context.Background(), "I have fever and cough", "en")
	if err != nil {
		t.Fatal(err)
	}
	if len(ev) == 0 {
		t.Fatal("expected mock to extract evidence")
	}
	for _, e := range ev {
		if e.Kind != "symptom" && e.Kind != "risk_factor" && e.Kind != "answer" {
			t.Fatalf("unexpected evidence kind %q", e.Kind)
		}
	}
}

func TestLLMExtractorDropsConclusions(t *testing.T) {
	// A subverted model returns a diagnosis code; the extractor must drop it (SC-10).
	gen := stubGen{out: `[{"kind":"symptom","code":"dx_malaria","value":"present"},{"kind":"symptom","code":"s_fever","value":"present"}]`}
	x := NewLLMExtractor(gen)
	ev, err := x.Extract(context.Background(), "fever", "en")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range ev {
		if strings.HasPrefix(e.Code, "dx_") {
			t.Fatalf("conclusion code must be dropped, got %q", e.Code)
		}
	}
}

type disabledGen struct{}

func (disabledGen) Enabled() bool { return false }
func (disabledGen) GenerateJSON(_ context.Context, _, _ string) (json.RawMessage, error) {
	return nil, nil
}

type stubGen struct{ out string }

func (stubGen) Enabled() bool { return true }
func (g stubGen) GenerateJSON(_ context.Context, _, _ string) (json.RawMessage, error) {
	return json.RawMessage(g.out), nil
}

// --- engine interview loop: thin input asks a question, fuller input disposes ---

func TestMockEngineInterviewLoop(t *testing.T) {
	eng := triage.MockEngine{}
	// One symptom → engine asks a follow-up (not done).
	thin, err := eng.Triage(context.Background(), triage.EngineInput{
		AgeYears: 30, Sex: "female", Evidence: []triage.Evidence{{Kind: "symptom", Code: "s_headache", Value: "present"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if thin.Done || len(thin.Questions) == 0 {
		t.Fatalf("expected interview to continue, got %+v", thin)
	}
	// Severe symptom → done with an urgent disposition.
	full, err := eng.Triage(context.Background(), triage.EngineInput{
		AgeYears: 30, Sex: "female",
		Evidence: []triage.Evidence{{Kind: "symptom", Code: "s_chest_pain", Value: "present"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !full.Done || full.Level == 0 || full.Level > triage.LevelEmergencyUrgent {
		t.Fatalf("expected urgent disposition, got %+v", full)
	}
}

// --- disposition framing: guidance/disclaimer never say "diagnosis" (SC-1) ---

func TestDispositionFramingNeverDiagnosis(t *testing.T) {
	if strings.Contains(strings.ToLower(Disclaimer), "diagnosis") && !strings.Contains(strings.ToLower(Disclaimer), "not a medical diagnosis") {
		t.Fatalf("disclaimer must not frame output as a diagnosis: %q", Disclaimer)
	}
	for lvl := triage.LevelEmergencyAmbulance; lvl <= triage.LevelSelfCare; lvl++ {
		g := guidanceForLevel(lvl)
		if g == "" {
			t.Fatalf("missing guidance for level %d", lvl)
		}
		if strings.Contains(strings.ToLower(g), "diagnos") {
			t.Fatalf("guidance for level %d frames a diagnosis: %q", lvl, g)
		}
	}
	// disposition codes are stable + cover all 5 levels.
	want := map[int]string{1: "emergency_ambulance", 2: "emergency_urgent", 3: "consult_24h", 4: "consult", 5: "self_care"}
	for lvl, code := range want {
		if got := dispositionCodeFor(lvl); got != code {
			t.Fatalf("level %d code: got %q want %q", lvl, got, code)
		}
	}
}

// --- infermedica level mapping is conservative on unknowns (SC-3) ---

func TestInfermedicaLevelMappingConservative(t *testing.T) {
	cases := map[string]int{
		"emergency_ambulance": triage.LevelEmergencyAmbulance,
		"emergency":           triage.LevelEmergencyUrgent,
		"consultation_24":     triage.LevelConsult24h,
		"consultation":        triage.LevelConsult,
		"self_care":           triage.LevelSelfCare,
		"":                    triage.LevelConsult, // unknown → conservative consult
		"garbage":             triage.LevelConsult,
	}
	for in, want := range cases {
		if got := mapTriageLevel(in); got != want {
			t.Fatalf("mapTriageLevel(%q): got %d want %d", in, got, want)
		}
	}
}
