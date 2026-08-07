package connecttrust

import "time"

// ShieldFlag is a read row of public.connect_scam_shield_flags for moderators.
type ShieldFlag struct {
	ID             string    `json:"id"`
	ConversationID *string   `json:"conversation_id,omitempty"`
	MessageID      *string   `json:"message_id,omitempty"`
	SubjectID      *string   `json:"subject_id,omitempty"`
	Category       string    `json:"category"`
	ReasonCodes    []string  `json:"reason_codes"`
	Score          int       `json:"score"`
	CaseID         *string   `json:"case_id,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

// AIFeature enumerates the guardrailed assistant surfaces (api.md Phase 5).
type AIFeature string

const (
	FeatureProfileCoach       AIFeature = "profile_coach"
	FeatureConversationAssist AIFeature = "conversation_assistant"
	FeatureMatchExplanation   AIFeature = "match_explanation"
)

func validAIFeature(f AIFeature) bool {
	switch f {
	case FeatureProfileCoach, FeatureConversationAssist, FeatureMatchExplanation:
		return true
	}
	return false
}

// AIRequest is the member-facing body for an AI assistant call.
type AIRequest struct {
	Feature AIFeature `json:"feature" binding:"required"`
	Prompt  string    `json:"prompt"  binding:"required"`
}

// AIResponse is what the member receives. Output is only ever returned when the
// guardrail PASSED; a blocked request returns a safe refusal with Blocked=true.
type AIResponse struct {
	Output      string   `json:"output"`
	Blocked     bool     `json:"blocked"`
	ReasonCodes []string `json:"reason_codes,omitempty"`
}
