package kyc

import "time"

// Status mirrors the kyc_status check constraint in the Supabase migration.
type Status string

const (
	StatusNone      Status = "none"
	StatusPending   Status = "pending"
	StatusSubmitted Status = "submitted"
	StatusVerified  Status = "verified"
	StatusFailed    Status = "failed"
)

// Tier is the verified access level (0–3).
type Tier int

// Profile is the KYC state for a user.
type Profile struct {
	UserID        string     `json:"user_id"`
	Tier          Tier       `json:"kyc_tier"`
	Status        Status     `json:"kyc_status"`
	SubmittedAt   *time.Time `json:"kyc_submitted_at,omitempty"`
	VerifiedAt    *time.Time `json:"kyc_verified_at,omitempty"`
	PhoneVerified bool       `json:"phone_verified"`
	DocumentType  *string    `json:"document_type,omitempty"`
	RequestedTier *int       `json:"requested_tier,omitempty"`
}

// InitiateRequest is the body for POST /finance/kyc/initiate.
type InitiateRequest struct {
	// Tier the user is requesting (1, 2, or 3).
	RequestedTier int     `json:"requested_tier" binding:"required,min=1,max=3"`
	DocumentType  *string `json:"document_type,omitempty"`
	DocumentRef   *string `json:"document_ref,omitempty"`
	BVN           *string `json:"bvn,omitempty"`
	NIN           *string `json:"nin,omitempty"`
}

// AuditEvent is written to kyc_events on every state transition.
type AuditEvent struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	EventType string    `json:"event_type"` // initiated | verified | failed | reverted
	OldTier   Tier      `json:"old_tier"`
	NewTier   Tier      `json:"new_tier"`
	CreatedAt time.Time `json:"created_at"`
	ActorID   *string   `json:"actor_id,omitempty"` // nil = system; set = admin
}
