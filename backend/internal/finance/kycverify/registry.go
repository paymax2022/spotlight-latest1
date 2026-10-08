package kycverify

import (
	"context"
	"log"
	"sync"
	"time"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/dojah"
	"spotlight/backend/internal/provider/smileid"
	"spotlight/backend/internal/provider/youverify"
)

// Registry holds the capability ports each configured provider implements, keyed
// by provider name ("dojah"/"smileid"/"youverify"). The gateway resolves an
// ordered provider chain per check type (from the RoutingTable) and pulls the
// concrete port for each hop from here. A provider is registered ONLY when its
// credentials are non-empty; a provider absent from a map is skipped by the
// failover walk (as if it were never in the routing chain).
// This mirrors the provider-agnostic registry pattern used elsewhere (the
// disbursement registry): the domain names ports, never provider SDK types.
type Registry struct {
	idNumber map[string]provider.IdNumberPort
	facial   map[string]provider.FacialPort
	liveness map[string]provider.LivenessPort
	document map[string]provider.DocumentPort
	aml      map[string]provider.AmlPort
	parsers  map[string]provider.KycWebhookParser
}

// NewRegistry builds an empty registry (all capability maps initialized).
func NewRegistry() *Registry {
	return &Registry{
		idNumber: map[string]provider.IdNumberPort{},
		facial:   map[string]provider.FacialPort{},
		liveness: map[string]provider.LivenessPort{},
		document: map[string]provider.DocumentPort{},
		aml:      map[string]provider.AmlPort{},
		parsers:  map[string]provider.KycWebhookParser{},
	}
}

// register folds a single adapter into every capability map whose port it
// implements. A nil adapter is a no-op. Type assertions are how one concrete
// client (which may satisfy several ports) is fanned out across the maps.
func (r *Registry) register(name string, adapter provider.Named) {
	if adapter == nil {
		return
	}
	if p, ok := adapter.(provider.IdNumberPort); ok {
		r.idNumber[name] = p
	}
	if p, ok := adapter.(provider.FacialPort); ok {
		r.facial[name] = p
	}
	if p, ok := adapter.(provider.LivenessPort); ok {
		r.liveness[name] = p
	}
	if p, ok := adapter.(provider.DocumentPort); ok {
		r.document[name] = p
	}
	if p, ok := adapter.(provider.AmlPort); ok {
		r.aml[name] = p
	}
	if p, ok := adapter.(provider.KycWebhookParser); ok {
		r.parsers[name] = p
	}
}

// PortFor returns the concrete port implementing check type ct for provider name,
// or (nil, false) when this provider does not serve that capability. The gateway
// uses the ok flag to advance to the next provider in the chain.
func (r *Registry) PortFor(name string, ct provider.KycCheckType) (any, bool) {
	switch ct {
	case provider.KycIDNumber:
		p, ok := r.idNumber[name]
		return p, ok
	case provider.KycIDFacial:
		p, ok := r.facial[name]
		return p, ok
	case provider.KycLiveness:
		p, ok := r.liveness[name]
		return p, ok
	case provider.KycDocument:
		p, ok := r.document[name]
		return p, ok
	case provider.KycAML:
		p, ok := r.aml[name]
		return p, ok
	}
	return nil, false
}

// ParserFor returns the webhook parser for a provider name, or (nil, false).
func (r *Registry) ParserFor(name string) (provider.KycWebhookParser, bool) {
	p, ok := r.parsers[name]
	return p, ok
}

// Names returns the set of registered provider names (order not guaranteed).
func (r *Registry) Names() []string {
	seen := map[string]bool{}
	for k := range r.idNumber {
		seen[k] = true
	}
	for k := range r.facial {
		seen[k] = true
	}
	for k := range r.liveness {
		seen[k] = true
	}
	for k := range r.document {
		seen[k] = true
	}
	for k := range r.aml {
		seen[k] = true
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	return out
}

// BuildRegistry constructs the adapter registry from config. Only providers with
// non-empty credentials are registered; the routing failover walk then simply
// skips any name it can't resolve a port for. Secrets stay server-side — the
// concrete clients are built here and injected as ports only.
func BuildRegistry(cfg config.Config) *Registry {
	reg := NewRegistry()

	// Dojah — IdNumber, Liveness, Document, AML, KycWebhookParser.
	if cfg.DojahAppID != "" && cfg.DojahSecretKey != "" {
		c := dojah.New(cfg.DojahAppID, cfg.DojahSecretKey, cfg.DojahProd)
		if cfg.DojahWebhookSecret != "" {
			c = c.WithWebhookSecret(cfg.DojahWebhookSecret)
		}
		reg.register("dojah", c)
	}

	// Smile ID — Facial, Liveness, Document, KycWebhookParser.
	if cfg.SmileIDPartnerID != "" && cfg.SmileIDAPIKey != "" {
		c := smileid.New(cfg.SmileIDPartnerID, cfg.SmileIDAPIKey, cfg.SmileIDProd, cfg.SmileIDCallbackURL)
		reg.register("smileid", c)
	}

	// Youverify — IdNumber, Facial, Liveness, Document, AML, KycWebhookParser.
	if cfg.YouverifyToken != "" {
		c := youverify.New(cfg.YouverifyToken, cfg.YouverifyProd)
		if cfg.YouverifyWebhookSecret != "" {
			c = c.WithWebhookSecret(cfg.YouverifyWebhookSecret)
		}
		reg.register("youverify", c)
	}

	return reg
}

// Gateway performs capability routing + failover for a single check. For a check
// type it reads the ordered provider chain from the RoutingTable, then walks it:
// each hop is tried in order; on an open circuit breaker OR an adapter error the
// gateway records the failover and advances to the next provider. The first
// provider to answer wins; its normalized KycCheckResult is gated through
// GateFacial for the biometric/document check types.
// Providers whose ports are absent from the Registry (unconfigured credentials)
// are skipped exactly like an open breaker — the chain fails over past them.
type Gateway struct {
	reg     *Registry
	table   RoutingTable
	breaker *breaker
}

// NewGateway builds a Gateway over a registry + routing table. The routing table
// is a snapshot (the service reloads it per run so admin edits take effect).
func NewGateway(reg *Registry, table RoutingTable) *Gateway {
	return &Gateway{reg: reg, table: table, breaker: newBreaker(breakerCooldownKYC)}
}

// GatewayResult is the outcome of a routed check: the answering provider, the
// (facial-gated) normalized result, and the ordered list of providers skipped by
// failover (for audit).
type GatewayResult struct {
	Provider   string
	Result     provider.KycCheckResult
	FailedOver []string
}

// Run routes one check through the failover chain. It returns ErrNoProvider when
// every provider in the chain is unavailable (missing port, open breaker, or
// error). The request's Threshold is set from the routing rule when unset.
func (g *Gateway) Run(ctx context.Context, ct provider.KycCheckType, req provider.KycVerifyRequest) (*GatewayResult, error) {
	chain := g.table.Resolve(ct)
	if len(chain) == 0 {
		return nil, ErrNoProvider
	}
	threshold := g.table.ThresholdFor(ct)
	if req.Threshold <= 0 {
		req.Threshold = threshold
	}

	var failedOver []string
	now := time.Now()
	for _, name := range chain {
		// Pure gate: is this hop usable right now?
		port, hasPort := g.reg.PortFor(name, ct)
		dec := decideHop(hasPort, g.breaker.open(name, ct, now))
		if !dec.Try {
			failedOver = append(failedOver, name)
			continue
		}

		res, err := invoke(ctx, port, ct, req)
		if err != nil {
			// Adapter error → trip breaker for this (provider,checktype), fail over.
			g.breaker.trip(name, ct, time.Now())
			log.Printf("audit kycverify event=gateway.failover provider=%s type=%s reason=error", name, ct)
			failedOver = append(failedOver, name)
			continue
		}
		g.breaker.reset(name, ct)

		// Gate biometric/document/liveness confidence into PASS vs REVIEW.
		res.Status = gateResult(ct, res, threshold)
		return &GatewayResult{Provider: name, Result: res, FailedOver: failedOver}, nil
	}
	return nil, ErrNoProvider
}

// invoke dispatches to the correct port method for the check type. The port is
// the `any` returned by Registry.PortFor; a wrong-type assertion cannot happen
// because PortFor keys off the same check type.
func invoke(ctx context.Context, port any, ct provider.KycCheckType, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	switch ct {
	case provider.KycIDNumber:
		return port.(provider.IdNumberPort).VerifyIDNumber(ctx, req)
	case provider.KycIDFacial:
		return port.(provider.FacialPort).VerifyIDFacial(ctx, req)
	case provider.KycLiveness:
		return port.(provider.LivenessPort).VerifyLiveness(ctx, req)
	case provider.KycDocument:
		return port.(provider.DocumentPort).VerifyDocument(ctx, req)
	case provider.KycAML:
		return port.(provider.AmlPort).ScreenAML(ctx, req)
	}
	return provider.KycCheckResult{}, ErrNoProvider
}

// gateResult applies GateFacial to the confidence-bearing check types
// (facial/document/liveness). ID_NUMBER / AML data-match results are trusted as
// the adapter reported (still bounded by the state machine downstream). A
// non-terminal PENDING result is passed through untouched (webhook decides).
func gateResult(ct provider.KycCheckType, res provider.KycCheckResult, threshold int) provider.KycCheckStatus {
	if !res.Terminal {
		return provider.KycPending
	}
	switch ct {
	case provider.KycIDFacial, provider.KycDocument, provider.KycLiveness:
		return GateFacial(res.Match, res.Confidence, threshold)
	default:
		return res.Status
	}
}

// hopDecision is the pure outcome of the per-hop gate.
type hopDecision struct {
	// Try is true when the provider should be invoked; false → fail over.
	Try bool
}

// decideHop is the pure gate: try a provider only when it serves the capability
// (hasPort) AND its breaker is closed. Either condition failing → fail over.
func decideHop(hasPort, breakerOpen bool) hopDecision {
	if !hasPort {
		return hopDecision{Try: false}
	}
	if breakerOpen {
		return hopDecision{Try: false}
	}
	return hopDecision{Try: true}
}

// breakerCooldownKYC mirrors the maps provider guard's 60s cooldown: a tripped
// (provider,checktype) breaker stays open until the cooldown elapses, then the
// next call probes it.
const breakerCooldownKYC = 60 * time.Second

type breakerKey struct {
	provider string
	ct       provider.KycCheckType
}

// breaker is a minimal in-memory circuit breaker. It records the last-trip time
// per (provider,checktype); open() reports whether the cooldown is still active.
// Concurrency-safe (KYC checks run per-request across goroutines).
type breaker struct {
	mu        sync.Mutex
	trippedAt map[breakerKey]time.Time
	cooldown  time.Duration
}

func newBreaker(cooldown time.Duration) *breaker {
	return &breaker{trippedAt: map[breakerKey]time.Time{}, cooldown: cooldown}
}

// open reports whether the breaker for (provider,ct) is open at `now` (tripped
// within the cooldown window).
func (b *breaker) open(providerName string, ct provider.KycCheckType, now time.Time) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	t, ok := b.trippedAt[breakerKey{providerName, ct}]
	if !ok {
		return false
	}
	return now.Sub(t) < b.cooldown
}

// trip opens the breaker for (provider,ct) at `now`.
func (b *breaker) trip(providerName string, ct provider.KycCheckType, now time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.trippedAt[breakerKey{providerName, ct}] = now
}

// reset closes the breaker for (provider,ct) after a successful call.
func (b *breaker) reset(providerName string, ct provider.KycCheckType) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.trippedAt, breakerKey{providerName, ct})
}
