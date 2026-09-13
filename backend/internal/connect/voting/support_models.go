package connectvoting

import (
	"time"
)

// SupportTicket represents a user support request
type SupportTicket struct {
	ID               string    `json:"id"`
	UserID           string    `json:"user_id"`
	ContestID        string    `json:"contest_id,omitempty"`
	Category         string    `json:"category"` // 'account_issue','voting_problem',etc
	Status           string    `json:"status"`   // 'open','in_progress','waiting','resolved','closed'
	Subject          string    `json:"subject"`
	Description      string    `json:"description"`
	Priority         string    `json:"priority"` // 'low','normal','high','urgent'
	Source           string    `json:"source"`   // 'web','mobile','marketplace'
	AssignedTo       string    `json:"assigned_to,omitempty"`
	ResolutionNotes  string    `json:"resolution_notes,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
	ResolvedAt       *time.Time `json:"resolved_at,omitempty"`
}

// TicketMessage represents a message in a support ticket
type TicketMessage struct {
	ID          string    `json:"id"`
	TicketID    string    `json:"ticket_id"`
	AuthorID    string    `json:"author_id"`
	IsInternal  bool      `json:"is_internal"`
	Message     string    `json:"message"`
	Attachments []string  `json:"attachments,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// Note: Notification type is defined in repo.go (voting notifications from connectvoting module)
