package engage

// DTOs in this package mirror the mobile TypeScript contract
// (mobile-app/reactnative/src/features/crowdfunding/types/crowdfunding.types.ts).
// All field names are camelCase to match the client exactly.

// HelpArticle matches the client HelpArticle.
type HelpArticle struct {
	ID       string `json:"id"`
	Question string `json:"question"`
	Answer   string `json:"answer"`
	Topic    string `json:"topic"`
}

// TicketMessage matches the client TicketMessage.
type TicketMessage struct {
	ID        string `json:"id"`
	From      string `json:"from"` // 'user' | 'support'
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
}

// SupportTicket matches the client SupportTicket.
type SupportTicket struct {
	ID        string          `json:"id"`
	Reference string          `json:"reference"`
	Subject   string          `json:"subject"`
	Category  string          `json:"category"` // TicketCategory
	Status    string          `json:"status"`   // TicketStatus
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
	Messages  []TicketMessage `json:"messages"`
}

// CreateTicketInput matches the client CreateTicketInput.
type CreateTicketInput struct {
	Category string `json:"category" binding:"required"`
	Subject  string `json:"subject" binding:"required,min=2,max=200"`
	Body     string `json:"body" binding:"required,min=1"`
}

// AppNotification matches the client AppNotification.
type AppNotification struct {
	ID         string  `json:"id"`
	Type       string  `json:"type"` // AppNotificationType
	Title      string  `json:"title"`
	Body       string  `json:"body"`
	CreatedAt  string  `json:"createdAt"`
	Read       bool    `json:"read"`
	CampaignID *string `json:"campaignId"`
}

// NotificationPrefs matches the client NotificationPrefs.
type NotificationPrefs struct {
	Push               bool `json:"push"`
	Email              bool `json:"email"`
	SMS                bool `json:"sms"`
	ContributionAlerts bool `json:"contributionAlerts"`
	CampaignUpdates    bool `json:"campaignUpdates"`
	Marketing          bool `json:"marketing"`
}

// ReplyTicketInput is the body for POST /support/tickets/:id/reply.
type ReplyTicketInput struct {
	Body string `json:"body" binding:"required,min=1"`
}
