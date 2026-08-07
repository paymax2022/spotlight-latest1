// Package connectchat implements Paymax Connect Phase-1 chat: messaging is
// available ONLY after a mutual match (enforced server-side + DB backstop),
// message send/list, and an inline safety hook that runs scam/money/off-platform/
// harassment detection, warns the sender, and routes flagged conversations to
// moderation. See docs/prd/dating/{acceptance.md §Phase 1, compliance.md inv 4,10}.
package connectchat

import "time"

// Conversation safety states (mirror the connect_conversations CHECK constraint).
const (
	StateOpen        = "open"
	StateFlagged     = "flagged"
	StateUnderReview = "under_review"
	StateRestricted  = "restricted"
	StateClosed      = "closed"
)

// Message kinds (mirror the connect_messages CHECK constraint).
var messageKinds = map[string]bool{"text": true, "voice": true, "icebreaker": true}

// ValidMessageKind reports whether k is an allowed message kind.
func ValidMessageKind(k string) bool { return messageKinds[k] }

// Message mirrors a row of public.connect_messages.
type Message struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversation_id"`
	SenderID       string    `json:"sender_id"`
	Body           string    `json:"body"`
	Kind           string    `json:"kind"`
	Flagged        bool      `json:"flagged"`
	ReasonCodes    []string  `json:"reason_codes,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

// SendMessageRequest is the member body for POST .../messages.
type SendMessageRequest struct {
	Body string `json:"body" binding:"required"`
	Kind string `json:"kind"`
}

// SendResult is returned to the sender. The message is persisted even when
// flagged (so moderators can see it), but the sender receives the inline
// warning and is told whether the conversation was escalated.
type SendResult struct {
	Message   Message `json:"message"`
	Warning   string  `json:"warning,omitempty"`
	Flagged   bool    `json:"flagged"`
	Escalated bool    `json:"escalated"`
}

// ErrNoMatch is returned when a user tries to chat without a mutual, active match.
type chatError string

func (e chatError) Error() string { return string(e) }

const (
	// ErrNoMatch — caller is not a participant of an active mutual match.
	ErrNoMatch = chatError("connect: no mutual match for this conversation")
	// ErrConversationClosed — the conversation is restricted/closed by moderation.
	ErrConversationClosed = chatError("connect: conversation is not open")
	// ErrBlocked — an active block exists between the two participants.
	ErrBlocked = chatError("connect: messaging blocked between these users")
	// ErrRestricted — the sender is suspended/banned (moderation enforcement, TS-009).
	ErrRestricted = chatError("connect: account restricted")
	// ErrSafetyUnavailable — safety config could not be loaded; the send fails
	// closed (message not delivered unscanned) per invariant 12 (TS-013).
	ErrSafetyUnavailable = chatError("connect: safety checks temporarily unavailable")
)
