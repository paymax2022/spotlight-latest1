package vertofx

import (
	"context"
	"errors"
	"net/http"
	"net/url"
)

// Sub-account scoping (design spec V8): Verto addresses a sub-account either by
// a companyId path segment or a header. Every scoped call builds its path here
// so flipping the convention is a one-function change.
func scopedPath(companyID, suffix string) string {
	return "/" + url.PathEscape(companyID) + suffix
}

func onboardingPath(companyID, suffix string) string {
	return "/companies/" + url.PathEscape(companyID) + suffix
}

var errNoCompany = errors.New("vertofx: companyID is required")

// SubAccountInput creates a Verto sub-account (POST /v2/sub-accounts).
type SubAccountInput struct {
	Name                 string `json:"name"`
	Country              string `json:"country"`
	SubCategory          string `json:"subCategory,omitempty"`
	IdentificationNumber string `json:"identificationNumber"`
	AccountType          string `json:"accountType"` // "individual" | "business"
}

// SubAccount is a Verto sub-account and its onboarding status.
type SubAccount struct {
	CompanyID string `json:"companyId"`
	Status    string `json:"status"`
}

// CreateSubAccount opens a sub-account. Not auto-retried (non-idempotent POST);
// callers dedupe on IdentificationNumber.
func (c *Client) CreateSubAccount(ctx context.Context, in SubAccountInput) (SubAccount, error) {
	if !c.live() {
		return SubAccount{CompanyID: "mock-sub-" + in.IdentificationNumber, Status: "pending"}, nil
	}
	var resp struct {
		Data SubAccount `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, "/v2/sub-accounts", in, &resp, false); err != nil {
		return SubAccount{}, err
	}
	if resp.Data.CompanyID == "" {
		return SubAccount{}, errors.New("vertofx: create sub-account: invalid response")
	}
	return resp.Data, nil
}

// OnboardingData is the KYB/KYC payload for a sub-account.
type OnboardingData struct {
	LegalName          string            `json:"legalName"`
	RegistrationNumber string            `json:"registrationNumber"`
	Country            string            `json:"country"`
	Address            string            `json:"address,omitempty"`
	Email              string            `json:"email,omitempty"`
	Phone              string            `json:"phone,omitempty"`
	DocumentIDs        []string          `json:"documentIds,omitempty"`
	Extra              map[string]string `json:"extra,omitempty"`
}

// SubmitOnboarding posts KYB/KYC data (POST /companies/{companyId}/onboarding-data).
func (c *Client) SubmitOnboarding(ctx context.Context, companyID string, data OnboardingData) error {
	if companyID == "" {
		return errNoCompany
	}
	if !c.live() {
		return nil
	}
	return c.do(ctx, http.MethodPost, onboardingPath(companyID, "/onboarding-data"), data, nil, false)
}

// GetSubAccount fetches current sub-account status (GET /v2/sub-accounts/{id}).
func (c *Client) GetSubAccount(ctx context.Context, companyID string) (SubAccount, error) {
	if companyID == "" {
		return SubAccount{}, errNoCompany
	}
	if !c.live() {
		return SubAccount{CompanyID: companyID, Status: "pending"}, nil
	}
	var resp struct {
		Data SubAccount `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, "/v2/sub-accounts/"+url.PathEscape(companyID), nil, &resp, true); err != nil {
		return SubAccount{}, err
	}
	return resp.Data, nil
}

// Wallet is a currency wallet under a sub-account.
type Wallet struct {
	WalletID string `json:"walletId"`
	Currency string `json:"currency"`
	Status   string `json:"status"`
}

// EnsureWallet returns the sub-account's wallet for currency, creating it only
// if absent (GET then POST /{companyId}/wallets), so repeat calls yield one
// logical wallet.
func (c *Client) EnsureWallet(ctx context.Context, companyID, currency string) (Wallet, error) {
	if companyID == "" {
		return Wallet{}, errNoCompany
	}
	if currency == "" {
		return Wallet{}, errors.New("vertofx: currency is required")
	}
	if !c.live() {
		return Wallet{WalletID: "mock-wallet-" + companyID + "-" + currency, Currency: currency, Status: "active"}, nil
	}
	path := scopedPath(companyID, "/wallets")
	var list struct {
		Data []Wallet `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, path, nil, &list, true); err != nil {
		return Wallet{}, err
	}
	for _, w := range list.Data {
		if w.Currency == currency && w.WalletID != "" {
			return w, nil
		}
	}
	var created struct {
		Data Wallet `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, path, map[string]string{"currency": currency}, &created, false); err != nil {
		return Wallet{}, err
	}
	if created.Data.WalletID == "" {
		return Wallet{}, errors.New("vertofx: create wallet: invalid response")
	}
	return created.Data, nil
}

// GetFundingDetails lists funding methods for a sub-account currency (GET
// /{companyId}/funding-methods?currency=...). The returned Funding mirrors the
// dedicated method when present (else the first), with all in Methods.
func (c *Client) GetFundingDetails(ctx context.Context, companyID, currency string) (Funding, error) {
	if companyID == "" {
		return Funding{}, errNoCompany
	}
	if !c.live() {
		f := Funding{AccountName: "Mock Verto " + currency, AccountNumber: "0000000001", BankName: "Mock Bank", BankCode: "000", Reference: "mock-" + companyID, Mode: "dedicated"}
		f.Methods = []Funding{f}
		return f, nil
	}
	path := scopedPath(companyID, "/funding-methods") + "?currency=" + url.QueryEscape(currency)
	var resp struct {
		Data []Funding `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, path, nil, &resp, true); err != nil {
		return Funding{}, err
	}
	if len(resp.Data) == 0 {
		return Funding{}, errors.New("vertofx: funding details: none returned")
	}
	out := resp.Data[0]
	for _, m := range resp.Data {
		if m.Mode == "dedicated" {
			out = m
			break
		}
	}
	out.Methods = resp.Data
	return out, nil
}

// UploadLinkInput requests a pre-signed document upload URL.
type UploadLinkInput struct {
	DocumentType string `json:"documentType"`
	FileName     string `json:"fileName"`
	ContentType  string `json:"contentType,omitempty"`
}

// UploadLink is a pre-signed upload URL plus the Verto document id.
type UploadLink struct {
	URL        string `json:"uploadUrl"`
	DocumentID string `json:"documentId"`
}

// GenerateUploadLink asks Verto for a pre-signed onboarding-document upload
// URL (path unconfirmed, see Appendix B).
func (c *Client) GenerateUploadLink(ctx context.Context, companyID string, in UploadLinkInput) (UploadLink, error) {
	if companyID == "" {
		return UploadLink{}, errNoCompany
	}
	if !c.live() {
		return UploadLink{URL: "https://mock.vertofx.invalid/upload/" + companyID + "/" + in.FileName, DocumentID: "mock-doc-" + in.FileName}, nil
	}
	var resp struct {
		Data UploadLink `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, onboardingPath(companyID, "/documents/upload-link"), in, &resp, false); err != nil {
		return UploadLink{}, err
	}
	if resp.Data.URL == "" {
		return UploadLink{}, errors.New("vertofx: upload link: invalid response")
	}
	return resp.Data, nil
}
