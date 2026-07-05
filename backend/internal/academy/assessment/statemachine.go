package assessment

// statemachine.go holds the PURE guard logic for the two assessment lifecycles.
// Keeping the transition tables and threshold math here (no DB, no ctx) makes them
// trivially unit-testable and reusable from both the service and the tests.
//
// Pattern (conventions.md "State-machine guard pattern"): a transition is legal
// only if it appears in the table; the service then checks business guards, applies
// the change, emits events and audits. Illegal transitions are rejected + audited.

// ── Question-item lifecycle: draft → review → approved → retired ───────────────

// itemTransitions is the legal adjacency for the question-item lifecycle.
var itemTransitions = map[ItemStatus]map[ItemStatus]bool{
	ItemDraft:    {ItemReview: true, ItemRetired: true},
	ItemReview:   {ItemApproved: true, ItemDraft: true, ItemRetired: true}, // review can bounce back to draft
	ItemApproved: {ItemRetired: true},
	ItemRetired:  {}, // terminal
}

// canTransitionItem reports whether the item lifecycle permits from→to.
func canTransitionItem(from, to ItemStatus) bool {
	targets, ok := itemTransitions[from]
	if !ok {
		return false
	}
	return targets[to]
}

// validItemStatus reports whether s is a known item status.
func validItemStatus(s ItemStatus) bool {
	switch s {
	case ItemDraft, ItemReview, ItemApproved, ItemRetired:
		return true
	default:
		return false
	}
}

// ── Learner progression: not_started → in_progress → practiced → mastered → exam_ready
// plus the "remediate" regression path from any state back to in_progress.

// progressionTransitions is the legal forward adjacency. The remediate regression
// path is handled separately by canRemediate so it can target in_progress from any
// non-terminal-failure state.
var progressionTransitions = map[MasteryState]map[MasteryState]bool{
	StateNotStarted: {StateInProgress: true},
	StateInProgress: {StatePracticed: true},
	StatePracticed:  {StateMastered: true},
	StateMastered:   {StateExamReady: true},
	StateExamReady:  {},
}

// canProgress reports whether the progression machine permits from→to. The
// "remediate" event (regression to in_progress) is a legal path from any state and
// is allowed here too so a failed re-check can pull a learner back to in_progress.
func canProgress(from, to MasteryState) bool {
	if from == to {
		// Idempotent no-op transition (e.g. re-scoring without an upgrade) is allowed.
		return true
	}
	// Remediation: any state may regress to in_progress.
	if to == StateInProgress && from != StateNotStarted {
		return true
	}
	targets, ok := progressionTransitions[from]
	if !ok {
		return false
	}
	return targets[to]
}

// validMasteryState reports whether s is a known mastery state.
func validMasteryState(s MasteryState) bool {
	switch s {
	case StateNotStarted, StateInProgress, StatePracticed, StateMastered, StateExamReady:
		return true
	default:
		return false
	}
}

// nextStateForPractice computes the target mastery state after a practice/mastery
// run, given the current state, accumulated practice-attempt count, the latest
// score (0..1), the thresholds and whether the objective is tagged to an exam.
//
// This is the THRESHOLD logic factored out of the service so the math is pure:
//   - not_started → in_progress on the very first practice.
//   - in_progress → practiced once min practice attempts are met.
//   - practiced  → mastered once score ≥ MasteryScore.
//   - mastered   → exam_ready once the objective is exam-tagged.
//
// It only ever returns a state reachable in ONE legal step from `from`; the caller
// still validates with canProgress before committing (defence in depth).
func nextStateForPractice(from MasteryState, attempts int, score float64, t MasteryThresholds, examTagged bool) MasteryState {
	switch from {
	case StateNotStarted:
		return StateInProgress
	case StateInProgress:
		if attempts >= t.MinPracticeAttempts {
			return StatePracticed
		}
		return StateInProgress
	case StatePracticed:
		if score >= t.MasteryScore {
			return StateMastered
		}
		return StatePracticed
	case StateMastered:
		if examTagged {
			return StateExamReady
		}
		return StateMastered
	default:
		return from
	}
}

// progressEventTypeFor maps a reached state to its progress-event type, or ""
// when the transition is a no-op (no upgrade → no event emitted).
func progressEventTypeFor(from, to MasteryState) string {
	if from == to {
		return ""
	}
	switch to {
	case StateInProgress:
		if from == StateNotStarted {
			return EvtPracticeRecorded
		}
		return EvtRemediated
	case StatePracticed:
		return EvtPracticed
	case StateMastered:
		return EvtMastered
	case StateExamReady:
		return EvtExamReady
	default:
		return ""
	}
}
