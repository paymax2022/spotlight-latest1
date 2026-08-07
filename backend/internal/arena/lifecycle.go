package arena

// Contestant lifecycle state machine (ADR-014 §8, NDC-5). Guarded: any transition
// not explicitly listed is rejected. Advancement transitions (→QUALIFIED,
// →FINALIST, →CROWNED) are computed from the Merit leaderboard ONLY (NDC-1); the
// state machine here only encodes legality — the caller supplies the merit-derived
// decision.

// ContestantState is the lifecycle state.
type ContestantState string

const (
	StApplied        ContestantState = "APPLIED"
	StScreened       ContestantState = "SCREENED"
	StTrained        ContestantState = "TRAINED"
	StTheoryAssigned ContestantState = "THEORY_ASSIGNED"
	StTheoryTaken    ContestantState = "THEORY_TAKEN"
	StQualified      ContestantState = "QUALIFIED"
	StFinalist       ContestantState = "FINALIST"
	StCrowned        ContestantState = "CROWNED"
	StEliminated     ContestantState = "ELIMINATED"
	StRejected       ContestantState = "REJECTED"
	StWithdrawn      ContestantState = "WITHDRAWN"
)

// allowed encodes the §8 graph.
var allowed = map[ContestantState]map[ContestantState]bool{
	StApplied:        {StScreened: true, StRejected: true, StWithdrawn: true},
	StScreened:       {StTrained: true, StWithdrawn: true},
	StTrained:        {StTheoryAssigned: true, StWithdrawn: true},
	StTheoryAssigned: {StTheoryTaken: true, StWithdrawn: true},
	StTheoryTaken:    {StQualified: true, StEliminated: true, StWithdrawn: true},
	StQualified:      {StFinalist: true, StEliminated: true, StWithdrawn: true},
	StFinalist:       {StCrowned: true, StEliminated: true, StWithdrawn: true},
	// terminal states
	StCrowned:    {},
	StEliminated: {},
	StRejected:   {},
	StWithdrawn:  {},
}

// terminalStates are absorbing (except the admin WITHDRAWN path handled above).
var terminalStates = map[ContestantState]bool{
	StCrowned: true, StEliminated: true, StRejected: true, StWithdrawn: true,
}

// CanTransition reports whether from → to is a legal lifecycle move. The admin
// "any non-terminal → WITHDRAWN" path is included in `allowed`.
func CanTransition(from, to ContestantState) bool {
	if from == to {
		return false
	}
	return allowed[from][to]
}

// IsTerminal reports whether a state is absorbing.
func IsTerminal(s ContestantState) bool { return terminalStates[s] }

// AdvancementReadsMeritOnly lists the transitions that MUST be computed from the
// Merit leaderboard and never from any money/engagement tally (NDC-1). Callers
// assert this to keep the firewall explicit at the call site.
func AdvancementReadsMeritOnly(to ContestantState) bool {
	switch to {
	case StQualified, StFinalist, StCrowned:
		return true
	default:
		return false
	}
}
