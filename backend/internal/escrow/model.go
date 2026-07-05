package escrow

import "time"

// State is the funds-hold lifecycle. DISPUTED is reserved for Phase 3; the
// allowed-transition table here already tolerates it so P3 only adds the entry
// path, never a schema change.
type State string

const (
	StateHeld     State = "HELD"
	StateReleased State = "RELEASED"
	StateRefunded State = "REFUNDED"
	StateDisputed State = "DISPUTED" // P3
)

// allowedTransitions encodes the guarded state machine. Any transition not
// listed is rejected (NL-12 / "state machines, not status fields").
var allowedTransitions = map[State]map[State]bool{
	StateHeld:     {StateReleased: true, StateRefunded: true, StateDisputed: true},
	StateDisputed: {StateReleased: true, StateRefunded: true}, // P3 arbitration
	StateReleased: {},
	StateRefunded: {},
}

func canTransition(from, to State) bool {
	next, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	return next[to]
}

// Hold is a single funds-hold. The held amount lives in the shared ledger escrow
// standing account (NL-6/NL-8) — there is no balance column. PayerID funds it on
// Hold; on Release it credits PayeeID; on Refund it credits PayerID back. Paymax
// never advances principal (NL-1) and never pays yield on the float (NL-2).
type Hold struct {
	ID             string     `json:"id"`
	Reference      string     `json:"reference"`       // domain ref (split id, pool id, order id…)
	ModuleType     string     `json:"module_type"`     // social | events | creators …
	PayerID        string     `json:"payer_id"`        // FK auth.users(id)
	PayeeID        *string    `json:"payee_id,omitempty"`
	AmountKobo     int64      `json:"amount_kobo"`
	State          State      `json:"state"`
	IdempotencyKey string     `json:"idempotency_key"`
	HeldAt         time.Time  `json:"held_at"`
	ResolvedAt     *time.Time `json:"resolved_at,omitempty"`
}
