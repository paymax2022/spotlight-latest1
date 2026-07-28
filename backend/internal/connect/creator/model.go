// Package connectcreator implements Paymax Connect Phase 4 (creator): portfolio,
// Spotlight creator-verification requests + admin review, collaboration requests,
// and fan-message controls. Verification is a guarded state machine; portfolio
// media is moderated before public visibility; fan-message policy is enforced
// server-side. No plaintext verification PII (evidence stored as encrypted ref).
package connectcreator

import "time"

type VerificationStatus string

const (
	VerUnverified VerificationStatus = "unverified"
	VerPending    VerificationStatus = "pending"
	VerVerified   VerificationStatus = "verified"
	VerRejected   VerificationStatus = "rejected"
)

// FanMessagePolicy controls who may DM the creator (server-enforced).
type FanMessagePolicy string

const (
	FanOpen         FanMessagePolicy = "open"
	FanVerifiedOnly FanMessagePolicy = "verified_only"
	FanOff          FanMessagePolicy = "off"
)

func ValidFanPolicy(p FanMessagePolicy) bool {
	switch p {
	case FanOpen, FanVerifiedOnly, FanOff:
		return true
	}
	return false
}

type Profile struct {
	ID                 string    `json:"id"`
	UserID             string    `json:"user_id"`
	Handle             string    `json:"handle,omitempty"`
	DisplayName        string    `json:"display_name,omitempty"`
	Category           string    `json:"category,omitempty"`
	Bio                string    `json:"bio,omitempty"`
	VerificationStatus string    `json:"verification_status"`
	FanMessages        string    `json:"fan_messages"`
	CreatedAt          time.Time `json:"created_at"`
}

type PortfolioItem struct {
	ID               string    `json:"id"`
	CreatorID        string    `json:"creator_id"`
	Title            string    `json:"title"`
	URL              string    `json:"url,omitempty"`
	Kind             string    `json:"kind"`
	ModerationStatus string    `json:"moderation_status"`
	Position         int       `json:"position"`
	CreatedAt        time.Time `json:"created_at"`
}

type CollabRequest struct {
	ID         string    `json:"id"`
	FromUserID string    `json:"from_user_id"`
	CreatorID  string    `json:"creator_id"`
	Subject    string    `json:"subject,omitempty"`
	Body       string    `json:"body,omitempty"`
	BudgetKobo *int64    `json:"budget_kobo,omitempty"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
}

// --- Request DTOs ---

type ProfileInput struct {
	Handle      string `json:"handle"`
	DisplayName string `json:"display_name"`
	Category    string `json:"category"`
	Bio         string `json:"bio"`
}

type PortfolioInput struct {
	Title    string `json:"title" binding:"required"`
	URL      string `json:"url"`
	Kind     string `json:"kind"`
	Position int    `json:"position"`
}

type CollabInput struct {
	CreatorID  string `json:"creator_id" binding:"required"`
	Subject    string `json:"subject"`
	Body       string `json:"body"`
	BudgetKobo *int64 `json:"budget_kobo"`
}

type CollabResponse struct {
	Accept bool `json:"accept"`
}

type FanPolicyInput struct {
	FanMessages string `json:"fan_messages" binding:"required"`
}

// validCollabTransition guards the collab-request state machine.
func validCollabTransition(from, to string) bool {
	if from != "pending" {
		return false
	}
	return to == "accepted" || to == "declined" || to == "withdrawn"
}
