package crowdfunding

import "time"

// ─── Response DTOs (shapes match the mobile/admin TypeScript clients) ─────────

// CampaignSummary is the list-card shape (mobile CampaignSummary).
type CampaignSummary struct {
	ID                  string  `json:"id"`
	Title               string  `json:"title"`
	Summary             string  `json:"summary"`
	Type                string  `json:"type"`
	Status              string  `json:"status"` // client CampaignStatus (review_status)
	Category            string  `json:"category"`
	CategoryLabel       string  `json:"categoryLabel"`
	CoverImage          *string `json:"coverImage"`
	GoalKobo            int64   `json:"goalKobo"`
	RaisedKobo          int64   `json:"raisedKobo"`
	Currency            string  `json:"currency"`
	ContributorCount    int     `json:"contributorCount"`
	Deadline            *string `json:"deadline"`
	Verified            bool    `json:"verified"`
	Featured            bool    `json:"featured"`
	Trending            bool    `json:"trending"`
	Urgent              bool    `json:"urgent"`
	Saved               bool    `json:"saved"`
	Location            *string `json:"location"`
	CreatorName         string  `json:"creatorName"`
	CreatorType         string  `json:"creatorType"`
	CreatorVerification string  `json:"creatorVerification"`
}

// CategoryDTO matches the client CampaignCategory.
type CategoryDTO struct {
	ID            string `json:"id"`
	Slug          string `json:"slug"`
	Label         string `json:"label"`
	Icon          string `json:"icon"`
	Tint          string `json:"tint"`
	CampaignCount int    `json:"campaignCount"`
}

// AdminStats matches the admin CfPlatformStats (subset that we can derive live).
type AdminStats struct {
	TotalCampaigns      int   `json:"totalCampaigns"`
	ActiveCampaigns     int   `json:"activeCampaigns"`
	PendingReview       int   `json:"pendingReview"`
	RejectedCampaigns   int   `json:"rejectedCampaigns"`
	TotalRaisedKobo     int64 `json:"totalRaisedKobo"`
	PlatformRevenueKobo int64 `json:"platformRevenueKobo"`
	EscrowKobo          int64 `json:"escrowKobo"`
}

// reviewRow is the internal row scanned for list/detail queries.
type reviewRow struct {
	id, title, summary, story, typ, reviewStatus, category, currency string
	disbursementModel, refundPolicy, riskLevel                       string
	coverURL, location, adminNote                                    *string
	goalKobo, raisedKobo                                             int64
	contributorCount, riskScore                                      int
	verified, featured, trending, urgent                             bool
	deadline                                                         time.Time
	submittedAt, createdAt                                           time.Time
	creatorID                                                        string
}

// ─── Request DTOs ────────────────────────────────────────────────────────────

// SubmitCampaignRequest is the body for the full create/submit flow.
type SubmitCampaignRequest struct {
	Type              string  `json:"type" binding:"required"`
	Category          string  `json:"category" binding:"required"`
	Title             string  `json:"title" binding:"required,min=2,max=200"`
	Summary           string  `json:"summary"`
	Story             string  `json:"story"`
	GoalKobo          int64   `json:"goalKobo" binding:"required,min=100"`
	Deadline          *string `json:"deadline"`
	Location          string  `json:"location"`
	RefundPolicy      string  `json:"refundPolicy"`
	DisbursementModel string  `json:"disbursementModel"`
	CoverImageURL     *string `json:"coverImageUrl"`
	SubmitForReview   bool    `json:"submitForReview"`
}

// ReviewDecisionRequest is the body for admin POST /campaigns/:id/decision.
type ReviewDecisionRequest struct {
	Decision string `json:"decision" binding:"required"` // APPROVE | REJECT | REQUEST_CHANGES | FREEZE | UNFREEZE
	Note     string `json:"note"`
}
