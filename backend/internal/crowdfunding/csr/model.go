package csr

// Response/request DTOs — shapes match the mobile TypeScript client EXACTLY
// (camelCase JSON). See mobile-app/reactnative/src/features/crowdfunding/types/csr.types.ts.
// All monetary amounts are integers in minor units (kobo).

// CsrProfile mirrors the client CsrProfile.
type CsrProfile struct {
	CompanyName        string `json:"companyName"`
	Verified           bool   `json:"verified"`
	AnnualBudgetKobo   int64  `json:"annualBudgetKobo"`
	CommittedKobo      int64  `json:"committedKobo"`
	MatchedKobo        int64  `json:"matchedKobo"`
	CampaignsSupported int    `json:"campaignsSupported"`
	EmployeesGiving    int    `json:"employeesGiving"`
}

// MatchableCampaign mirrors the client MatchableCampaign.
type MatchableCampaign struct {
	ID               string  `json:"id"`
	Title            string  `json:"title"`
	Category         string  `json:"category"`
	CoverImage       *string `json:"coverImage"`
	RaisedKobo       int64   `json:"raisedKobo"`
	GoalKobo         int64   `json:"goalKobo"`
	ContributorCount int     `json:"contributorCount"`
	Verified         bool    `json:"verified"`
	ImpactTag        string  `json:"impactTag"`
}

// CsrMatch mirrors the client CsrMatch.
type CsrMatch struct {
	ID            string `json:"id"`
	CampaignID    string `json:"campaignId"`
	CampaignTitle string `json:"campaignTitle"`
	Ratio         string `json:"ratio"` // MatchRatio: 1:1 | 2:1 | 0.5:1
	CapKobo       int64  `json:"capKobo"`
	MatchedKobo   int64  `json:"matchedKobo"`
	Status        string `json:"status"` // CsrMatchStatus
	StartedAt     string `json:"startedAt"`
	Visibility    string `json:"visibility"` // PUBLIC | ANONYMOUS
}

// MatchSetupInput mirrors the client MatchSetupInput (request body for POST /matches).
type MatchSetupInput struct {
	CampaignID string `json:"campaignId" binding:"required"`
	Ratio      string `json:"ratio" binding:"required,oneof=1:1 2:1 0.5:1"`
	CapKobo    int64  `json:"capKobo" binding:"required,min=100"`
	Visibility string `json:"visibility" binding:"required,oneof=PUBLIC ANONYMOUS"`
	Message    string `json:"message"`
}

// CsrInvoice mirrors the client CsrInvoice.
type CsrInvoice struct {
	ID          string `json:"id"`
	Reference   string `json:"reference"`
	Description string `json:"description"`
	AmountKobo  int64  `json:"amountKobo"`
	VatKobo     int64  `json:"vatKobo"`
	TotalKobo   int64  `json:"totalKobo"`
	Status      string `json:"status"` // PAID | DUE
	IssuedAt    string `json:"issuedAt"`
}

// CategoryMatched is a {category, matchedKobo} pair (CsrImpactSummary.byCategory).
type CategoryMatched struct {
	Category    string `json:"category"`
	MatchedKobo int64  `json:"matchedKobo"`
}

// MonthlyMatched is a {month, matchedKobo} pair (CsrImpactSummary.monthly).
type MonthlyMatched struct {
	Month       string `json:"month"`
	MatchedKobo int64  `json:"matchedKobo"`
}

// CsrImpactSummary mirrors the client CsrImpactSummary.
type CsrImpactSummary struct {
	TotalMatchedKobo   int64             `json:"totalMatchedKobo"`
	LivesImpacted      int               `json:"livesImpacted"`
	CampaignsSupported int               `json:"campaignsSupported"`
	TopCategory        string            `json:"topCategory"`
	ByCategory         []CategoryMatched `json:"byCategory"`
	Monthly            []MonthlyMatched  `json:"monthly"`
}

// EmployeeGivingCampaign mirrors the client EmployeeGivingCampaign.
type EmployeeGivingCampaign struct {
	ID                string `json:"id"`
	Title             string `json:"title"`
	GoalKobo          int64  `json:"goalKobo"`
	RaisedKobo        int64  `json:"raisedKobo"`
	Participants      int    `json:"participants"`
	EndsAt            string `json:"endsAt"`
	CompanyMatchRatio string `json:"companyMatchRatio"` // MatchRatio
}
