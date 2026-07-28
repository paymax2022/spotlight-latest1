package claims

import "time"

// State is the guarded claim lifecycle state (PRD §10.2 / build-plan §4).
//
//	DRAFT → FNOL_SUBMITTED → UNDER_ASSESSMENT
//	                            ├─ NEEDS_MORE_INFO ⇄ UNDER_ASSESSMENT
//	                            ├─ APPROVED → PAYOUT_PENDING → SETTLED
//	                            └─ REJECTED
//
// The payout money-move happens ONLY on PAYOUT_PENDING → SETTLED, idempotent on
// the claim's idempotency_key. The state machine is closed: a transition not in
// the adjacency map is rejected by guard().
type State string

const (
	StateDraft          State = "DRAFT"
	StateFNOLSubmitted  State = "FNOL_SUBMITTED"
	StateUnderAssess    State = "UNDER_ASSESSMENT"
	StateNeedsMoreInfo  State = "NEEDS_MORE_INFO"
	StateApproved       State = "APPROVED"
	StatePayoutPending  State = "PAYOUT_PENDING"
	StateSettled        State = "SETTLED"
	StateRejected       State = "REJECTED"
)

// transitions is the guarded adjacency map.
var transitions = map[State]map[State]bool{
	StateDraft: {
		StateFNOLSubmitted: true,
	},
	StateFNOLSubmitted: {
		StateUnderAssess: true,
	},
	StateUnderAssess: {
		StateNeedsMoreInfo: true,
		StateApproved:      true,
		StateRejected:      true,
	},
	StateNeedsMoreInfo: {
		StateUnderAssess: true,
	},
	StateApproved: {
		StatePayoutPending: true,
	},
	StatePayoutPending: {
		StateSettled: true,
	},
}

// canTransition reports whether from→to is a permitted guarded transition.
func canTransition(from, to State) bool {
	next, ok := transitions[from]
	if !ok {
		return false
	}
	return next[to]
}

// isTerminal reports whether a state admits no further transitions.
func isTerminal(s State) bool {
	return s == StateSettled || s == StateRejected
}

// Claim is the normalised, Paymax-owned claim record (a projection over the
// provider plus our lifecycle state). Money fields are kobo BIGINT.
type Claim struct {
	ID              string     `json:"id"`
	PolicyID        string     `json:"policy_id"`
	ClaimantID      string     `json:"claimant_user_id"`
	Provider        string     `json:"provider"`           // aggregator
	ProviderClaimRef *string   `json:"provider_claim_ref"` // set after FNOL hand-off
	State           State      `json:"state"`
	LossEventAt     time.Time  `json:"loss_event_at"`
	ReportedAt      time.Time  `json:"reported_at"`
	Description     string     `json:"description"`
	ClaimedAmountKobo  int64   `json:"claimed_amount_kobo"`
	ApprovedAmountKobo int64   `json:"approved_amount_kobo"`
	Currency        string     `json:"currency"`
	PayoutLedgerRef *string    `json:"payout_ledger_ref"` // set on SETTLED
	IdempotencyKey  string     `json:"idempotency_key"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	Version         int        `json:"version"`
}

// Evidence is a signed-URL reference to a claim evidence object in R2. The bytes
// never travel through the backend; only the object key (storage_ref) is stored.
type Evidence struct {
	ID          string    `json:"id"`
	ClaimID     string    `json:"claim_id"`
	FileName    string    `json:"file_name"`
	ContentType string    `json:"content_type"`
	StorageRef  string    `json:"storage_ref"`
	CreatedAt   time.Time `json:"created_at"`
}

// Payout is the insurance-domain record of a claim payout money move. It
// references the ledger entry (payout_ledger_ref) and carries the idempotency key
// (UNIQUE) so a retried settlement is a safe no-op.
type Payout struct {
	ID             string    `json:"id"`
	ClaimID        string    `json:"claim_id"`
	WalletLedgerRef string   `json:"wallet_ledger_ref"`
	IdempotencyKey string    `json:"idempotency_key"`
	AmountKobo     int64     `json:"amount_kobo"`
	Status         string    `json:"status"` // posted
	CreatedAt      time.Time `json:"created_at"`
}
