// Package disbursement holds the multi-provider payout registry, the deterministic
// mock fallback, and the auto-failover chooser. It is provider-agnostic: every
// concrete client (Paystack, Monnify) is wrapped so the corridor stays routable
// offline (blank creds / transport error → deterministic mock), mirroring the FX
// orchestration adapters/*_live.go live-vs-mock seam.

package disbursement

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/internal/provider"
	"strings"
)

// Registry holds the configured disbursement providers by name, a configurable
// default, and a failover flag. Selection tries the default first and, when
// failover is enabled, walks the remaining providers in registration order on
// any error.
type Registry struct {
	providers   []provider.DisbursementProvider
	byName      map[string]provider.DisbursementProvider
	defaultName string
	failover    bool
}

// Config configures the registry.
type Config struct {
	DefaultProvider string // e.g. "paystack"
	FailoverEnabled bool
}

// NewRegistry builds a registry from the given providers (registration order is
// the failover order). The default is moved to the front of the failover chain.
func NewRegistry(cfg Config, providers ...provider.DisbursementProvider) *Registry {
	byName := make(map[string]provider.DisbursementProvider, len(providers))
	for _, p := range providers {
		if p != nil {
			byName[p.Name()] = p
		}
	}
	defaultName := cfg.DefaultProvider
	if _, ok := byName[defaultName]; !ok && len(providers) > 0 {
		defaultName = providers[0].Name()
	}
	return &Registry{
		providers:   providers,
		byName:      byName,
		defaultName: defaultName,
		failover:    cfg.FailoverEnabled,
	}
}

// Default returns the configured default provider name.
func (r *Registry) Default() string { return r.defaultName }

// ByName returns a specific provider (used to route inbound webhooks by provider).
func (r *Registry) ByName(name string) (provider.DisbursementProvider, bool) {
	p, ok := r.byName[name]
	return p, ok
}

// Names returns the registered provider names in failover order.
func (r *Registry) Names() []string {
	out := make([]string, 0, len(r.providers))
	for _, p := range r.providers {
		out = append(out, p.Name())
	}
	return out
}

// failoverOrder computes the ordered list of provider names to attempt, starting
// from the default and (when failover is on) appending the rest in registration
// order. Pure logic — unit-tested without any network. When preferred is set and
// known it is tried first instead of the default.
func failoverOrder(names []string, defaultName, preferred string, failover bool) []string {
	pick := defaultName
	known := false
	for _, n := range names {
		if preferred != "" && n == preferred {
			pick = preferred
			known = true
			break
		}
	}
	if preferred != "" && !known {
		pick = defaultName // preferred unknown → fall back to default
	}
	order := make([]string, 0, len(names))
	for _, n := range names {
		if n == pick {
			order = append([]string{n}, order...) // ensure pick is first
		}
	}
	if len(order) == 0 && len(names) > 0 {
		order = append(order, names[0])
	}
	if !failover {
		return order[:min(1, len(order))]
	}
	seen := map[string]bool{}
	for _, n := range order {
		seen[n] = true
	}
	for _, n := range names {
		if !seen[n] {
			order = append(order, n)
			seen[n] = true
		}
	}
	return order
}

// PayoutResult reports which provider ultimately succeeded and the provider's
// normalized payout response, plus the provider we failed over from (if any).
type PayoutResult struct {
	Provider      string
	FailoverFrom  string
	Response      *provider.PayoutResponse
	RecipientCode string
}

// InitiatePayoutFailover resolves/creates a recipient and initiates a payout,
// failing over to the next provider on error. preferred (optional) overrides the
// default. recipientByProvider lets the caller pass an already-cached recipient
// code keyed by provider name (skips CreateTransferRecipient when present).
func (r *Registry) InitiatePayoutFailover(
	ctx context.Context,
	preferred string,
	rcpReq provider.RecipientRequest,
	recipientByProvider map[string]string,
	amountKobo int64,
	reference, narration string,
) (*PayoutResult, error) {
	order := failoverOrder(r.Names(), r.defaultName, preferred, r.failover)
	if len(order) == 0 {
		return nil, fmt.Errorf("disbursement: no providers configured")
	}
	var firstTried string
	var lastErr error
	for i, name := range order {
		p, ok := r.byName[name]
		if !ok {
			continue
		}
		if i == 0 {
			firstTried = name
		}
		// Recipient: reuse cached code, else create with the provider.
		rcpCode := recipientByProvider[name]
		if rcpCode == "" {
			rcp, err := p.CreateTransferRecipient(ctx, rcpReq)
			if err != nil {
				lastErr = err
				continue
			}
			rcpCode = rcp.Code
		}
		resp, err := p.InitiatePayout(ctx, provider.PayoutRequest{
			RecipientCode:  rcpCode,
			AmountKobo:     amountKobo,
			Reference:      reference,
			Narration:      narration,
			IdempotencyKey: reference,
		})
		if err != nil {
			lastErr = err
			continue
		}
		res := &PayoutResult{Provider: name, Response: resp, RecipientCode: rcpCode}
		if name != firstTried {
			res.FailoverFrom = firstTried
		}
		return res, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("disbursement: all providers failed")
	}
	return nil, fmt.Errorf("disbursement: failover exhausted: %w", lastErr)
}

// ResolveAccountFailover resolves a NUBAN across providers (default first).
func (r *Registry) ResolveAccountFailover(ctx context.Context, preferred, bankCode, accountNumber string) (*provider.AccountResolution, string, error) {
	order := failoverOrder(r.Names(), r.defaultName, preferred, r.failover)
	var lastErr error
	for _, name := range order {
		p, ok := r.byName[name]
		if !ok {
			continue
		}
		res, err := p.ResolveAccount(ctx, bankCode, accountNumber)
		if err != nil {
			lastErr = err
			continue
		}
		return res, name, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("disbursement: no providers configured")
	}
	return nil, "", lastErr
}

// ListBanksFailover returns banks from the default provider, failing over.
func (r *Registry) ListBanksFailover(ctx context.Context, preferred string) ([]provider.Bank, string, error) {
	order := failoverOrder(r.Names(), r.defaultName, preferred, r.failover)
	var lastErr error
	for _, name := range order {
		p, ok := r.byName[name]
		if !ok {
			continue
		}
		banks, err := p.ListBanks(ctx)
		if err != nil {
			lastErr = err
			continue
		}
		return banks, name, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("disbursement: no providers configured")
	}
	return nil, "", lastErr
}

// liveWrap wraps a real DisbursementProvider with a deterministic mock fallback.
// Read paths (ListBanks/ResolveAccount/GetTransferStatus) degrade to the mock on
// transport error so the corridor stays usable in dev/CI; the MONEY path
// (CreateTransferRecipient/InitiatePayout) does NOT silently fall back — its error
// is surfaced so the registry's cross-provider failover (and the service's
// funds_reserved hold) can decide, never double-spending. Webhook verification
// and parsing always use the real client (the mock is only reached when no real
// client is configured, via NewMock directly).
type liveWrap struct {
	real provider.DisbursementProvider
	mock provider.DisbursementProvider
}

// NewLive wraps a real client (mock-first when real is nil). name tags the mock.
func NewLive(name string, real provider.DisbursementProvider) provider.DisbursementProvider {
	if real == nil {
		return NewMock(name)
	}
	return &liveWrap{real: real, mock: NewMock(name)}
}

func (w *liveWrap) Name() string { return w.real.Name() }

func (w *liveWrap) ListBanks(ctx context.Context) ([]provider.Bank, error) {
	banks, err := w.real.ListBanks(ctx)
	if err != nil || len(banks) == 0 {
		return w.mock.ListBanks(ctx)
	}
	return banks, nil
}

func (w *liveWrap) ResolveAccount(ctx context.Context, bankCode, accountNumber string) (*provider.AccountResolution, error) {
	res, err := w.real.ResolveAccount(ctx, bankCode, accountNumber)
	if err != nil || res == nil {
		return w.mock.ResolveAccount(ctx, bankCode, accountNumber)
	}
	return res, nil
}

func (w *liveWrap) CreateTransferRecipient(ctx context.Context, req provider.RecipientRequest) (*provider.Recipient, error) {
	// Money-adjacent: surface the real error so failover can act.
	return w.real.CreateTransferRecipient(ctx, req)
}

func (w *liveWrap) InitiatePayout(ctx context.Context, req provider.PayoutRequest) (*provider.PayoutResponse, error) {
	// Money path: never silently mock — the registry handles failover.
	return w.real.InitiatePayout(ctx, req)
}

func (w *liveWrap) GetTransferStatus(ctx context.Context, providerRef string) (*provider.PayoutStatus, error) {
	res, err := w.real.GetTransferStatus(ctx, providerRef)
	if err != nil || res == nil {
		return w.mock.GetTransferStatus(ctx, providerRef)
	}
	return res, nil
}

func (w *liveWrap) VerifyWebhookSignature(payload []byte, signature string) bool {
	return w.real.VerifyWebhookSignature(payload, signature)
}

func (w *liveWrap) ParseWebhook(payload []byte) (*provider.WebhookEvent, error) {
	return w.real.ParseWebhook(payload)
}

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
	return cryptox.Fingerprint(s)
}
