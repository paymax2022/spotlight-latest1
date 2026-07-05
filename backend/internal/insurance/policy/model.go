package policy

import "time"

// State is the guarded policy lifecycle state (PRD §10 / build-plan §4).
//
//	QUOTED → PENDING_PAYMENT → BINDING → ACTIVE → {RENEWAL_DUE, CANCELLED, EXPIRED}
//	BINDING        → BIND_FAILED    → (auto-reverse premium) → VOID
//	PENDING_PAYMENT→ PAYMENT_FAILED → VOID
//	QUOTED         → EXPIRED (ttl)
type State string

const (
	StateQuoted         State = "QUOTED"
	StatePendingPayment State = "PENDING_PAYMENT"
	StateBinding        State = "BINDING"
	StateActive         State = "ACTIVE"
	StateRenewalDue     State = "RENEWAL_DUE"
	StateCancelled      State = "CANCELLED"
	StateExpired        State = "EXPIRED"
	StateBindFailed     State = "BIND_FAILED"
	StatePaymentFailed  State = "PAYMENT_FAILED"
	StateVoid           State = "VOID"
)

// transitions is the guarded adjacency map. A transition not listed here is
// rejected by guard() — the state machine is closed.
var transitions = map[State]map[State]bool{
	StateQuoted: {
		StatePendingPayment: true,
		StateExpired:        true,
	},
	StatePendingPayment: {
		StateBinding:       true,
		StatePaymentFailed: true,
	},
	StateBinding: {
		StateActive:     true,
		StateBindFailed: true,
	},
	StateActive: {
		StateRenewalDue: true,
		StateCancelled:  true,
		StateExpired:    true,
	},
	StateRenewalDue: {
		StateActive:    true, // renewed
		StateExpired:   true, // lapsed
		StateCancelled: true,
	},
	StateBindFailed: {
		StateVoid: true, // after auto-reverse
	},
	StatePaymentFailed: {
		StateVoid: true,
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
	return s == StateCancelled || s == StateExpired || s == StateVoid
}

// Policy is the normalised, Paymax-owned policy record (a projection over the
// provider plus our lifecycle state). Money fields are kobo BIGINT.
type Policy struct {
	ID                string     `json:"id"`
	PolicyholderID    string     `json:"policyholder_user_id"`
	ProductCode       string     `json:"product_code"`
	Provider          string     `json:"provider"`             // aggregator
	ProviderPolicyRef *string    `json:"provider_policy_ref"`  // set after bind
	Underwriter       string     `json:"underwriter"`          // disclosed from provider
	BindingMode       string     `json:"binding_mode"`
	State             State      `json:"state"`
	SumInsuredKobo    int64      `json:"sum_insured_kobo"`
	PremiumKobo       int64      `json:"premium_amount_kobo"`
	Currency          string     `json:"currency"`
	CommissionKobo    int64      `json:"commission_kobo"`
	CertificateRef    *string    `json:"certificate_ref"`
	EffectiveAt       *time.Time `json:"effective_at"`
	ExpiresAt         *time.Time `json:"expires_at"`
	SourceEventID     *string    `json:"source_event_id"` // embedded binds only
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	Version           int        `json:"version"`
}

// Beneficiary is a named beneficiary on a policy.
type Beneficiary struct {
	ID           string  `json:"id"`
	PolicyID     string  `json:"policy_id"`
	FullName     string  `json:"full_name"`
	Relationship string  `json:"relationship"`
	SharePercent int     `json:"share_percent"`
	Phone        *string `json:"phone,omitempty"`
}
