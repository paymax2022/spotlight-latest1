// Package connectmoderation implements the Paymax Connect admin moderation
// surface: review flagged conversations/messages and profiles, record
// moderation decisions with stored reason codes (invariant 8), and act on a
// conversation's safety state. It composes with the existing safety admin
// (cases/audit) — it adds only the queues + decision log that live in its own
// tables. See docs/prd/dating/{acceptance.md §Phase 1, compliance.md inv 8,9}.
package connectmoderation

import "time"

// Decision values (mirror connect_moderation_decisions.decision CHECK).
var decisions = map[string]bool{
	"flagged": true, "warned": true, "cleared": true,
	"restricted": true, "escalated": true, "removed": true,
}

// ValidDecision reports whether d is an allowed moderation decision.
func ValidDecision(d string) bool { return decisions[d] }

// targetTypes mirror connect_moderation_decisions.target_type CHECK.
var targetTypes = map[string]bool{
	"message": true, "conversation": true, "profile": true, "media": true, "user": true,
}

// ValidTargetType reports whether t is an allowed moderation target type.
func ValidTargetType(t string) bool { return targetTypes[t] }

// FlaggedConversation is a queue row for the moderation surface.
type FlaggedConversation struct {
	ID          string    `json:"id"`
	MatchID     string    `json:"match_id"`
	SafetyState string    `json:"safety_state"`
	FlagCount   int       `json:"flag_count"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// FlaggedMessage is a flagged message with its stored reason codes.
type FlaggedMessage struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversation_id"`
	SenderID       string    `json:"sender_id"`
	ReasonCodes    []string  `json:"reason_codes"`
	CreatedAt      time.Time `json:"created_at"`
}

// Decision mirrors a row of public.connect_moderation_decisions.
type Decision struct {
	ID          string    `json:"id"`
	TargetType  string    `json:"target_type"`
	TargetID    string    `json:"target_id"`
	Decision    string    `json:"decision"`
	ReasonCodes []string  `json:"reason_codes"`
	Model       *string   `json:"model,omitempty"`
	ReviewerID  *string   `json:"reviewer_id,omitempty"`
	CaseID      *string   `json:"case_id,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// DecisionRequest is the admin body to record a moderation decision.
type DecisionRequest struct {
	TargetType  string   `json:"target_type" binding:"required"`
	TargetID    string   `json:"target_id" binding:"required"`
	Decision    string   `json:"decision" binding:"required"`
	ReasonCodes []string `json:"reason_codes"`
	CaseID      string   `json:"case_id"`
}

// ConvActionRequest sets a conversation's safety state (admin).
type ConvActionRequest struct {
	SafetyState string `json:"safety_state" binding:"required"`
	Reason      string `json:"reason"`
}
