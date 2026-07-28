package exam

// statemachine.go holds the PURE guard logic for the CBT attempt lifecycle.
// Keeping the transition table here (no DB, no ctx) makes it trivially
// unit-testable and reusable from both the service and the tests.
//
// Pattern (conventions.md "State-machine guard pattern", state-machines.md §2):
// a transition is legal only if it appears in the table; the service then checks
// business guards (entitlement, pause policy, deadline), applies the change, emits
// events and audits. Illegal transitions are rejected + audited.
//
// Attempt lifecycle (state-machines.md §2):
//
//	created → started → (paused ⇄ started) → submitted → scored → reviewed
//
// | created          | begin   | started   | entitlement valid; server timer starts |
// | started          | pause   | paused    | only if blueprint pause_policy=allowed  |
// | paused           | resume  | started   | within allowed window                  |
// | started/paused   | submit  | submitted | idempotent; freeze responses           |
// | submitted        | score   | scored    | apply scoringRules; readiness/predicted|
// | scored           | review  | reviewed  | render breakdown; analytics            |

// allowedAttempt is the legal adjacency for the CBT attempt lifecycle.
var allowedAttempt = map[AttemptState]map[AttemptState]bool{
	AttemptCreated:   {AttemptStarted: true},
	AttemptStarted:   {AttemptPaused: true, AttemptSubmitted: true},
	AttemptPaused:    {AttemptStarted: true, AttemptSubmitted: true},
	AttemptSubmitted: {AttemptScored: true},
	AttemptScored:    {AttemptReviewed: true},
	AttemptReviewed:  {}, // terminal
}

// canAttempt reports whether the attempt machine permits from→to.
func canAttempt(from, to AttemptState) bool {
	targets, ok := allowedAttempt[from]
	if !ok {
		return false
	}
	return targets[to]
}

// isTerminalForResponses reports whether the attempt state makes responses
// immutable (submitted onward). Used to enforce the "freeze on submit" rule.
func isTerminalForResponses(s AttemptState) bool {
	switch s {
	case AttemptSubmitted, AttemptScored, AttemptReviewed:
		return true
	default:
		return false
	}
}
