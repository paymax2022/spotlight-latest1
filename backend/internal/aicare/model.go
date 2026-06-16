package aicare

import "time"

// SessionStatus tracks an AI support session.
type SessionStatus string

const (
	SessionOpen       SessionStatus = "open"
	SessionEscalated  SessionStatus = "escalated"
	SessionResolved   SessionStatus = "resolved"
)

// MessageRole identifies who sent a message.
type MessageRole string

const (
	RoleUser   MessageRole = "user"
	RoleAI     MessageRole = "ai"
	RoleAgent  MessageRole = "agent"
)

// Session is a customer support conversation.
type Session struct {
	ID        string        `json:"id"`
	UserID    string        `json:"user_id"`
	Status    SessionStatus `json:"status"`
	Topic     string        `json:"topic,omitempty"`
	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`
}

// Message is a single turn in a session.
type Message struct {
	ID        string      `json:"id"`
	SessionID string      `json:"session_id"`
	Role      MessageRole `json:"role"`
	Content   string      `json:"content"`
	CreatedAt time.Time   `json:"created_at"`
}

// CreateSessionRequest opens a new support session.
type CreateSessionRequest struct {
	Topic string `json:"topic"`
}

// SendMessageRequest posts a user message and returns the AI reply.
type SendMessageRequest struct {
	Content string `json:"content" binding:"required,min=1,max=4000"`
}

// EscalateRequest hands off to a human agent.
type EscalateRequest struct {
	Reason string `json:"reason"`
}
