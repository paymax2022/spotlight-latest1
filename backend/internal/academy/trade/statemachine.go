package trade

// statemachine.go holds the PURE guard logic for the trade lifecycles. Keeping the
// transition tables here (no DB, no ctx) makes them trivially unit-testable and
// reusable from both the service and the tests.
//
// Pattern (conventions.md "State-machine guard pattern"): a transition is legal only
// if it appears in the table; the service/repo then checks business guards, applies
// the change, emits events and audits. Illegal transitions are rejected + audited.

// ── Project submission: submitted → reviewed → passed | failed ────────────────

// submissionTransitions is the legal adjacency for the project-submission lifecycle.
// A reviewer first moves submitted→reviewed, then reviewed→passed|failed. The single
// guarded review step (submitted→reviewed→passed|failed) is validated edge-by-edge.
var submissionTransitions = map[SubmissionState]map[SubmissionState]bool{
	SubmissionSubmitted: {SubmissionReviewed: true},
	SubmissionReviewed:  {SubmissionPassed: true, SubmissionFailed: true},
	SubmissionPassed:    {}, // terminal
	SubmissionFailed:    {}, // terminal
}

// canSubmission reports whether the submission lifecycle permits from→to.
func canSubmission(from, to SubmissionState) bool {
	targets, ok := submissionTransitions[from]
	if !ok {
		return false
	}
	return targets[to]
}

// validSubmissionState reports whether s is a known submission state.
func validSubmissionState(s SubmissionState) bool {
	switch s {
	case SubmissionSubmitted, SubmissionReviewed, SubmissionPassed, SubmissionFailed:
		return true
	default:
		return false
	}
}

// ── Mentor match: requested → active → closed ─────────────────────────────────

// matchTransitions is the legal adjacency for the mentor-match lifecycle.
var matchTransitions = map[MatchState]map[MatchState]bool{
	MatchRequested: {MatchActive: true, MatchClosed: true}, // mentor may accept or decline(=close)
	MatchActive:    {MatchClosed: true},
	MatchClosed:    {}, // terminal
}

// canMatch reports whether the mentor-match lifecycle permits from→to.
func canMatch(from, to MatchState) bool {
	targets, ok := matchTransitions[from]
	if !ok {
		return false
	}
	return targets[to]
}

// validMatchState reports whether s is a known match state.
func validMatchState(s MatchState) bool {
	switch s {
	case MatchRequested, MatchActive, MatchClosed:
		return true
	default:
		return false
	}
}

// ── Grading ───────────────────────────────────────────────────────────────────

// grade is the PURE pass/fail decision for a skill assessment: a score at or above
// the assessment's pass_threshold passes. Kept pure so the math is trivially testable.
func grade(score, threshold float64) (passed bool) {
	return score >= threshold
}
