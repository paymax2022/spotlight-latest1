package healthproviders

import "time"

// State is the ProviderApplication lifecycle (HEALTH-BUILD §5):
//
//	DRAFT → SUBMITTED → UNDER_REVIEW ↔ NEEDS_INFO → APPROVED ↔ SUSPENDED | REJECTED
//
// On APPROVED the service idempotently grants the provider capability + role
// (HL-2). Any transition not in allowedTransitions is rejected (guarded SM).
type State string

const (
	StateDraft       State = "DRAFT"
	StateSubmitted   State = "SUBMITTED"
	StateUnderReview State = "UNDER_REVIEW"
	StateNeedsInfo   State = "NEEDS_INFO"
	StateApproved    State = "APPROVED"
	StateSuspended   State = "SUSPENDED"
	StateRejected    State = "REJECTED"
)

// allowedTransitions encodes the guarded application state machine.
var allowedTransitions = map[State]map[State]bool{
	StateDraft:       {StateSubmitted: true},
	StateSubmitted:   {StateUnderReview: true},
	StateUnderReview: {StateNeedsInfo: true, StateApproved: true, StateRejected: true},
	StateNeedsInfo:   {StateUnderReview: true},
	StateApproved:    {StateSuspended: true},
	StateSuspended:   {StateApproved: true},
	StateRejected:    {},
}

func canTransition(from, to State) bool {
	next, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	return next[to]
}

// Provider is the granted capability record (the marketplace-facing identity).
// It exists only once an application is APPROVED. HL-1: this is a workflow/state
// record — it carries no diagnose/dispense logic.
type Provider struct {
	ID           string    `json:"id"`
	OwnerUserID  string    `json:"owner_user_id"`
	Domain       string    `json:"domain"`        // VET | PHARMACY | LAB
	ProviderType string    `json:"provider_type"` // vet | pharmacy | pharmacist | lab | lab_scientist | phlebotomist
	DisplayName  string    `json:"display_name"`
	Status       string    `json:"status"`       // PENDING | APPROVED | SUSPENDED
	Discoverable bool      `json:"discoverable"` // HL-2 gate
	CreatedAt    time.Time `json:"created_at"`
}

// Application is the review-state object, separated from the capability it grants.
type Application struct {
	ID           string    `json:"id"`
	OwnerUserID  string    `json:"owner_user_id"`
	Domain       string    `json:"domain"`
	ProviderType string    `json:"provider_type"`
	DisplayName  string    `json:"display_name"`
	State        State     `json:"state"`
	ReviewNote   string    `json:"review_note"`
	ProviderID   *string   `json:"provider_id,omitempty"`
	GeoLng       *float64  `json:"geo_lng,omitempty"`
	GeoLat       *float64  `json:"geo_lat,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// CredentialDoc is a license/registration document in the vault. The blob lives
// in R2; storage_key is a signed-URL ref only (HL-8). expires_at feeds the HL-2
// auto-suspend signal.
type CredentialDoc struct {
	ID            string     `json:"id"`
	ApplicationID string     `json:"application_id"`
	OwnerUserID   string     `json:"owner_user_id"`
	CredType      string     `json:"cred_type"` // VCN | PCN | MLSCN | NAFDAC | PREMISES | OTHER
	ReferenceNo   string     `json:"reference_no"`
	NAFDACRef     string     `json:"nafdac_ref"`
	StorageKey    string     `json:"storage_key"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
	Verified      bool       `json:"verified"`
	CreatedAt     time.Time  `json:"created_at"`
}
