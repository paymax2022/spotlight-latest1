package utilitybills

// Provider failover for bill purchases.
//
// Modelled on backend/internal/provider/disbursement/registry.go: a PURE ordering
// function that decides which providers to try and in what order, plus a registry
// that resolves an adapter by name. The walking loop itself lives in service.go,
// because each attempt has to write a utility_provider_attempts row and claim an
// outbound idempotency key — I/O the pure part must stay free of.
//
// The ordering is not reimplemented here: routing.go (Phase 0) already ports the
// TS filter chain and priority sort. FailoverOrder just runs it and re-associates
// each surviving slim RouteCandidate with the full DB rows behind it.

import (
	"sort"

	"spotlight/backend/internal/provider"
)

// FailoverOrder returns the routes to attempt, in the order to attempt them.
//
// PURE — no I/O, no clock, no network. Unit-tested directly.
//
// Re-association is by Provider.ID, which is unique within one product's
// candidate set (utility_provider_product_mappings has UNIQUE(provider_id,
// product_id)). If a caller ever passes candidates spanning multiple products the
// first row for an id wins; a deterministic pick is documented here rather than
// left to map iteration order, because a nondeterministic choice of provider on a
// money path would be untestable and unreproducible.
func FailoverOrder(routes []Route, category Category) []Route {
	if len(routes) == 0 {
		return nil
	}

	byProviderID := make(map[string]Route, len(routes))
	candidates := make([]RouteCandidate, 0, len(routes))
	for _, r := range routes {
		if _, seen := byProviderID[r.Provider.ID]; !seen {
			byProviderID[r.Provider.ID] = r
		}
		candidates = append(candidates, r.Candidate)
	}

	viable := GetViableRoutes(candidates, category)
	out := make([]Route, 0, len(viable))
	for _, c := range viable {
		if full, ok := byProviderID[c.Provider.ID]; ok {
			// Carry the (possibly re-sorted) candidate through, so the caller sees the
			// same priority values routing.go sorted on.
			full.Candidate = c
			out = append(out, full)
		}
	}
	return out
}

// ProviderRegistry resolves a utility_providers.adapter_code onto a configured
// bills adapter. Unknown adapter codes are NOT an error at registry level — a
// provider row can name an adapter this build does not ship, and the failover
// loop simply skips it and tries the next route (the same `continue`-on-miss
// discipline disbursement.Registry uses).
type ProviderRegistry struct {
	byAdapter map[string]provider.BillsProvider
}

// NewProviderRegistry builds a registry from adapter_code → adapter. Nil adapters
// are dropped rather than stored, so a lookup can never hand back a nil interface
// that only fails at the call site.
func NewProviderRegistry(adapters map[string]provider.BillsProvider) *ProviderRegistry {
	byAdapter := make(map[string]provider.BillsProvider, len(adapters))
	for code, a := range adapters {
		if code != "" && a != nil {
			byAdapter[code] = a
		}
	}
	return &ProviderRegistry{byAdapter: byAdapter}
}

// Adapter returns the bills adapter registered for an adapter_code.
func (r *ProviderRegistry) Adapter(code string) (provider.BillsProvider, bool) {
	if r == nil {
		return nil, false
	}
	a, ok := r.byAdapter[code]
	return a, ok
}

// Validator returns the adapter for an adapter_code IF it also implements
// customer verification. A provider without it is not an error — the caller skips
// verification rather than refusing the purchase (see the BillsValidator doc).
func (r *ProviderRegistry) Validator(code string) (provider.BillsValidator, bool) {
	a, ok := r.Adapter(code)
	if !ok {
		return nil, false
	}
	v, ok := a.(provider.BillsValidator)
	return v, ok
}

// HealthChecker returns the adapter for an adapter_code IF it also implements
// the optional liveness capability. Same type-assertion discipline as Validator
// above — but the CALLER's response to a miss deliberately differs: validation
// is skipped on a miss (refusing a purchase for want of an optional capability
// would be wrong), whereas an admin who explicitly asked to health-check a
// provider that cannot be health-checked gets ErrHealthCheckUnsupported.
// Reporting "healthy" for a provider nobody actually asked would be worse than
// an error, because routing.go trusts that column.
func (r *ProviderRegistry) HealthChecker(code string) (provider.HealthChecker, bool) {
	a, ok := r.Adapter(code)
	if !ok {
		return nil, false
	}
	h, ok := a.(provider.HealthChecker)
	return h, ok
}

// AdapterCodes lists the registered adapter codes, sorted, for startup logging
// and admin health reporting. Sorted so the log line is stable between restarts.
func (r *ProviderRegistry) AdapterCodes() []string {
	if r == nil {
		return nil
	}
	out := make([]string, 0, len(r.byAdapter))
	for code := range r.byAdapter {
		out = append(out, code)
	}
	sort.Strings(out)
	return out
}
