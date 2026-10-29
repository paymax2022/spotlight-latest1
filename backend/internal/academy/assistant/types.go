package assistant

// types.go — the wire and domain types for the Academy Assistant.
//
// The assistant answers Timeless Movies Film Academy questions from published
// FAQ entries only, and hands anything personal to a human. It is not a money
// path: no balance, no ledger, no payment reference is read or written here.

import (
	"time"

	"github.com/google/uuid"
)

// MaxMessageChars is the composer cap the student screen enforces and the API
// re-checks — the client limit is a courtesy, this one is the boundary.
const MaxMessageChars = 1000

// ConversationMode is the assistant/human switch on a conversation. While a
// conversation is in human mode the model is never called; the student's
// messages accumulate for staff to read.
type ConversationMode string

const (
	ModeBot   ConversationMode = "bot"
	ModeHuman ConversationMode = "human"
)

// Sender identifies who authored a message, and drives which bubble the student
// screen draws: You / Academy AI / Academy Staff / Support Update.
type Sender string

const (
	SenderUser      Sender = "user"
	SenderAssistant Sender = "assistant"
	SenderStaff     Sender = "staff"
	SenderSystem    Sender = "system"
)

// TicketStatus is the support queue lifecycle. `open -> in_progress -> closed`,
// and staff may reopen a closed case.
type TicketStatus string

const (
	TicketOpen       TicketStatus = "open"
	TicketInProgress TicketStatus = "in_progress"
	TicketClosed     TicketStatus = "closed"
)

// Faq is one knowledge-base entry. Only Published rows with no DeletedAt may
// reach the model; retrieval re-checks both even though the read query already
// filtered, because an unpublish must take effect on the very next answer.
type Faq struct {
	ID        uuid.UUID  `json:"id"`
	Category  string     `json:"category"`
	Question  string     `json:"question"`
	Answer    string     `json:"answer"`
	Keywords  []string   `json:"keywords"`
	Published bool       `json:"published"`
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
	UpdatedBy *string    `json:"updated_by,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// Conversation is one student's thread.
type Conversation struct {
	ID        uuid.UUID        `json:"id"`
	UserID    uuid.UUID        `json:"user_id"`
	Mode      ConversationMode `json:"mode"`
	CreatedAt time.Time        `json:"created_at"`
	UpdatedAt time.Time        `json:"updated_at"`
}

// Message is a single turn. FaqIDs records which published entries grounded an
// assistant turn so an answer can be audited back to its source after the fact.
type Message struct {
	ID             uuid.UUID `json:"id"`
	ConversationID uuid.UUID `json:"conversation_id"`
	Sender         Sender    `json:"sender"`
	Body           string    `json:"body"`
	CreatedAt      time.Time `json:"created_at"`
	Flagged        bool      `json:"flagged"`
	FaqIDs         []string  `json:"sources,omitempty"`
}

// Ticket is the staff queue's view of a handed-off conversation. It is a row on
// the pre-existing academy_support_tickets table, not a parallel ticket system.
type Ticket struct {
	ID               uuid.UUID    `json:"id"`
	TicketNumber     string       `json:"ticket_number"`
	UserID           *uuid.UUID   `json:"user_id,omitempty"`
	ConversationID   *uuid.UUID   `json:"conversation_id,omitempty"`
	Subject          string       `json:"subject"`
	Category         string       `json:"category"`
	Priority         string       `json:"priority"`
	Status           TicketStatus `json:"status"`
	Message          string       `json:"message"`
	AssignedOfficer  *uuid.UUID   `json:"assigned_officer_id,omitempty"`
	ResolutionNotes  *string      `json:"resolution_notes,omitempty"`
	Unanswered       bool         `json:"unanswered"`
	AgeMinutes       int64        `json:"age_minutes"`
	LastStaffReplyAt *time.Time   `json:"last_staff_reply_at,omitempty"`
	CreatedAt        time.Time    `json:"created_at"`
	UpdatedAt        time.Time    `json:"updated_at"`
}

// TicketSummary is what the console badges: counts by status, how many no one
// has replied to, and how long the oldest of those has been waiting.
type TicketSummary struct {
	Open                 int   `json:"open"`
	InProgress           int   `json:"in_progress"`
	Closed               int   `json:"closed"`
	Unanswered           int   `json:"unanswered"`
	OldestUnansweredMins int64 `json:"oldest_unanswered_minutes"`
}

// ChatRequest is one student turn. ConversationID is optional: omitting it
// starts a new conversation, which is what "New Chat" does on the screen.
type ChatRequest struct {
	Message        string  `json:"message" binding:"required,min=1,max=1000"`
	ConversationID *string `json:"conversation_id"`
}

// ChatResponse is the assistant turn, already persisted.
type ChatResponse struct {
	ConversationID uuid.UUID        `json:"conversation_id"`
	Mode           ConversationMode `json:"mode"`
	Reply          string           `json:"reply"`
	// Status names what the student got, so the screen picks the right
	// affordance instead of inferring it from an empty source list. One of the
	// Status* constants in service.go.
	Status       string    `json:"status"`
	OfferHandoff bool      `json:"offer_handoff"`
	Fallback     bool      `json:"fallback"`
	MessageID    uuid.UUID `json:"message_id"`
	Sources      []string  `json:"sources"`
	CreatedAt    time.Time `json:"created_at"`
}

// HandoffRequest escalates a conversation to Academy Support.
type HandoffRequest struct {
	ConversationID uuid.UUID `json:"conversation_id"`
	Reason         string    `json:"reason" binding:"max=500"`
}

// HandoffResponse confirms the conversation is now human-only.
type HandoffResponse struct {
	ConversationID uuid.UUID        `json:"conversation_id"`
	TicketID       uuid.UUID        `json:"ticket_id"`
	TicketNumber   string           `json:"ticket_number"`
	Mode           ConversationMode `json:"mode"`
	Reply          string           `json:"reply"`
	OfferHandoff   bool             `json:"offer_handoff"`
}

// FeedbackRequest flags an assistant answer as wrong — an escalation trigger in
// its own right, so it opens the ticket rather than only recording a rating.
type FeedbackRequest struct {
	MessageID uuid.UUID `json:"message_id"`
	Note      string    `json:"note" binding:"max=500"`
}

// StaffReplyRequest is a support agent's message into the student's thread.
type StaffReplyRequest struct {
	Body string `json:"body" binding:"required,min=1,max=4000"`
}

// StatusRequest moves a ticket between the three lifecycle states.
type StatusRequest struct {
	Status          TicketStatus `json:"status"`
	ResolutionNotes string       `json:"resolution_notes" binding:"max=2000"`
}

// FaqInput is the admin authoring payload. Published defaults to false, so a
// newly created entry cannot answer anything until it is deliberately published.
type FaqInput struct {
	Category  string   `json:"category" binding:"required,min=1,max=80"`
	Question  string   `json:"question" binding:"required,min=3,max=500"`
	Answer    string   `json:"answer" binding:"required,min=1,max=8000"`
	Keywords  []string `json:"keywords"`
	Published bool     `json:"published"`
}

// FaqListQuery filters the admin knowledge-base view. Drafts are included
// because the admin's job is to find and finish them.
type FaqListQuery struct {
	Q         string
	Category  string
	Published *bool
	Limit     int
	Offset    int
}

// TicketListQuery filters the support queue.
type TicketListQuery struct {
	Status     string
	Category   string
	Q          string
	Unanswered *bool
	Limit      int
	Offset     int
}
