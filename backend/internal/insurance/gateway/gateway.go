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

	// WebhookSignatureHeader returns the HTTP header this provider delivers its
	// signature in, e.g. "x-mycoverai-signature".
	//
	// The adapter declares it because only the adapter knows it. The alternative
	// — the ingestion handler guessing a header from the URL slug — silently
	// fails: MyCover's slug is "mycover" but its header says "mycoverai", so a
	// guessed "X-mycover-Signature" never matches, the signature arrives empty,
	// and every genuine delivery is rejected before the HMAC even runs. That is
	// a 401 with no bad actor anywhere in it, and nothing in the logs pointing at
	// a header name.
	//
	// An empty return means "no provider-specific header"; the handler then falls
	// back to the generic ones.
	WebhookSignatureHeader() string
}

// ProductResolver is the slice of the catalog the Router needs to map a Paymax
// product_code to (aggregator name, provider_product_code). The catalog package
// implements this; keeping it as an interface keeps the gateway free of a catalog
// import cycle and keeps routing data-driven.
type ProductResolver interface {
	// ResolveProduct returns the aggregator key (e.g. "mycover") and the full
	// per-product routing descriptor (provider code, buy path, pricing model,
	// cover terms) for a Paymax product_code. ok is false when the product is
	// unknown or inactive.
	//
	// Everything an adapter needs to reach a product travels in the descriptor,
	// which is a CATALOG ROW — that is what makes adding a product a data change.
	ResolveProduct(ctx context.Context, productCode string) (aggregator string, product ProviderProduct, ok bool)
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

// ErrProviderFloatExhausted is the provider-agnostic signal that an aggregator
// refused a bind because PAYMAX'S PREFUNDED BALANCE WITH THAT AGGREGATOR is
// empty — not because anything about the member or the product was wrong.
//
// Aggregators that settle from a distributor float (MyCover does; it does not
// charge per transaction) wrap this sentinel around their own error, so feature
// code branches on the CONDITION without importing a provider package. Keeping
// it here is what stops the money path from growing a per-provider import.
//
// It is called out separately from a generic bind failure because the two need
// opposite responses: a generic failure is one member's problem, while this is a
// treasury outage that fails every bind at once and must pause the queue before
// more members are debited.
var ErrProviderFloatExhausted = fmt.Errorf("insurance gateway: provider prefunded float exhausted")

// ErrProviderRejected marks a DEFINITE negative: the provider (or our own
// pre-flight check) answered and refused, so nothing was created on their side.
//
// This exists to separate "the provider said no" from "we never found out". It
// is the difference between a retry that is safe and a retry that might buy a
// second policy with real money, and no aggregator reports it as a distinct
// code — so every adapter must wrap this sentinel around the errors it KNOWS
// were replies. Anything not wrapping it is treated as an unknown outcome and
// is never auto-retried, which is the safe default for silence.
var ErrProviderRejected = fmt.Errorf("insurance gateway: provider rejected the request")

// Resolve returns the UnderwriterGateway and the per-product routing descriptor
// for a Paymax product_code. The product → provider mapping AND the per-product
// buy path / pricing model live entirely in the catalog data; this function
// performs no per-product branching.
func (r *Router) Resolve(ctx context.Context, productCode string) (UnderwriterGateway, ProviderProduct, error) {
	if r == nil || r.resolver == nil {
		return nil, ProviderProduct{}, ErrNoProvider
	}
	aggregator, product, ok := r.resolver.ResolveProduct(ctx, productCode)
	if !ok || aggregator == "" {
		return nil, ProviderProduct{}, fmt.Errorf("%w: %s", ErrNoProvider, productCode)
	}
	gw, ok := r.adapters[aggregator]
	if !ok {
		return nil, ProviderProduct{}, fmt.Errorf("%w: aggregator %q not registered", ErrNoProvider, aggregator)
	}
	return gw, product, nil
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
