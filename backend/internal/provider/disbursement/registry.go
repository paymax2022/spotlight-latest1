package disbursement

import (
	"context"
	"fmt"

	"spotlight/backend/internal/provider"
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
		return order[:minInt(1, len(order))]
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

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// PayoutResult reports which provider ultimately succeeded and the provider's
// normalized payout response, plus the provider we failed over from (if any).
type PayoutResult struct {
	Provider     string
	FailoverFrom string
	Response     *provider.PayoutResponse
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
