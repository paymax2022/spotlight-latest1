package kycverify

import (
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
//
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
