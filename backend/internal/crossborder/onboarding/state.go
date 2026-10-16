package onboarding

import "strings"

// transitions is the legal-edge table (spec §5). Everything else is a
// regression or a skip and is refused (monotonic).
//
// Suspended is reversible: it may return to any non-terminal live state
// (InReview, AwaitingTnC, Active). Callers should reinstate to
// GlobalAccount.PriorStatus; this stateless table only bounds the set.
var transitions = map[Status]map[Status]bool{
	StatusNotStarted:  {StatusSubmitted: true},
	StatusSubmitted:   {StatusInReview: true, StatusSuspended: true},
	StatusInReview:    {StatusAwaitingTnC: true, StatusActive: true, StatusRejected: true, StatusSuspended: true},
	StatusAwaitingTnC: {StatusActive: true, StatusSuspended: true},
	StatusActive:      {StatusSuspended: true},
	StatusRejected:    {StatusSubmitted: true},
	StatusSuspended:   {StatusInReview: true, StatusAwaitingTnC: true, StatusActive: true},
}

// CanTransition reports whether from -> to is a legal move.
func CanTransition(from, to Status) bool {
	return transitions[from][to]
}

// MapProviderStatus normalises both Verto status vocabularies
// (Pending/Active/Suspended and CREATED/APPROVED/REJECTED). Unknown or empty
// values map to StatusNotStarted, which the applier treats as "no information"
// (CanTransition never permits moving into it).
func MapProviderStatus(vertoStatus string) Status {
	switch strings.ToUpper(strings.TrimSpace(vertoStatus)) {
	case "CREATED":
		return StatusSubmitted
	case "PENDING":
		return StatusInReview
	case "APPROVED", "ACTIVE":
		return StatusActive
	case "REJECTED":
		return StatusRejected
	case "SUSPENDED":
		return StatusSuspended
	default:
		return StatusNotStarted
	}
}
