package assessment

import "testing"

// These tests cover the PURE, DB-free logic of the assessment package:
// the two state machines (item lifecycle + learner progression), the
// threshold math, the progress-event mapping, and the answer-scoring
// helpers. DB-backed Service/Repository methods need a *pgxpool.Pool and
// are intentionally not exercised here.

// ── Question-item lifecycle ─────────────────────────────────────────────

func TestValidItemStatus(t *testing.T) {
	tests := []struct {
		name string
		s    ItemStatus
		want bool
	}{
		{"draft", ItemDraft, true},
		{"review", ItemReview, true},
		{"approved", ItemApproved, true},
		{"retired", ItemRetired, true},
		{"empty", ItemStatus(""), false},
		{"garbage", ItemStatus("archived"), false},
		{"case sensitive", ItemStatus("Draft"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validItemStatus(tt.s); got != tt.want {
				t.Errorf("validItemStatus(%q) = %v, want %v", tt.s, got, tt.want)
			}
		})
	}
}

func TestCanTransitionItem(t *testing.T) {
	tests := []struct {
		name     string
		from, to ItemStatus
		want     bool
	}{
		// legal forward edges
		{"draft->review", ItemDraft, ItemReview, true},
		{"draft->retired", ItemDraft, ItemRetired, true},
		{"review->approved", ItemReview, ItemApproved, true},
		{"review->draft bounce back", ItemReview, ItemDraft, true},
		{"review->retired", ItemReview, ItemRetired, true},
		{"approved->retired", ItemApproved, ItemRetired, true},
		// illegal edges
		{"draft->approved skip review", ItemDraft, ItemApproved, false},
		{"approved->draft", ItemApproved, ItemDraft, false},
		{"approved->review", ItemApproved, ItemReview, false},
		{"retired terminal->draft", ItemRetired, ItemDraft, false},
		{"retired terminal->review", ItemRetired, ItemReview, false},
		{"retired terminal->approved", ItemRetired, ItemApproved, false},
		// self-loops are not listed and therefore illegal for items
		{"draft->draft", ItemDraft, ItemDraft, false},
		{"approved->approved", ItemApproved, ItemApproved, false},
		// unknown from-state
		{"unknown from", ItemStatus("bogus"), ItemDraft, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canTransitionItem(tt.from, tt.to); got != tt.want {
				t.Errorf("canTransitionItem(%q,%q) = %v, want %v", tt.from, tt.to, got, tt.want)
			}
		})
	}
}

// ── Learner progression ─────────────────────────────────────────────────

func TestValidMasteryState(t *testing.T) {
	tests := []struct {
		name string
		s    MasteryState
		want bool
	}{
		{"not_started", StateNotStarted, true},
		{"in_progress", StateInProgress, true},
		{"practiced", StatePracticed, true},
		{"mastered", StateMastered, true},
		{"exam_ready", StateExamReady, true},
		{"empty", MasteryState(""), false},
		{"garbage", MasteryState("expert"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validMasteryState(tt.s); got != tt.want {
				t.Errorf("validMasteryState(%q) = %v, want %v", tt.s, got, tt.want)
			}
		})
	}
}

func TestCanProgress(t *testing.T) {
	tests := []struct {
		name     string
		from, to MasteryState
		want     bool
	}{
		// legal forward edges
		{"not_started->in_progress", StateNotStarted, StateInProgress, true},
		{"in_progress->practiced", StateInProgress, StatePracticed, true},
		{"practiced->mastered", StatePracticed, StateMastered, true},
		{"mastered->exam_ready", StateMastered, StateExamReady, true},
		// idempotent self-transitions are allowed (re-score without upgrade)
		{"not_started self", StateNotStarted, StateNotStarted, true},
		{"in_progress self", StateInProgress, StateInProgress, true},
		{"exam_ready self", StateExamReady, StateExamReady, true},
		// remediation: any non-not_started state regresses to in_progress
		{"practiced->in_progress remediate", StatePracticed, StateInProgress, true},
		{"mastered->in_progress remediate", StateMastered, StateInProgress, true},
		{"exam_ready->in_progress remediate", StateExamReady, StateInProgress, true},
		// illegal skips
		{"not_started->practiced skip", StateNotStarted, StatePracticed, false},
		{"not_started->mastered skip", StateNotStarted, StateMastered, false},
		{"in_progress->mastered skip", StateInProgress, StateMastered, false},
		{"practiced->exam_ready skip", StatePracticed, StateExamReady, false},
		// illegal backward (non-remediation) moves
		{"practiced->not_started", StatePracticed, StateNotStarted, false},
		{"mastered->practiced", StateMastered, StatePracticed, false},
		{"exam_ready->mastered", StateExamReady, StateMastered, false},
		// exam_ready is terminal for forward moves
		{"exam_ready->practiced", StateExamReady, StatePracticed, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canProgress(tt.from, tt.to); got != tt.want {
				t.Errorf("canProgress(%q,%q) = %v, want %v", tt.from, tt.to, got, tt.want)
			}
		})
	}
}

func TestDefaultThresholds(t *testing.T) {
	got := DefaultThresholds()
	if got.MinPracticeAttempts != 3 {
		t.Errorf("MinPracticeAttempts = %d, want 3", got.MinPracticeAttempts)
	}
	if got.MasteryScore != 0.7 {
		t.Errorf("MasteryScore = %v, want 0.7", got.MasteryScore)
	}
}

func TestNextStateForPractice(t *testing.T) {
	th := DefaultThresholds() // MinPracticeAttempts=3, MasteryScore=0.7
	tests := []struct {
		name       string
		from       MasteryState
		attempts   int
		score      float64
		examTagged bool
		want       MasteryState
	}{
		// first touch always bootstraps to in_progress
		{"not_started bootstraps", StateNotStarted, 0, 0.0, false, StateInProgress},
		{"not_started ignores high score", StateNotStarted, 99, 1.0, true, StateInProgress},
		// in_progress -> practiced only when attempts meet threshold
		{"in_progress below threshold", StateInProgress, 2, 1.0, false, StateInProgress},
		{"in_progress at threshold", StateInProgress, 3, 0.0, false, StatePracticed},
		{"in_progress above threshold", StateInProgress, 10, 0.0, false, StatePracticed},
		// practiced -> mastered only when score >= MasteryScore
		{"practiced below score", StatePracticed, 100, 0.69, false, StatePracticed},
		{"practiced at score boundary", StatePracticed, 100, 0.7, false, StateMastered},
		{"practiced above score", StatePracticed, 100, 0.95, false, StateMastered},
		// mastered -> exam_ready only when exam-tagged
		{"mastered not exam tagged", StateMastered, 100, 1.0, false, StateMastered},
		{"mastered exam tagged", StateMastered, 100, 0.0, true, StateExamReady},
		// exam_ready is terminal, stays put
		{"exam_ready stays", StateExamReady, 100, 1.0, true, StateExamReady},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := nextStateForPractice(tt.from, tt.attempts, tt.score, th, tt.examTagged)
			if got != tt.want {
				t.Errorf("nextStateForPractice(%q, attempts=%d, score=%v, examTagged=%v) = %q, want %q",
					tt.from, tt.attempts, tt.score, tt.examTagged, got, tt.want)
			}
		})
	}
}

// nextStateForPractice must only ever return a state reachable in ONE legal
// step (its documented invariant / defence-in-depth contract with canProgress).
func TestNextStateForPracticeStaysLegal(t *testing.T) {
	th := DefaultThresholds()
	states := []MasteryState{StateNotStarted, StateInProgress, StatePracticed, StateMastered, StateExamReady}
	attemptsCases := []int{0, 1, 3, 50}
	scoreCases := []float64{0.0, 0.5, 0.7, 1.0}
	for _, from := range states {
		for _, at := range attemptsCases {
			for _, sc := range scoreCases {
				for _, exam := range []bool{false, true} {
					to := nextStateForPractice(from, at, sc, th, exam)
					if !canProgress(from, to) {
						t.Errorf("nextStateForPractice(%q,%d,%v,%v)=%q is not canProgress-legal",
							from, at, sc, exam, to)
					}
				}
			}
		}
	}
}

// A custom-threshold curriculum override must be honoured by the math.
func TestNextStateForPracticeCustomThresholds(t *testing.T) {
	th := MasteryThresholds{MinPracticeAttempts: 1, MasteryScore: 0.5}
	if got := nextStateForPractice(StateInProgress, 1, 0.0, th, false); got != StatePracticed {
		t.Errorf("custom attempts=1 threshold: got %q, want practiced", got)
	}
	if got := nextStateForPractice(StatePracticed, 5, 0.5, th, false); got != StateMastered {
		t.Errorf("custom score=0.5 threshold: got %q, want mastered", got)
	}
	if got := nextStateForPractice(StatePracticed, 5, 0.49, th, false); got != StatePracticed {
		t.Errorf("custom score just below 0.5: got %q, want practiced", got)
	}
}

func TestProgressEventTypeFor(t *testing.T) {
	tests := []struct {
		name     string
		from, to MasteryState
		want     string
	}{
		{"no-op self emits nothing", StateInProgress, StateInProgress, ""},
		{"first practice", StateNotStarted, StateInProgress, EvtPracticeRecorded},
		{"remediate to in_progress", StateMastered, StateInProgress, EvtRemediated},
		{"remediate from practiced", StatePracticed, StateInProgress, EvtRemediated},
		{"reached practiced", StateInProgress, StatePracticed, EvtPracticed},
		{"reached mastered", StatePracticed, StateMastered, EvtMastered},
		{"reached exam_ready", StateMastered, StateExamReady, EvtExamReady},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := progressEventTypeFor(tt.from, tt.to); got != tt.want {
				t.Errorf("progressEventTypeFor(%q,%q) = %q, want %q", tt.from, tt.to, got, tt.want)
			}
		})
	}
}

// ── Answer scoring ──────────────────────────────────────────────────────

func TestIsCorrect(t *testing.T) {
	tests := []struct {
		name     string
		answer   map[string]any
		selected map[string]any
		want     bool
	}{
		{"nil answer", nil, map[string]any{"value": "a"}, false},
		{"nil selected", map[string]any{"correct": "a"}, nil, false},
		{"answer missing correct key", map[string]any{"foo": "a"}, map[string]any{"value": "a"}, false},
		{"value key match", map[string]any{"correct": "b"}, map[string]any{"value": "b"}, true},
		{"value key mismatch", map[string]any{"correct": "b"}, map[string]any{"value": "c"}, false},
		{"correct key match", map[string]any{"correct": "x"}, map[string]any{"correct": "x"}, true},
		{"selected key match", map[string]any{"correct": "y"}, map[string]any{"selected": "y"}, true},
		{"no recognised key in selected", map[string]any{"correct": "y"}, map[string]any{"foo": "y"}, false},
		// JSON-number normalisation: string "2" vs float64 2.0 compare equal.
		{"int-like string vs float", map[string]any{"correct": "2"}, map[string]any{"value": float64(2)}, true},
		{"float vs float", map[string]any{"correct": float64(3)}, map[string]any{"value": float64(3)}, true},
		{"bool match", map[string]any{"correct": true}, map[string]any{"value": true}, true},
		{"bool mismatch", map[string]any{"correct": true}, map[string]any{"value": false}, false},
		// "value" takes precedence over "correct" when both are present.
		{"value precedence over correct", map[string]any{"correct": "a"}, map[string]any{"value": "a", "correct": "z"}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isCorrect(tt.answer, tt.selected); got != tt.want {
				t.Errorf("isCorrect(%v,%v) = %v, want %v", tt.answer, tt.selected, got, tt.want)
			}
		})
	}
}

func TestEqualAny(t *testing.T) {
	tests := []struct {
		name string
		a, b any
		want bool
	}{
		{"equal strings", "a", "a", true},
		{"unequal strings", "a", "b", false},
		{"float 2 vs int-like string 2", float64(2), "2", true},
		{"float 2.5 vs string 2.5", float64(2.5), "2.5", true},
		{"nil vs nil", nil, nil, true},
		{"nil vs empty string", nil, "", true},
		{"bool true vs string true", true, "true", true},
		{"different numbers", float64(2), float64(3), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := equalAny(tt.a, tt.b); got != tt.want {
				t.Errorf("equalAny(%v,%v) = %v, want %v", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

func TestNormalize(t *testing.T) {
	tests := []struct {
		name string
		in   any
		want string
	}{
		{"nil", nil, ""},
		{"float whole", float64(2), "2"},
		{"float decimal", float64(2.5), "2.5"},
		{"string", "hello", "hello"},
		{"bool", true, "true"},
		{"int", 7, "7"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalize(tt.in); got != tt.want {
				t.Errorf("normalize(%v) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
