// Package onboarding holds the provider-agnostic "Global Account" onboarding
// domain: model and state machine. It must not import any provider package.
package onboarding

import "time"

// SubjectType says whether the account holder is a person (sole-prop) or a business.
type SubjectType string

const (
	SubjectIndividual SubjectType = "individual"
	SubjectBusiness   SubjectType = "business"
)

// Status is the provider-normalised onboarding state.
type Status string

const (
	StatusNotStarted  Status = "NOT_STARTED"
	StatusSubmitted   Status = "SUBMITTED"
	StatusInReview    Status = "IN_REVIEW"
	StatusAwaitingTnC Status = "AWAITING_TNC"
	StatusActive      Status = "ACTIVE"
	StatusRejected    Status = "REJECTED"
	StatusSuspended   Status = "SUSPENDED"
)

// GlobalAccount is a user's provider-side account (e.g. a Verto sub-account).
type GlobalAccount struct {
	ID                string
	UserID            string
	Provider          string
	SubjectType       SubjectType
	ProviderCompanyID string
	Status            Status
	// PriorStatus is the status held before a suspension; reinstatement
	// returns to it. Empty unless Status == StatusSuspended.
	PriorStatus     Status
	RejectionReason string
	CreatedAt       time.Time
	SubmittedAt     *time.Time
	ApprovedAt      *time.Time
	TnCAcceptedAt   *time.Time
	UpdatedAt       time.Time
}

// ProviderWallet is a currency wallet provisioned at the provider.
type ProviderWallet struct {
	ID               string
	AccountID        string
	Currency         string
	ProviderWalletID string
	CreatedAt        time.Time
}

// FundingDetail is a funding (collection) instruction for a provider wallet.
type FundingDetail struct {
	ID            string
	WalletID      string
	Currency      string
	AccountName   string
	AccountNumber string
	BankName      string
	BankCode      string
	Reference     string
	CreatedAt     time.Time
}

// Consent records a user's acceptance of a terms document.
type Consent struct {
	ID         string
	AccountID  string
	Document   string
	Version    string
	AcceptedAt time.Time
	IP         string
	Device     string
}
