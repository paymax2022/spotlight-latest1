package progression

import (
	"reflect"
	"testing"
)

// ─────────────────────────────────────────────────────────────────────────────
// canStep: guarded path-step lifecycle (locked→available→in_progress→done) +
// the single legal regression done→in_progress (remediation). state-machines.md §1.
// ─────────────────────────────────────────────────────────────────────────────

func TestCanStepAllowed(t *testing.T) {
	allowed := [][2]PathStepState{
		{StepLocked, StepAvailable},
		{StepAvailable, StepInProgress},
		{StepInProgress, StepDone},
		{StepDone, StepInProgress}, // remediation
	}
	for _, c := range allowed {
		if !canStep(c[0], c[1]) {
			t.Errorf("canStep(%s, %s) = false, want true", c[0], c[1])
		}
	}
}

func TestCanStepIllegal(t *testing.T) {
	illegal := [][2]PathStepState{
		{StepLocked, StepInProgress},    // skip available
		{StepLocked, StepDone},          // skip everything
		{StepAvailable, StepDone},       // skip in_progress
		{StepAvailable, StepLocked},     // backward re-lock
		{StepInProgress, StepLocked},    // backward re-lock
		{StepInProgress, StepAvailable}, // backward
		{StepDone, StepAvailable},       // illegal regression (only →in_progress allowed)
		{StepDone, StepLocked},          // illegal regression
		{StepLocked, StepLocked},        // same-state no-op
		{StepDone, StepDone},            // same-state no-op
	}
	for _, c := range illegal {
		if canStep(c[0], c[1]) {
			t.Errorf("canStep(%s, %s) = true, want false", c[0], c[1])
		}
	}
}

func TestStepEventTypeFor(t *testing.T) {
	cases := []struct {
		from, to PathStepState
		want     string
	}{
		{StepLocked, StepAvailable, EvtStepAvailable},
		{StepAvailable, StepInProgress, EvtStepStarted},
		{StepInProgress, StepDone, EvtStepDone},
		{StepDone, StepInProgress, EvtStepRemediated},
	}
	for _, c := range cases {
		if got := stepEventTypeFor(c.from, c.to); got != c.want {
			t.Errorf("stepEventTypeFor(%s,%s) = %q, want %q", c.from, c.to, got, c.want)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// selectWeakObjectives: weakest-first, mastered/exam_ready excluded.
// ─────────────────────────────────────────────────────────────────────────────

func TestSelectWeakObjectives(t *testing.T) {
	masteries := []Mastery{
		{ObjectiveID: "o-mastered", State: "mastered", Score: 0.95},   // excluded
		{ObjectiveID: "o-examready", State: "exam_ready", Score: 0.9}, // excluded
		{ObjectiveID: "o-low", State: "in_progress", Score: 0.2},      // weak
		{ObjectiveID: "o-mid", State: "practiced", Score: 0.5},        // weak
		{ObjectiveID: "o-new", State: "not_started", Score: 0.0},      // weak (weakest)
		{ObjectiveID: "o-edge", State: "practiced", Score: 0.7},       // NOT weak (== threshold)
	}
	got := selectWeakObjectives(masteries, 0.7)
	want := []string{"o-new", "o-low", "o-mid"} // ordered weakest score first
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("selectWeakObjectives = %v, want %v", got, want)
	}
}

func TestSelectWeakObjectivesThresholdFallback(t *testing.T) {
	// threshold <= 0 falls back to DefaultMasteryThreshold (0.7).
	m := []Mastery{{ObjectiveID: "a", State: "practiced", Score: 0.65}}
	if got := selectWeakObjectives(m, 0); len(got) != 1 || got[0] != "a" {
		t.Fatalf("expected 'a' weak under default threshold, got %v", got)
	}
}

func TestIsWeak(t *testing.T) {
	if isWeak(Mastery{State: "mastered", Score: 0.1}, 0.7) {
		t.Error("mastered must never be weak regardless of score")
	}
	if isWeak(Mastery{State: "exam_ready", Score: 0.1}, 0.7) {
		t.Error("exam_ready must never be weak")
	}
	if !isWeak(Mastery{State: "in_progress", Score: 0.69}, 0.7) {
		t.Error("below-threshold in_progress must be weak")
	}
	if isWeak(Mastery{State: "practiced", Score: 0.7}, 0.7) {
		t.Error("score == threshold is not weak")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// pickItems: balanced round-robin across objectives, easier-first within each.
// ─────────────────────────────────────────────────────────────────────────────

func TestPickItemsRoundRobinAndDifficulty(t *testing.T) {
	items := []QuestionItemRef{
		{ID: "a-hard", ObjectiveID: "A", Difficulty: 0.9},
		{ID: "a-easy", ObjectiveID: "A", Difficulty: 0.1},
		{ID: "b-mid", ObjectiveID: "B", Difficulty: 0.5},
		{ID: "b-easy", ObjectiveID: "B", Difficulty: 0.2},
		{ID: "c-ignored", ObjectiveID: "C", Difficulty: 0.3}, // not requested
	}
	got := pickItems(items, []string{"A", "B"}, 4)
	// Round-robin A,B then A,B; easier first within each objective.
	want := []string{"a-easy", "b-easy", "a-hard", "b-mid"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("pickItems = %v, want %v", got, want)
	}
}

func TestPickItemsLimit(t *testing.T) {
	items := []QuestionItemRef{
		{ID: "1", ObjectiveID: "A", Difficulty: 0.1},
		{ID: "2", ObjectiveID: "A", Difficulty: 0.2},
		{ID: "3", ObjectiveID: "A", Difficulty: 0.3},
	}
	if got := pickItems(items, []string{"A"}, 2); len(got) != 2 {
		t.Fatalf("expected 2 items, got %v", got)
	}
}

func TestPickItemsIgnoresUnrequested(t *testing.T) {
	items := []QuestionItemRef{{ID: "x", ObjectiveID: "Z", Difficulty: 0.1}}
	if got := pickItems(items, []string{"A"}, 5); len(got) != 0 {
		t.Fatalf("expected no items for absent objective, got %v", got)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Path-build ordering: the first step is available, the rest locked, in the
// curriculum order the objectives are supplied in. (Pure ordering check that
// mirrors CreatePathWithSteps' state assignment.)
// ─────────────────────────────────────────────────────────────────────────────

func TestPathBuildOrdering(t *testing.T) {
	objectives := []Objective{
		{ObjectiveID: "o1", ObjOrdinal: 0},
		{ObjectiveID: "o2", ObjOrdinal: 1},
		{ObjectiveID: "o3", ObjOrdinal: 2},
	}
	// Replicate the pure state-assignment rule used in CreatePathWithSteps.
	states := make([]PathStepState, len(objectives))
	for i := range objectives {
		if i == 0 {
			states[i] = StepAvailable
		} else {
			states[i] = StepLocked
		}
	}
	want := []PathStepState{StepAvailable, StepLocked, StepLocked}
	if !reflect.DeepEqual(states, want) {
		t.Fatalf("path step states = %v, want %v", states, want)
	}
	// And the first assigned state must be a legal start (locked is the DB default;
	// the first step jumps straight to available, which is the canStep target).
	if !canStep(StepLocked, states[0]) {
		t.Fatalf("first step %s is not a legal locked-> transition", states[0])
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// recommendationScore: larger gaps rank higher; in_progress + on-path boosts.
// ─────────────────────────────────────────────────────────────────────────────

func TestRecommendationScoreGapRanking(t *testing.T) {
	threshold := 0.7
	big := recommendationScore(Mastery{State: "not_started", Score: 0.0}, threshold, false) // gap 0.7
	small := recommendationScore(Mastery{State: "practiced", Score: 0.6}, threshold, false) // gap 0.1
	if big <= small {
		t.Fatalf("bigger gap should rank higher: big=%v small=%v", big, small)
	}
}

func TestRecommendationScoreBoosts(t *testing.T) {
	threshold := 0.7
	base := recommendationScore(Mastery{State: "practiced", Score: 0.5}, threshold, false)
	inProg := recommendationScore(Mastery{State: "in_progress", Score: 0.5}, threshold, false)
	onPath := recommendationScore(Mastery{State: "practiced", Score: 0.5}, threshold, true)
	if inProg <= base {
		t.Errorf("in_progress should boost: inProg=%v base=%v", inProg, base)
	}
	if onPath <= base {
		t.Errorf("on-path should boost: onPath=%v base=%v", onPath, base)
	}
}

func TestRecommendationScoreMasteredZero(t *testing.T) {
	// A mastered objective off-path has zero gap and no boosts → score 0 (filtered out).
	if got := recommendationScore(Mastery{State: "mastered", Score: 0.95}, 0.7, false); got != 0 {
		t.Fatalf("mastered off-path score = %v, want 0", got)
	}
}
