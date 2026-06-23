package disputes

import "time"

// Status mirrors the disputes lifecycle.
type Status string

const (
	StatusOpen       Status = "open"
	StatusInReview   Status = "in_review"
	StatusResolved   Status = "resolved"
	StatusClosed     Status = "closed"
)

// Resolution is how the dispute was resolved.
type Resolution string

const (
	ResolutionRefunded   Resolution = "refunded"
	ResolutionSettled    Resolution = "settled"
	ResolutionDismissed  Resolution = "dismissed"
)

// DisputeType describes what the dispute is about.
type DisputeType string

const (
	TypeFailedPayment  DisputeType = "failed_payment"
	TypeNonDelivery    DisputeType = "non_delivery"
	TypeWrongItem      DisputeType = "wrong_item"
	TypeNoShow         DisputeType = "no_show"
	TypeFakeCampaign   DisputeType = "fake_campaign"
	TypeUnauthorised   DisputeType = "unauthorised"
	TypeOther          DisputeType = "other"
)

// Dispute is a formal complaint raised against a transaction or order.
type Dispute struct {
	ID           string      `json:"id"`
	UserID       string      `json:"user_id"`       // reporter
	Reference    string      `json:"reference"`     // transaction / order ref
	ModuleType   string      `json:"module_type"`   // food | transport | wallet | etc.
	Type         DisputeType `json:"type"`
	Description  string      `json:"description"`
	EvidenceURLs []string    `json:"evidence_urls,omitempty"`
	Status       Status      `json:"status"`
	Resolution   *Resolution `json:"resolution,omitempty"`
	AdminNote    *string     `json:"admin_note,omitempty"`
	CreatedAt    time.Time   `json:"created_at"`
	UpdatedAt    time.Time   `json:"updated_at"`
}

// OpenRequest is the body for POST /finance/disputes.
type OpenRequest struct {
	Reference   string      `json:"reference" binding:"required"`
	ModuleType  string      `json:"module_type" binding:"required"`
	Type        DisputeType `json:"type" binding:"required"`
	Description string      `json:"description" binding:"required,min=20"`
}
