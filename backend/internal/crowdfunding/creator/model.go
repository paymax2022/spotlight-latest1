// Package creator exposes the crowdfunding creator-dashboard slice: contributor
// lists, the caller's contributions and refund requests, creator stats and
// campaigns, withdrawals, notifications, campaign analytics, milestones, reward
// fulfilment, and saved / recently-viewed campaigns.
//
// IRON RULES enforced here:
//   - All monetary amounts are int64 kobo (minor units). Never floats.
//   - Raised totals and contributor counts are NEVER stored: they are derived
//     from the `contributions` table on every read.
//   - RequestRefund only records intent (flags the contribution); it NEVER moves
//     money — an admin handles the actual refund in a separate slice.
package creator

// ─── Response DTOs (field names match the mobile TypeScript contract exactly) ──

// Contributor mirrors the client Contributor type.
type Contributor struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
	AmountKobo  int64   `json:"amountKobo"`
	Message     *string `json:"message"`
	Anonymous   bool    `json:"anonymous"`
	CreatedAt   string  `json:"createdAt"`
}

// Contribution mirrors the client Contribution type (the caller's own record).
type Contribution struct {
	ID              string  `json:"id"`
	Reference       string  `json:"reference"`
	CampaignID      string  `json:"campaignId"`
	CampaignTitle   string  `json:"campaignTitle"`
	CampaignCover   *string `json:"campaignCover"`
	AmountKobo      int64   `json:"amountKobo"`
	FeeKobo         int64   `json:"feeKobo"`
	TotalKobo       int64   `json:"totalKobo"`
	Currency        string  `json:"currency"`
	Status          string  `json:"status"` // ContributionStatus
	PaymentMethod   string  `json:"paymentMethod"`
	Anonymous       bool    `json:"anonymous"`
	Message         *string `json:"message"`
	RewardTierTitle *string `json:"rewardTierTitle"`
	CreatedAt       string  `json:"createdAt"`
	RefundEligible  bool    `json:"refundEligible"`
}

// CreatorStats mirrors the client CreatorStats type. Balances are derived.
type CreatorStats struct {
	TotalRaisedKobo      int64   `json:"totalRaisedKobo"`
	ContributorCount     int     `json:"contributorCount"`
	ActiveCampaigns      int     `json:"activeCampaigns"`
	TotalCampaigns       int     `json:"totalCampaigns"`
	AvailableBalanceKobo int64   `json:"availableBalanceKobo"`
	PendingBalanceKobo   int64   `json:"pendingBalanceKobo"`
	EscrowBalanceKobo    int64   `json:"escrowBalanceKobo"`
	ViewsThisWeek        int     `json:"viewsThisWeek"`
	ConversionRate       float64 `json:"conversionRate"`
}

// CreatorContribution mirrors the client CreatorContribution type.
type CreatorContribution struct {
	ID              string `json:"id"`
	ContributorName string `json:"contributorName"`
	CampaignTitle   string `json:"campaignTitle"`
	AmountKobo      int64  `json:"amountKobo"`
	CreatedAt       string `json:"createdAt"`
	Anonymous       bool   `json:"anonymous"`
}

// CreatorWithdrawal mirrors the client CreatorWithdrawal type.
type CreatorWithdrawal struct {
	ID            string  `json:"id"`
	Reference     string  `json:"reference"`
	CampaignTitle string  `json:"campaignTitle"`
	AmountKobo    int64   `json:"amountKobo"`
	Status        string  `json:"status"` // WithdrawalStatus
	BankLabel     string  `json:"bankLabel"`
	RequestedAt   string  `json:"requestedAt"`
	Note          *string `json:"note"`
}

// CreatorNotification mirrors the client CreatorNotification type.
type CreatorNotification struct {
	ID        string `json:"id"`
	Type      string `json:"type"` // CreatorNotificationType
	Title     string `json:"title"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
	Read      bool   `json:"read"`
}

// TrafficSource mirrors the client TrafficSource type.
type TrafficSource struct {
	Source        string `json:"source"`
	Visits        int    `json:"visits"`
	Contributions int    `json:"contributions"`
}

// DailyRaised mirrors a single element of CampaignAnalytics.dailyRaised.
type DailyRaised struct {
	Date       string `json:"date"`
	RaisedKobo int64  `json:"raisedKobo"`
}

// CampaignAnalytics mirrors the client CampaignAnalytics type.
type CampaignAnalytics struct {
	CampaignID              string          `json:"campaignId"`
	Views                   int             `json:"views"`
	Shares                  int             `json:"shares"`
	ConversionRate          float64         `json:"conversionRate"`
	AverageContributionKobo int64           `json:"averageContributionKobo"`
	DailyRaised             []DailyRaised   `json:"dailyRaised"`
	TrafficSources          []TrafficSource `json:"trafficSources"`
}

// CampaignMilestone mirrors the client CampaignMilestone type.
type CampaignMilestone struct {
	ID            string  `json:"id"`
	Title         string  `json:"title"`
	TargetKobo    int64   `json:"targetKobo"`
	Status        string  `json:"status"` // LOCKED | ACTIVE | RELEASED | PENDING_REVIEW
	DueAt         *string `json:"dueAt"`
	EvidenceCount int     `json:"evidenceCount"`
}

// RewardBacker mirrors the client RewardBacker type.
type RewardBacker struct {
	ID               string  `json:"id"`
	BackerName       string  `json:"backerName"`
	RewardTierTitle  string  `json:"rewardTierTitle"`
	AmountKobo       int64   `json:"amountKobo"`
	Status           string  `json:"status"` // RewardFulfilmentStatus
	ShippingCity     *string `json:"shippingCity"`
	RequiresShipping bool    `json:"requiresShipping"`
	ClaimedAt        string  `json:"claimedAt"`
}

// CampaignSummary mirrors the client CampaignSummary type (list cards).
type CampaignSummary struct {
	ID                  string  `json:"id"`
	Title               string  `json:"title"`
	Summary             string  `json:"summary"`
	Type                string  `json:"type"`
	Status              string  `json:"status"`
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

// ─── Request DTOs ────────────────────────────────────────────────────────────

// RefundRequestInput is the body for POST /contributions/:id/refund-request.
type RefundRequestInput struct {
	Reason string `json:"reason"`
}

// RewardStatusInput is the body for PUT /rewards/fulfilment/:id.
type RewardStatusInput struct {
	Status string `json:"status" binding:"required"`
}
