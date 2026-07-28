// Package investment implements the regulated crowdfunding "investment" slice
// (Section L). It is feature-flagged OFF until licensed. All monetary amounts are
// integers in minor units (kobo). Subscriptions are money mutations: they require an
// Idempotency-Key and enforce the annual investment limit fail-closed. An investor
// must have completed onboarding (KYC + education + quiz + risk profile) before they
// can subscribe — enforced server-side.
package investment

// InvestmentModel mirrors the client union 'EQUITY' | 'DEBT' | 'REVENUE_SHARE'.
type InvestmentModel string

// InvestorRiskProfile mirrors 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE'.
type InvestorRiskProfile string

// OfferStatus mirrors 'OPEN' | 'CLOSING_SOON' | 'CLOSED' | 'FUNDED'.
type OfferStatus string

// UseOfProceedsLine is one row of an offer's use-of-proceeds breakdown.
type UseOfProceedsLine struct {
	Label      string `json:"label"`
	AmountKobo int64  `json:"amountKobo"`
}

// InvestmentOffer matches the client InvestmentOffer interface (camelCase).
type InvestmentOffer struct {
	ID                 string              `json:"id"`
	Title              string              `json:"title"`
	IssuerName         string              `json:"issuerName"`
	IssuerVerified     bool                `json:"issuerVerified"`
	Model              InvestmentModel     `json:"model"`
	Summary            string              `json:"summary"`
	CoverImage         *string             `json:"coverImage"`
	TargetKobo         int64               `json:"targetKobo"`
	RaisedKobo         int64               `json:"raisedKobo"`
	MinTicketKobo      int64               `json:"minTicketKobo"`
	InvestorCount      int                 `json:"investorCount"`
	Status             OfferStatus         `json:"status"`
	ClosesAt           string              `json:"closesAt"`
	ProjectedReturnPct int                 `json:"projectedReturnPct"`
	TermMonths         int                 `json:"termMonths"`
	RiskLevel          string              `json:"riskLevel"` // 'MEDIUM' | 'HIGH'
	LockInMonths       int                 `json:"lockInMonths"`
	CoolingOffDays     int                 `json:"coolingOffDays"`
	Sector             string              `json:"sector"`
	Location           string              `json:"location"`
	OfferDocumentLabel string              `json:"offerDocumentLabel"`
	RiskWarnings       []string            `json:"riskWarnings"`
	UseOfProceeds      []UseOfProceedsLine `json:"useOfProceeds"`
}

// InvestorProfile matches the client InvestorProfile interface.
type InvestorProfile struct {
	Onboarded            bool                 `json:"onboarded"`
	KycComplete          bool                 `json:"kycComplete"`
	EducationComplete    bool                 `json:"educationComplete"`
	QuizPassed           bool                 `json:"quizPassed"`
	RiskProfile          *InvestorRiskProfile `json:"riskProfile"`
	AnnualLimitKobo      int64                `json:"annualLimitKobo"`
	InvestedThisYearKobo int64                `json:"investedThisYearKobo"`
}

// EducationModule matches the client EducationModule interface.
type EducationModule struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Body    string `json:"body"`
	Minutes int    `json:"minutes"`
}

// QuizQuestion matches the client QuizQuestion interface.
type QuizQuestion struct {
	ID           string   `json:"id"`
	Question     string   `json:"question"`
	Options      []string `json:"options"`
	CorrectIndex int      `json:"correctIndex"`
}

// InvestmentSubscriptionInput matches the client InvestmentSubscriptionInput interface.
type InvestmentSubscriptionInput struct {
	OfferID           string `json:"offerId" binding:"required"`
	AmountKobo        int64  `json:"amountKobo" binding:"required,min=1"`
	AcceptedRisk      bool   `json:"acceptedRisk"`
	AcceptedAgreement bool   `json:"acceptedAgreement"`
}

// InvestmentCertificate matches the client InvestmentCertificate interface.
type InvestmentCertificate struct {
	ID          string          `json:"id"`
	Reference   string          `json:"reference"`
	OfferTitle  string          `json:"offerTitle"`
	IssuerName  string          `json:"issuerName"`
	AmountKobo  int64           `json:"amountKobo"`
	Model       InvestmentModel `json:"model"`
	UnitsOrPct  string          `json:"unitsOrPct"`
	IssuedAt    string          `json:"issuedAt"`
	LockInUntil string          `json:"lockInUntil"`
}

// PortfolioHolding matches the client PortfolioHolding interface.
type PortfolioHolding struct {
	ID               string          `json:"id"`
	OfferID          string          `json:"offerId"`
	OfferTitle       string          `json:"offerTitle"`
	IssuerName       string          `json:"issuerName"`
	Model            InvestmentModel `json:"model"`
	InvestedKobo     int64           `json:"investedKobo"`
	CurrentValueKobo int64           `json:"currentValueKobo"`
	Status           string          `json:"status"` // 'ACTIVE' | 'EXITED' | 'DEFAULTED'
	InvestedAt       string          `json:"investedAt"`
}

// OnboardingRequest is the POST /investment/onboarding body. `step` advances one
// onboarding gate at a time; `riskProfile` is required when step == "riskProfile".
type OnboardingRequest struct {
	Step        string `json:"step" binding:"required"` // kyc | education | quiz | riskProfile
	RiskProfile string `json:"riskProfile"`
}
