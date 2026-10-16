// Package verto adapts the VertoFX client to the provider-agnostic onboarding
// ports. It is the only place Verto wire types meet the onboarding domain.
package verto

import (
	"context"
	"encoding/json"
	"strings"

	"spotlight/backend/internal/crossborder/onboarding"
	"spotlight/backend/internal/provider/vertofx"
)

// Client is the slice of *vertofx.Client the adapter uses.
type Client interface {
	CreateSubAccount(ctx context.Context, in vertofx.SubAccountInput) (vertofx.SubAccount, error)
	SubmitOnboarding(ctx context.Context, companyID string, data vertofx.OnboardingData) error
	GetSubAccount(ctx context.Context, companyID string) (vertofx.SubAccount, error)
	GenerateUploadLink(ctx context.Context, companyID string, in vertofx.UploadLinkInput) (vertofx.UploadLink, error)
	EnsureWallet(ctx context.Context, companyID, currency string) (vertofx.Wallet, error)
	GetFundingDetails(ctx context.Context, companyID, currency string) (vertofx.Funding, error)
}

var _ Client = (*vertofx.Client)(nil)

// Adapter satisfies onboarding.SubAccountProvider and onboarding.WalletProvisioner.
type Adapter struct{ c Client }

// New wraps a Verto client.
func New(c Client) *Adapter { return &Adapter{c: c} }

var (
	_ onboarding.SubAccountProvider = (*Adapter)(nil)
	_ onboarding.WalletProvisioner  = (*Adapter)(nil)
)

// CreateSubAccount implements onboarding.SubAccountProvider.
func (a *Adapter) CreateSubAccount(ctx context.Context, in onboarding.SubAccountInput) (onboarding.ProviderAccount, error) {
	sa, err := a.c.CreateSubAccount(ctx, vertofx.SubAccountInput{
		Name: in.Name, Country: in.Country, IdentificationNumber: in.IdentificationNumber,
		AccountType: string(in.SubjectType),
	})
	if err != nil {
		return onboarding.ProviderAccount{}, err
	}
	return onboarding.ProviderAccount{CompanyID: sa.CompanyID, Status: sa.Status}, nil
}

// GetSubAccount implements onboarding.SubAccountProvider.
func (a *Adapter) GetSubAccount(ctx context.Context, companyID string) (onboarding.ProviderAccount, error) {
	sa, err := a.c.GetSubAccount(ctx, companyID)
	if err != nil {
		return onboarding.ProviderAccount{}, err
	}
	return onboarding.ProviderAccount{CompanyID: sa.CompanyID, Status: sa.Status}, nil
}

// GenerateUploadLink implements onboarding.SubAccountProvider.
func (a *Adapter) GenerateUploadLink(ctx context.Context, companyID string, in onboarding.UploadLinkInput) (onboarding.UploadLink, error) {
	l, err := a.c.GenerateUploadLink(ctx, companyID, vertofx.UploadLinkInput{
		DocumentType: in.DocumentTypeID, FileName: in.FileName, ContentType: in.ContentType,
	})
	if err != nil {
		return onboarding.UploadLink{}, err
	}
	return onboarding.UploadLink{URL: l.URL, DocumentID: l.DocumentID}, nil
}

// EnsureWallet implements onboarding.WalletProvisioner.
func (a *Adapter) EnsureWallet(ctx context.Context, companyID, currency string) (onboarding.ProviderWalletRef, error) {
	w, err := a.c.EnsureWallet(ctx, companyID, currency)
	if err != nil {
		return onboarding.ProviderWalletRef{}, err
	}
	return onboarding.ProviderWalletRef{WalletID: w.WalletID, Currency: w.Currency}, nil
}

// GetFundingDetails implements onboarding.WalletProvisioner.
func (a *Adapter) GetFundingDetails(ctx context.Context, companyID, currency string) (onboarding.FundingInfo, error) {
	f, err := a.c.GetFundingDetails(ctx, companyID, currency)
	if err != nil {
		return onboarding.FundingInfo{}, err
	}
	return onboarding.FundingInfo{AccountName: f.AccountName, AccountNumber: f.AccountNumber,
		BankName: f.BankName, BankCode: f.BankCode, Reference: f.Reference}, nil
}

// SubmitOnboarding implements onboarding.SubAccountProvider.
//
// The vertofx client models the onboarding wire body as a FLAT struct
// (vertofx.OnboardingData). The richer structures (shareholders, products,
// risk answers) have no confirmed wire fields yet (design §13 carried gates),
// so they are carried losslessly as JSON strings in Extra rather than being
// dropped; they must be re-mapped to Verto's real schema in sandbox
// verification before FEATURE_SPOTLIGHT_GLOBAL is enabled.
func (a *Adapter) SubmitOnboarding(ctx context.Context, companyID string, p onboarding.OnboardingPayload) error {
	return a.c.SubmitOnboarding(ctx, companyID, toWire(p))
}

func toWire(p onboarding.OnboardingPayload) vertofx.OnboardingData {
	d := vertofx.OnboardingData{
		LegalName:          p.Company.LegalName,
		RegistrationNumber: p.Company.RegistrationNumber,
		Country:            p.Company.Country,
		Address:            joinAddress(p.Company.CompanyAddress),
		Extra:              map[string]string{"company_type": p.Company.Type, "subject_type": string(p.SubjectType)},
	}
	if len(p.Shareholders) > 0 {
		d.Email, d.Phone = p.Shareholders[0].Email, p.Shareholders[0].Phone
	}
	seen := map[string]bool{}
	add := func(docs []onboarding.PayloadDocument) {
		for _, x := range docs {
			if x.DocumentID != "" && !seen[x.DocumentID] {
				seen[x.DocumentID] = true
				d.DocumentIDs = append(d.DocumentIDs, x.DocumentID)
			}
		}
	}
	add(p.Documents)
	for _, s := range p.Shareholders {
		add(s.Documents)
	}
	setJSON := func(k string, v any) {
		if b, err := json.Marshal(v); err == nil {
			d.Extra[k] = string(b)
		}
	}
	setJSON("products", p.SelectedProducts)
	if len(p.RiskAnswers) > 0 {
		setJSON("risk_answers", p.RiskAnswers)
	}
	if len(p.Shareholders) > 0 {
		setJSON("shareholders", p.Shareholders)
	}
	if op := joinAddress(p.Company.OperatingAddress); op != "" {
		d.Extra["operating_address"] = op
	}
	return d
}

func joinAddress(a onboarding.Address) string {
	var parts []string
	for _, s := range []string{a.Line1, a.Line2, a.City, a.State, a.PostalCode, a.Country} {
		if s = strings.TrimSpace(s); s != "" {
			parts = append(parts, s)
		}
	}
	return strings.Join(parts, ", ")
}
