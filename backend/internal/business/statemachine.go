package business

// State machine for a business profile.
//
//	register_new : draft → name_check → name_reserved → registration_submitted
//	                     → under_review → registered
//	verify_existing:       draft → submitted → verified
//	terminal failures:     any non-terminal → rejected | failed
//
// Every legal transition is enforced by CanTransition and logged to
// business_profile_events by the repository (see repository.transition).

// allowedTransitions maps a status to the set of statuses reachable from it.
var allowedTransitions = map[Status][]Status{
	StatusDraft: {
		StatusNameCheck,    // register_new: run availability
		StatusNameReserved, // register_new: reserve directly (reserve implies availability)
		StatusSubmitted,    // verify_existing: submit lookup
		StatusFailed, StatusRejected,
	},
	StatusNameCheck: {
		StatusNameReserved,
		StatusNameCheck, // re-check a different name (self-loop)
		StatusFailed, StatusRejected,
	},
	StatusNameReserved: {
		StatusRegistrationSubmitted,
		StatusFailed, StatusRejected,
	},
	StatusRegistrationSubmitted: {
		StatusUnderReview,
		StatusRegistered, // provider may register directly from submit
		StatusFailed, StatusRejected,
	},
	StatusUnderReview: {
		StatusRegistered,
		StatusRejected, StatusFailed,
	},
	StatusSubmitted: {
		StatusVerified,
		StatusRejected, StatusFailed,
	},
	// Terminal states have no outgoing transitions.
	StatusRegistered: {},
	StatusVerified:   {},
	StatusRejected:   {},
	StatusFailed:     {},
}

// terminalStatuses are the states from which no transition is legal.
var terminalStatuses = map[Status]bool{
	StatusRegistered: true,
	StatusVerified:   true,
	StatusRejected:   true,
	StatusFailed:     true,
}

// CanTransition reports whether from → to is a legal move.
func CanTransition(from, to Status) bool {
	for _, s := range allowedTransitions[from] {
		if s == to {
			return true
		}
	}
	return false
}

// IsTerminal reports whether s is a terminal state.
func IsTerminal(s Status) bool { return terminalStatuses[s] }

// IsVerifiedOrRegistered reports whether the profile represents a confirmed CAC
// identity (used by the merchant-upgrade gate).
func IsVerifiedOrRegistered(s Status) bool {
	return s == StatusVerified || s == StatusRegistered
}
