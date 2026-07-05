package kycverify

import (
	"strings"

	"spotlight/backend/internal/provider"
)

// Capability routing + failover (pure). The resolver returns the ordered
// provider list for a check type; the gateway walks it, advancing to the next
// provider on adapter error or open circuit breaker. Rules are seeded from env
// and are admin-editable (kyc_routing_rule) — swapping a provider is config-only.

// RoutingRule is one admin-editable rule.
type RoutingRule struct {
	CheckType        provider.KycCheckType `json:"check_type"`
	OrderedProviders []string              `json:"ordered_providers"`
	Threshold        int                   `json:"threshold"`
	Enabled          bool                  `json:"enabled"`
}

// RoutingTable maps each check type to its rule.
type RoutingTable map[provider.KycCheckType]RoutingRule

// DefaultRoutingTable is the ADR-013 §1 default (used when the DB has no rows and
// no env override is present).
func DefaultRoutingTable() RoutingTable {
	return RoutingTable{
		provider.KycIDNumber: {CheckType: provider.KycIDNumber, OrderedProviders: []string{"dojah", "youverify"}, Threshold: 70, Enabled: true},
		provider.KycIDFacial: {CheckType: provider.KycIDFacial, OrderedProviders: []string{"dojah", "smileid"}, Threshold: 70, Enabled: true},
		provider.KycLiveness: {CheckType: provider.KycLiveness, OrderedProviders: []string{"dojah", "smileid"}, Threshold: 70, Enabled: true},
		provider.KycDocument: {CheckType: provider.KycDocument, OrderedProviders: []string{"dojah", "smileid"}, Threshold: 70, Enabled: true},
		provider.KycAML:      {CheckType: provider.KycAML, OrderedProviders: []string{"dojah", "youverify"}, Threshold: 70, Enabled: true},
	}
}

// parseOrder turns "youverify,dojah" into ["youverify","dojah"], trimming blanks.
func parseOrder(csv string) []string {
	parts := strings.Split(csv, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if s := strings.TrimSpace(p); s != "" {
			out = append(out, strings.ToLower(s))
		}
	}
	return out
}

// RoutingSeed carries the env-provided order strings (from config).
type RoutingSeed struct {
	IDNumber, IDFacial, Liveness, Document, AML string
	Threshold                                   int
}

// TableFromSeed builds a routing table from env seed strings, falling back to the
// ADR default for any check whose seed is empty.
func TableFromSeed(s RoutingSeed) RoutingTable {
	t := DefaultRoutingTable()
	th := s.Threshold
	if th <= 0 {
		th = 70
	}
	set := func(ct provider.KycCheckType, csv string) {
		if order := parseOrder(csv); len(order) > 0 {
			t[ct] = RoutingRule{CheckType: ct, OrderedProviders: order, Threshold: th, Enabled: true}
		} else {
			r := t[ct]
			r.Threshold = th
			t[ct] = r
		}
	}
	set(provider.KycIDNumber, s.IDNumber)
	set(provider.KycIDFacial, s.IDFacial)
	set(provider.KycLiveness, s.Liveness)
	set(provider.KycDocument, s.Document)
	set(provider.KycAML, s.AML)
	return t
}

// Resolve returns the ordered provider chain for a check type. Disabled rules and
// unknown types yield an empty chain (the gateway then reports no-provider).
func (t RoutingTable) Resolve(ct provider.KycCheckType) []string {
	r, ok := t[ct]
	if !ok || !r.Enabled {
		return nil
	}
	return r.OrderedProviders
}

// ThresholdFor returns the PASS/REVIEW confidence gate for a check type.
func (t RoutingTable) ThresholdFor(ct provider.KycCheckType) int {
	if r, ok := t[ct]; ok && r.Threshold > 0 {
		return r.Threshold
	}
	return 70
}
