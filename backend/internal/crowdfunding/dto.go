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

// CategoryStat is one row of AdminStats.CategoryBreakdown.
type CategoryStat struct {
	Category   string `json:"category"`
	Count      int    `json:"count"`
	RaisedKobo int64  `json:"raisedKobo"`
}

// AdminStats matches the admin CfPlatformStats. Every field is derived live
// from a real table; PaymentSuccessRate is the one exception — there is no
// payment-attempt/failure log for crowdfunding contributions (only successful
// contributions are ever inserted), so it stays 0 rather than being computed
// from an unrelated proxy (e.g. refund rate) that would misrepresent it.
type AdminStats struct {
	TotalCampaigns         int            `json:"totalCampaigns"`
	ActiveCampaigns        int            `json:"activeCampaigns"`
	PendingReview          int            `json:"pendingReview"`
	RejectedCampaigns      int            `json:"rejectedCampaigns"`
	TotalRaisedKobo        int64          `json:"totalRaisedKobo"`
	PlatformRevenueKobo    int64          `json:"platformRevenueKobo"`
	EscrowKobo             int64          `json:"escrowKobo"`
	WithdrawalsPending     int            `json:"withdrawalsPending"`
	WithdrawalsPendingKobo int64          `json:"withdrawalsPendingKobo"`
	RefundRequests         int            `json:"refundRequests"`
	FraudAlerts            int            `json:"fraudAlerts"`
	OpenTickets            int            `json:"openTickets"`
	PaymentSuccessRate     float64        `json:"paymentSuccessRate"` // 0-100; see type comment
	CategoryBreakdown      []CategoryStat `json:"categoryBreakdown"`
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
	// Milestones the wizard collected. Until now the DTO accepted none of them, so
	// the creator filled in a funding plan and the server dropped it on the floor —
	// the client's own comment in crowdfunding.api.ts says exactly that.
	Milestones []SubmitMilestoneRequest `json:"milestones"`
}

// SubmitMilestoneRequest is one milestone from the create wizard.
//
// Status is accepted but CONSTRAINED: see submitMilestoneStatus. RELEASED and
// PENDING_REVIEW are states a milestone earns through review and disbursement,
// never states a creator may declare about their own campaign.
type SubmitMilestoneRequest struct {
	Title      string  `json:"title"`
	TargetKobo int64   `json:"targetKobo"`
	Status     string  `json:"status"`
	DueAt      *string `json:"dueAt"`
}

// ReviewDecisionRequest is the body for admin POST /campaigns/:id/decision.
type ReviewDecisionRequest struct {
	Decision string `json:"decision" binding:"required"` // APPROVE | REJECT | REQUEST_CHANGES | FREEZE | UNFREEZE
	Note     string `json:"note"`
}
