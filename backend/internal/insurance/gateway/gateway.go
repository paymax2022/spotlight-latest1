package gateway

import (
	"context"
	"fmt"
)

// Named is implemented by every adapter so audit/metrics + logs can identify the
// underwriter aggregator a call was dispatched to (mirrors maps.Named).
type Named interface {
	// Name returns a stable aggregator id, e.g. "mycover", "octamile".
	Name() string
}

// UnderwriterGateway is the single, provider-agnostic capability interface every
// insurtech aggregator adapter implements. Feature code (policy/quote services)
// depends ONLY on this interface; swapping MyCover for Octamile on a product line
// is a routing-table edit, never a code change.
//
// BindPolicy MUST be idempotent on BindRequest.IdempotencyKey — a retried bind
// returns the same policy. This is load-bearing for the debit→bind saga: the saga
// may retry a bind after a transient failure without ever creating two policies.
type UnderwriterGateway interface {
	Named

	GetQuote(ctx context.Context, req QuoteRequest) (Quote, error)
	BindPolicy(ctx context.Context, req BindRequest) (Policy, error)
	GetPolicy(ctx context.Context, providerPolicyRef string) (Policy, error)
	CancelPolicy(ctx context.Context, providerPolicyRef, reason string) (Policy, error)
	SubmitClaim(ctx context.Context, req ClaimRequest) (Claim, error)
	GetClaim(ctx context.Context, providerClaimRef string) (Claim, error)
	UploadEvidence(ctx context.Context, up EvidenceUpload) error
	// VerifyWebhook validates a provider webhook signature and returns the
	// normalised event. SignatureValid is false (and err nil) when the signature
	// does not match — callers MUST reject unverified events.
	VerifyWebhook(ctx context.Context, payload []byte, signature string) (WebhookEvent, error)
}

// ProductResolver is the slice of the catalog the Router needs to map a Paymax
// product_code to (aggregator name, provider_product_code). The catalog package
// implements this; keeping it as an interface keeps the gateway free of a catalog
// import cycle and keeps routing data-driven.
type ProductResolver interface {
	// ResolveProduct returns the aggregator key (e.g. "mycover") and the
	// provider-side product code for a Paymax product_code. ok is false when the
	// product is unknown or inactive.
	ResolveProduct(ctx context.Context, productCode string) (aggregator string, providerProductCode string, ok bool)
}

// Router resolves the concrete adapter for a Paymax product_code via the catalog.
// It mirrors maps.Service.resolve: a config/data lookup, then a registry lookup.
type Router struct {
	resolver ProductResolver
	adapters map[string]UnderwriterGateway // keyed by adapter Name()
}

// NewRouter builds a router over a product resolver and the registered adapters.
func NewRouter(resolver ProductResolver, adapters ...UnderwriterGateway) *Router {
	m := make(map[string]UnderwriterGateway, len(adapters))
	for _, a := range adapters {
		if a != nil {
			m[a.Name()] = a
		}
	}
	return &Router{resolver: resolver, adapters: m}
}

// ErrNoProvider is returned when no aggregator is configured for a product, or
// the product is unknown/inactive.
var ErrNoProvider = fmt.Errorf("insurance gateway: no provider for product")

// Resolve returns the UnderwriterGateway and the provider-side product code for a
// Paymax product_code. The product line → provider mapping lives entirely in the
// catalog/routing data; this function performs no per-product branching.
func (r *Router) Resolve(ctx context.Context, productCode string) (UnderwriterGateway, string, error) {
	if r == nil || r.resolver == nil {
		return nil, "", ErrNoProvider
	}
	aggregator, providerProductCode, ok := r.resolver.ResolveProduct(ctx, productCode)
	if !ok || aggregator == "" {
		return nil, "", fmt.Errorf("%w: %s", ErrNoProvider, productCode)
	}
	gw, ok := r.adapters[aggregator]
	if !ok {
		return nil, "", fmt.Errorf("%w: aggregator %q not registered", ErrNoProvider, aggregator)
	}
	return gw, providerProductCode, nil
}

// Adapter returns a registered adapter by aggregator name (used by webhook
// ingestion, which routes on the URL path, not on a product code).
func (r *Router) Adapter(name string) (UnderwriterGateway, bool) {
	if r == nil {
		return nil, false
	}
	gw, ok := r.adapters[name]
	return gw, ok
}
