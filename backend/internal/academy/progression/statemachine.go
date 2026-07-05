package progression

import "sort"

// statemachine.go holds the PURE guard + selection logic for the progression
// sub-package. No DB, no ctx — trivially unit-testable and reusable from both the
// service and the tests.
//
// Pattern (state-machines.md "guarded transitions"): a transition is legal only if
// it appears in the table; the service then applies the change, emits a
// ProgressEvent and audits. Illegal transitions are rejected + audited.

// ── Path-step lifecycle: locked → available → in_progress → done ────────────────

// stepTransitions is the legal forward adjacency for a path step. The remediation
// regression (done → in_progress) is handled in canStep so a failed re-check can
// pull a completed objective back into progress.
var stepTransitions = map[PathStepState]map[PathStepState]bool{
	StepLocked:     {StepAvailable: true},
	StepAvailable:  {StepInProgress: true},
	StepInProgress: {StepDone: true},
	StepDone:       {}, // forward-terminal; remediation handled below
}

// canStep reports whether the path-step machine permits from→to.
//   - locked → available → in_progress → done is the forward path.
//   - done → in_progress is the only legal regression (remediation).
//   - a same-state transition is treated as an illegal (no-op) move — the service
//     never asks for one; guarded UPDATE ... WHERE state=$from would not advance it.
func canStep(from, to PathStepState) bool {
	if from == to {
		return false
	}
	// Remediation: a completed step may regress to in_progress.
	if from == StepDone && to == StepInProgress {
		return true
	}
	targets, ok := stepTransitions[from]
	if !ok {
		return false
	}
	return targets[to]
}

// validStepState reports whether s is a known path-step state.
func validStepState(s PathStepState) bool {
	switch s {
	case StepLocked, StepAvailable, StepInProgress, StepDone:
		return true
	default:
		return false
	}
}

// stepEventTypeFor maps a reached step state to its progress-event type.
func stepEventTypeFor(from, to PathStepState) string {
	switch {
	case to == StepAvailable:
		return EvtStepAvailable
	case to == StepInProgress && from == StepDone:
		return EvtStepRemediated
	case to == StepInProgress:
		return EvtStepStarted
	case to == StepDone:
		return EvtStepDone
	default:
		return ""
	}
}

// ── Adaptive selection (pure) ───────────────────────────────────────────────────

// masteredState is the mastery state that counts as "no longer weak".
const masteredState = "mastered"
const examReadyState = "exam_ready"

// isWeak reports whether a single mastery row is a weak objective for the given
// threshold: not yet mastered AND scoring below the threshold. A learner with no
// mastery row at all (not_started / missing) is weak by definition.
func isWeak(m Mastery, threshold float64) bool {
	switch m.State {
	case masteredState, examReadyState:
		return false
	default:
		return m.Score < threshold
	}
}

// selectWeakObjectives returns the objective ids the learner is WEAK on, ordered
// weakest-first (lowest score first, then by objective id for determinism). An
// objective absent from `masteries` is implicitly not_started and therefore weak —
// but this pure helper only ranks the rows it is given; the caller seeds missing
// objectives as Mastery{State:"not_started", Score:0} before calling so that
// never-touched objectives surface.
func selectWeakObjectives(masteries []Mastery, threshold float64) []string {
	if threshold <= 0 {
		threshold = DefaultMasteryThreshold
	}
	weak := make([]Mastery, 0, len(masteries))
	for _, m := range masteries {
		if isWeak(m, threshold) {
			weak = append(weak, m)
		}
	}
	sort.SliceStable(weak, func(i, j int) bool {
		if weak[i].Score != weak[j].Score {
			return weak[i].Score < weak[j].Score // weakest first
		}
		return weak[i].ObjectiveID < weak[j].ObjectiveID
	})
	out := make([]string, 0, len(weak))
	for _, m := range weak {
		out = append(out, m.ObjectiveID)
	}
	return out
}

// pickItems selects up to `limit` question items for the given (already weak)
// objectives, preferring an even spread across objectives and easier items first
// within each objective (scaffolded practice: build confidence before stretch).
// Pure — no DB. Items not tied to one of `objectiveIDs` are ignored.
func pickItems(items []QuestionItemRef, objectiveIDs []string, limit int) []string {
	if limit <= 0 {
		limit = 10
	}
	// Bucket items by objective, preserving only the requested objectives.
	want := make(map[string]bool, len(objectiveIDs))
	order := make([]string, 0, len(objectiveIDs))
	for _, id := range objectiveIDs {
		if !want[id] {
			want[id] = true
			order = append(order, id)
		}
	}
	buckets := make(map[string][]QuestionItemRef)
	for _, it := range items {
		if want[it.ObjectiveID] {
			buckets[it.ObjectiveID] = append(buckets[it.ObjectiveID], it)
		}
	}
	// Easier items first within each objective (difficulty asc), id tiebreak.
	for k := range buckets {
		b := buckets[k]
		sort.SliceStable(b, func(i, j int) bool {
			if b[i].Difficulty != b[j].Difficulty {
				return b[i].Difficulty < b[j].Difficulty
			}
			return b[i].ID < b[j].ID
		})
		buckets[k] = b
	}
	// Round-robin across objectives so the session is balanced.
	out := make([]string, 0, limit)
	idx := make(map[string]int, len(order))
	for len(out) < limit {
		progressed := false
		for _, obj := range order {
			i := idx[obj]
			b := buckets[obj]
			if i < len(b) {
				out = append(out, b[i].ID)
				idx[obj] = i + 1
				progressed = true
				if len(out) >= limit {
					break
				}
			}
		}
		if !progressed {
			break // all buckets exhausted
		}
	}
	return out
}

// ── Recommendation scoring (pure) ───────────────────────────────────────────────

// recommendationScore ranks a candidate next objective. Higher = more urgent.
// Heuristic (reco_rules-overridable via config in a later iteration):
//   - the further the mastery score is below threshold, the higher the score
//     (gap = threshold - score, clamped to ≥0);
//   - an in_progress objective gets a small boost (finish-what-you-started);
//   - a not_started objective that is the NEXT available path step gets a boost
//     (keep momentum along the path).
//
// onPath signals the objective is the current available/in_progress path frontier.
func recommendationScore(m Mastery, threshold float64, onPath bool) float64 {
	if threshold <= 0 {
		threshold = DefaultMasteryThreshold
	}
	gap := threshold - m.Score
	if gap < 0 {
		gap = 0
	}
	score := gap
	if m.State == "in_progress" {
		score += 0.15
	}
	if onPath {
		score += 0.25
	}
	return score
}
