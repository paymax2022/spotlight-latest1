// Package disbursement holds the multi-provider payout registry, the deterministic
// mock fallback, and the auto-failover chooser. It is provider-agnostic: every
// concrete client (Paystack, Monnify) is wrapped so the corridor stays routable
// offline (blank creds / transport error → deterministic mock), mirroring the FX
// orchestration adapters/*_live.go live-vs-mock seam.
package disbursement

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"

	"spotlight/backend/internal/provider"
)

// fallbackBanks is the deterministic bank set returned by the mock. It mirrors the
// payment_banks seed so dev/CI get a stable, non-empty list with no network.
var fallbackBanks = []provider.Bank{
	{Code: "044", Name: "Access Bank", Slug: "access-bank"},
	{Code: "058", Name: "Guaranty Trust Bank", Slug: "gtbank"},
	{Code: "057", Name: "Zenith Bank", Slug: "zenith-bank"},
	{Code: "011", Name: "First Bank of Nigeria", Slug: "first-bank-of-nigeria"},
	{Code: "033", Name: "United Bank for Africa", Slug: "uba"},
	{Code: "232", Name: "Sterling Bank", Slug: "sterling-bank"},
	{Code: "035", Name: "Wema Bank", Slug: "wema-bank"},
	{Code: "50211", Name: "Kuda Bank", Slug: "kuda-bank"},
	{Code: "999992", Name: "OPay", Slug: "opay"},
	{Code: "999991", Name: "PalmPay", Slug: "palmpay"},
}

// FallbackBanks exposes the deterministic mock bank list (also used as the DB
// ListBanks fallback when both providers are unreachable).
func FallbackBanks() []provider.Bank { return fallbackBanks }

// mockProvider is a deterministic in-process DisbursementProvider. It never errors
// (so failover always terminates somewhere) and lets webhooks settle by minting a
// stable provider ref derived from the payout reference.
type mockProvider struct {
	name string
}

// NewMock builds a deterministic mock disbursement provider tagged with name.
func NewMock(name string) provider.DisbursementProvider { return &mockProvider{name: name} }

func (m *mockProvider) Name() string { return m.name }

func (m *mockProvider) ListBanks(ctx context.Context) ([]provider.Bank, error) {
	return fallbackBanks, nil
}

func (m *mockProvider) ResolveAccount(ctx context.Context, bankCode, accountNumber string) (*provider.AccountResolution, error) {
	return &provider.AccountResolution{
		AccountName:   mockAccountName(bankCode, accountNumber),
		AccountNumber: accountNumber,
		BankCode:      bankCode,
	}, nil
}

func (m *mockProvider) CreateTransferRecipient(ctx context.Context, req provider.RecipientRequest) (*provider.Recipient, error) {
	return &provider.Recipient{Code: m.name + "_rcp_" + shortHash(req.BankCode+req.AccountNumber)}, nil
}

func (m *mockProvider) InitiatePayout(ctx context.Context, req provider.PayoutRequest) (*provider.PayoutResponse, error) {
	ref := m.name + "_trf_" + shortHash(req.Reference)
	return &provider.PayoutResponse{
		TransferCode: ref,
		Status:       "pending",
		Reference:    req.Reference,
		ProviderRef:  ref,
	}, nil
}

func (m *mockProvider) GetTransferStatus(ctx context.Context, providerRef string) (*provider.PayoutStatus, error) {
	// Deterministic: mock payouts settle successfully when polled.
	return &provider.PayoutStatus{Status: "successful"}, nil
}

func (m *mockProvider) VerifyWebhookSignature(payload []byte, signature string) bool {
	// The mock accepts the dev signature "mock" so a local webhook can settle.
	return signature == "mock"
}

func (m *mockProvider) ParseWebhook(payload []byte) (*provider.WebhookEvent, error) {
	// Reuse the simple envelope shape; callers in dev post {provider_ref,status,amount_kobo,type}.
	var env struct {
		Type        string `json:"type"`
		ProviderRef string `json:"provider_ref"`
		Reference   string `json:"reference"`
		Status      string `json:"status"`
		AmountKobo  int64  `json:"amount_kobo"`
	}
	_ = json.Unmarshal(payload, &env)
	if env.Type == "" {
		env.Type = "transfer"
	}
	if env.Status == "" {
		env.Status = "successful"
	}
	return &provider.WebhookEvent{
		Type:        env.Type,
		ProviderRef: env.ProviderRef,
		Reference:   env.Reference,
		Status:      env.Status,
		AmountKobo:  env.AmountKobo,
	}, nil
}

func mockAccountName(bankCode, accountNumber string) string {
	// Deterministic fake name so resolve is stable across runs.
	names := []string{"Ada Lovelace", "Chinua Achebe", "Wole Soyinka", "Amina Bello", "Tunde Okafor"}
	h := sha256.Sum256([]byte(bankCode + accountNumber))
	return strings.ToUpper(names[int(h[0])%len(names)])
}

func shortHash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:6])
}
