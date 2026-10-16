package onboarding

import (
	"context"
	"time"
)

// Clock abstracts time so the domain is deterministic under test.
type Clock interface {
	Now() time.Time
}

// SubAccountProvider is the provider-side account lifecycle. It is satisfied by
// a thin adapter over the provider client; the domain never imports it.
type SubAccountProvider interface {
	// CreateSubAccount opens a provider account. Not auto-retried; callers
	// dedupe on SubAccountInput.IdentificationNumber.
	CreateSubAccount(ctx context.Context, in SubAccountInput) (ProviderAccount, error)
	// SubmitOnboarding submits the KYB/KYC payload for a provider company.
	SubmitOnboarding(ctx context.Context, providerCompanyID string, payload OnboardingPayload) error
	// GetSubAccount fetches the current provider status (used to confirm webhooks).
	GetSubAccount(ctx context.Context, providerCompanyID string) (ProviderAccount, error)
	// GenerateUploadLink returns a pre-signed upload URL for an onboarding document.
	GenerateUploadLink(ctx context.Context, providerCompanyID string, in UploadLinkInput) (UploadLink, error)
}

// WalletProvisioner provisions currency wallets and reads funding details.
type WalletProvisioner interface {
	// EnsureWallet is idempotent: repeat calls yield one logical wallet.
	EnsureWallet(ctx context.Context, providerCompanyID, currency string) (ProviderWalletRef, error)
	GetFundingDetails(ctx context.Context, providerCompanyID, currency string) (FundingInfo, error)
}

// KYCReader is the read-only view of existing Spotlight KYC (never re-collected).
type KYCReader interface {
	GetKYCView(ctx context.Context, userID string) (KYCView, error)
}

// SubAccountInput opens a provider account.
type SubAccountInput struct {
	Name                 string
	Country              string
	IdentificationNumber string
	SubjectType          SubjectType
}

// ProviderAccount is a provider account with a provider-native status string.
type ProviderAccount struct {
	CompanyID string
	Status    string
}

// UploadLinkInput requests a pre-signed document upload URL.
type UploadLinkInput struct {
	DocumentTypeID string
	FileName       string
	ContentType    string
}

// UploadLink is a pre-signed upload URL plus the provider document id.
type UploadLink struct {
	URL        string
	DocumentID string
}

// ProviderWalletRef identifies a provisioned provider wallet.
type ProviderWalletRef struct {
	WalletID string
	Currency string
}

// FundingInfo is a funding instruction as returned by the provider.
type FundingInfo struct {
	AccountName   string
	AccountNumber string
	BankName      string
	BankCode      string
	Reference     string
}

// Address is a postal address (Country is ISO 3166-1 alpha-2).
type Address struct {
	Line1      string
	Line2      string
	City       string
	State      string
	PostalCode string
	Country    string
}

func (a Address) complete() bool {
	return a.Line1 != "" && a.City != "" && a.Country != ""
}

// KYCView is the minimal read view of Spotlight KYC the mapper needs.
type KYCView struct {
	FirstName   string
	LastName    string
	DateOfBirth string // YYYY-MM-DD
	Nationality string // ISO alpha-2
	Address     Address
	HasBVN      bool
	HasNIN      bool
}

// Profile is the Spotlight account profile contact data.
type Profile struct {
	UserID string
	Email  string
	Phone  string
	// Business is required when SubjectType is business.
	Business *BusinessProfile
}

// BusinessProfile is the company data collected for a business account.
type BusinessProfile struct {
	LegalName          string
	RegistrationNumber string
	CompanyType        string
	Country            string
	RegisteredAddress  Address
	OperatingAddress   Address
	Shareholders       []ShareholderInput
}

// ShareholderType distinguishes natural persons from corporate owners.
type ShareholderType string

const (
	ShareholderIndividual ShareholderType = "INDIVIDUAL"
	ShareholderCorporate  ShareholderType = "CORPORATE"
)

// ShareholderInput is one owner in a business ownership topology.
// OwnershipBps is in basis points (10000 = 100%).
type ShareholderInput struct {
	Type               ShareholderType
	Name               string // legal name (corporate) or full name (individual)
	Email              string
	Phone              string
	DateOfBirth        string
	Nationality        string
	Address            Address
	RegistrationNo     string // corporate only
	Country            string // corporate only
	OwnershipBps       int
	ControllingOfficer bool
	Role               string
	Documents          []DocumentRef
}

// DocumentKind classifies an onboarding document; the provider type id is
// resolved from ActivateExtras.DocumentTypeIDs (config, not literals).
type DocumentKind string

const (
	DocIdentity       DocumentKind = "IDENTITY"
	DocAddressProof   DocumentKind = "ADDRESS_PROOF"
	DocIncorporation  DocumentKind = "INCORPORATION"
	DocOwnershipChart DocumentKind = "OWNERSHIP_CHART"
)

// DocumentRef is an already-uploaded document.
type DocumentRef struct {
	Kind       DocumentKind
	DocumentID string
}

// RiskAnswer answers a provider risk-assessment question; QuestionID is config.
type RiskAnswer struct {
	QuestionID string
	Answer     string
}

// ActivateExtras are the provider-specific extras supplied at activation.
type ActivateExtras struct {
	// SelectedProducts overrides DefaultProducts when non-empty.
	SelectedProducts []string
	// DocumentTypeIDs maps a DocumentKind to the provider document-type id.
	DocumentTypeIDs map[DocumentKind]string
	RiskAnswers     []RiskAnswer
	// Documents are company documents (business) or the user's ID + address
	// proof (individual).
	Documents []DocumentRef
}

// OnboardingPayload is the domain representation of the provider onboarding
// data; the adapter translates it to the provider's wire schema.
type OnboardingPayload struct {
	SubjectType      SubjectType
	SelectedProducts []string
	Company          PayloadCompany
	Shareholders     []PayloadShareholder
	Documents        []PayloadDocument
	RiskAnswers      []RiskAnswer
}

// PayloadCompany is the company block.
type PayloadCompany struct {
	LegalName          string
	RegistrationNumber string
	Type               string
	Country            string
	CompanyAddress     Address
	OperatingAddress   Address
}

// PayloadShareholder is one shareholder block.
type PayloadShareholder struct {
	Type               ShareholderType
	Name               string
	Email              string
	Phone              string
	DateOfBirth        string
	Nationality        string
	Address            Address
	RegistrationNo     string
	Country            string
	OwnershipBps       int
	ControllingOfficer bool
	Role               string
	Documents          []PayloadDocument
}

// PayloadDocument is a document tagged with the provider document-type id.
type PayloadDocument struct {
	TypeID     string
	DocumentID string
}
