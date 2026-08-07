package investai

import "time"

// The standing not-financial-advice disclaimer surfaced on every assistant turn.
// The InvestAI assistant EDUCATES only — it never gives personalized buy/sell/hold
// advice, price predictions, or guarantees. See docs/crypto/modules.md → "AI
// Investment Education Assistant" (Allowed / Prohibited / Guardrails).
const Disclaimer = "This is general educational information, not financial advice. " +
	"Investments carry risk, including the possible loss of your capital, and past " +
	"performance never guarantees future results. Do your own research and consider " +
	"speaking with a licensed financial adviser before making any decision."

// The standing refusal returned when a prompt seeks personalized advice, a price
// prediction, or a guarantee (mirrors the mobile REFUSAL copy in intent).
const Refusal = "I can't tell you what to buy, sell, or hold, predict prices, or " +
	"promise returns — that would be personalized financial advice. What I can do is " +
	"explain how investing works: volatility, diversification, fees, settlement, risk, " +
	"or what a stock or cryptocurrency is. Which topic would you like to understand?"

// ChatRole identifies who authored a chat turn.
type ChatRole string

const (
	RoleUser      ChatRole = "user"
	RoleAssistant ChatRole = "assistant"
)

// ChatSession is one InvestAI education conversation, owner-scoped to a user.
type ChatSession struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Title     string    `json:"title,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ChatMessage is a single turn in a session. Assistant turns carry Disclaimer=true
// so the UI footnotes the standing not-financial-advice disclaimer, and Refused
// marks turns that were redirected away from an advice-seeking prompt.
type ChatMessage struct {
	ID         string    `json:"id"`
	SessionID  string    `json:"session_id"`
	Role       ChatRole  `json:"role"`
	Text       string    `json:"text"`
	Disclaimer bool      `json:"disclaimer,omitempty"`
	Refused    bool      `json:"refused,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

// AskContext is optional context the screens pass so answers can reference the
// asset the user is currently viewing.
type AskContext struct {
	Symbol string `json:"symbol,omitempty"`
}

// ChatRequest is the body for POST /chat. session_id is optional — when absent a
// fresh session is created for the caller.
type ChatRequest struct {
	Prompt    string      `json:"prompt" binding:"required,min=1,max=4000"`
	Context   *AskContext `json:"context,omitempty"`
	SessionID string      `json:"session_id,omitempty"`
}

// ChatResponse is the body returned by POST /chat. It mirrors what the mobile
// wrapper unwraps: { text, refused? }. session_id / message / disclaimer are
// additive fields the client may ignore.
type ChatResponse struct {
	SessionID  string       `json:"session_id"`
	Text       string       `json:"text"`
	Refused    bool         `json:"refused"`
	Disclaimer string       `json:"disclaimer"`
	Message    *ChatMessage `json:"message,omitempty"`
}

// ExplainAssetRequest is the body for POST /explain-asset.
type ExplainAssetRequest struct {
	Symbol string `json:"symbol" binding:"required,min=1,max=32"`
}

// ExplainAssetResponse mirrors what the mobile wrapper unwraps: { text }.
type ExplainAssetResponse struct {
	Symbol     string `json:"symbol"`
	Text       string `json:"text"`
	Disclaimer string `json:"disclaimer"`
}
