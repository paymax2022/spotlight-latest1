package credentials

import "spotlight/backend/go-common/fsm"

// statemachine.go holds the PURE guard logic for the credential lifecycle plus the
// pure earning-bridge eligibility predicate. No DB, no ctx — trivially unit-testable
// and reusable from the service and the tests.
// Pattern (conventions.md "State-machine guard pattern"): a transition is legal only
// if it appears in the table; the service then checks business guards, applies the
// change, updates the registry, emits audits. Illegal transitions are rejected + audited.

// credTransitions is the legal adjacency for the credential lifecycle.
var credTransitions = fsm.Table[CredState]{
	CredPending: fsm.Set(CredIssued),
	CredIssued:  fsm.Set(CredRevoked),
	CredRevoked: {}, // terminal
}

// canCred reports whether the credential lifecycle permits from→to. Self-loops are
// illegal (replay is handled by idempotency, not the state machine).
func canCred(from, to CredState) bool {
	return credTransitions.Can(from, to)
}

// validCredState reports whether s is a known credential state.
func validCredState(s CredState) bool {
	switch s {
	case CredPending, CredIssued, CredRevoked:
		return true
	default:
		return false
	}
}

// eligible reports whether a holder's issued credentials satisfy an opportunity's
// rules. Pure function of (rules, userCreds): only ISSUED credentials count, and an
// empty trade_track/kind means "any". min_credentials defaults to 1 (any matching
// issued credential unlocks the opportunity) when the rule is unset/zero.
func eligible(rules EligibilityRules, userCreds []Credential) bool {
	required := rules.MinCredentials
	if required <= 0 {
		required = 1
	}
	matched := 0
	for _, c := range userCreds {
		if c.State != CredIssued {
			continue
		}
		if rules.Kind != "" && c.Kind != rules.Kind {
			continue
		}
		if rules.TradeTrack != "" {
			if c.TradeTrack == nil || *c.TradeTrack != rules.TradeTrack {
				continue
			}
		}
		matched++
	}
	return matched >= required
}
