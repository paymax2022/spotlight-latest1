package crowdfunding

import "time"

// Campaign is a fundraising campaign with a goal amount and deadline.
type Campaign struct {
	ID          string    `json:"id"`
	CreatorID   string    `json:"creator_id"`
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	GoalKobo    int64     `json:"goal_kobo"`
	RaisedKobo  int64     `json:"raised_kobo"`
	Status      string    `json:"status"` // draft | active | funded | failed | cancelled
	Deadline    time.Time `json:"deadline"`
	CoverURL    *string   `json:"cover_url,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// Contribution is a single pledge to a campaign.
type Contribution struct {
	ID             string    `json:"id"`
	CampaignID     string    `json:"campaign_id"`
	ContributorID  string    `json:"contributor_id"`
	AmountKobo     int64     `json:"amount_kobo"`
	Status         string    `json:"status"` // escrowed | released | refunded
	IdempotencyKey string    `json:"idempotency_key"`
	SettlementID   string    `json:"settlement_id"`
	CreatedAt      time.Time `json:"created_at"`
}

// CreateCampaignRequest is the body for POST /crowdfunding/campaigns.
type CreateCampaignRequest struct {
	Title       string    `json:"title" binding:"required,min=2,max=200"`
	Description string    `json:"description"`
	GoalKobo    int64     `json:"goal_kobo" binding:"required,min=100"`
	Deadline    time.Time `json:"deadline" binding:"required"`
	CoverURL    *string   `json:"cover_url,omitempty"`
}

// ContributeRequest is the body for POST /crowdfunding/campaigns/:id/contribute.
type ContributeRequest struct {
	AmountKobo     int64  `json:"amount_kobo" binding:"required,min=100"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}
