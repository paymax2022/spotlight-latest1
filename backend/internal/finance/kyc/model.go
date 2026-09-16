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

// AuditEvent is written to kyc_events on every state transition. Field names
// mirror the actual table (20260613010000_kyc_events.sql) — old_status/
// new_status/old_tier/new_tier/document_type/actor_id/note — not an
// event_type column, which the table has never had.
type AuditEvent struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	OldStatus    *string   `json:"old_status,omitempty"`
	NewStatus    Status    `json:"new_status"`
	OldTier      *Tier     `json:"old_tier,omitempty"`
	NewTier      Tier      `json:"new_tier"`
	DocumentType *string   `json:"document_type,omitempty"`
	ActorID      *string   `json:"actor_id,omitempty"` // nil = system/self; set = admin
	Note         *string   `json:"note,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}
