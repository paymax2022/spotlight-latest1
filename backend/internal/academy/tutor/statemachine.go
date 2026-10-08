package tutor

import "spotlight/backend/go-common/fsm"

// statemachine.go holds the PURE guard logic for the payout lifecycle. No DB, no ctx —
// trivially unit-testable and reusable from the service and the tests.
// Pattern (conventions.md "State-machine guard pattern"): a transition is legal only if
// it appears in the table; the service then checks business guards, applies the change,
// and emits audits. Illegal transitions are rejected with a stable code AND audited.
//   - requested : payout created; the rail disbursement is in flight.
//   - paid      : the PayoutRail confirmed the disbursement (terminal, success).
//   - failed    : the PayoutRail returned an error (terminal, failure).
// Self-loops are illegal (replay is handled by idempotency, not the state machine).

// payoutTransitions is the legal adjacency set for the payout SM.
var payoutTransitions = fsm.Table[PayoutState]{
	PayoutRequested: fsm.Set(PayoutPaid, PayoutFailed),
	PayoutPaid:      {}, // terminal
	PayoutFailed:    {}, // terminal
}

// canPayout reports whether from→to is a legal payout-SM transition. Pure.
func canPayout(from, to PayoutState) bool {
	return payoutTransitions.Can(from, to)
}
