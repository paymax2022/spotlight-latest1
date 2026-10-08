package utilitybills

import (
	"fmt"
	"slices"
	"sort"
	"strings"

	"spotlight/backend/internal/provider"
)

// This file ports frontend-web/src/server/utility/pricing.ts (54 lines)
// exactly: resolveUtilityAmount, calculateUtilityPricing and their bps-math
// helpers, including truncation direction.

// floorDivInt64 replicates JS's `Math.floor(numerator / denominator)` for
// integer inputs. Go's native `/` truncates toward zero, which only matches
// Math.floor when both operands are non-negative (or both negative) — a
// direct `numerator / denominator` diverges the moment numerator is negative
// and denominator is positive (e.g. Go: -1/3 == 0; JS: Math.floor(-1/3) ==
// -1). That case is real here: grossProfitKobo (retailAmountKobo -
// providerCostKobo) CAN be negative — a misconfigured/underpriced product
// can legitimately price at a loss — and grossMarginBps divides it by a
// always-positive retailAmountKobo, so a negative-numerator, positive-
// denominator division is reachable in normal operation, not just a
// theoretical edge case. denominator is never zero at either call site
// (10_000 in applyBasisPoints; guarded `retailAmountKobo > 0` in
// CalculateUtilityPricing).
func floorDivInt64(numerator, denominator int64) int64 {
	q := numerator / denominator
	r := numerator % denominator
	if r != 0 && ((r < 0) != (denominator < 0)) {
		q--
	}
	return q
}

// applyBasisPoints mirrors pricing.ts's applyBasisPoints:
func applyBasisPoints(amountKobo, bps int64) int64 {
	return floorDivInt64(amountKobo*bps, 10_000)
}

// resolveUtilityAmount mirrors pricing.ts's resolveUtilityAmount: picks the
// product's fixed price, or a caller-supplied amount for a variable
// product; validates it is a positive integer; then clamps it to
// [MinAmountKobo, MaxAmountKobo] when those are set.
func resolveUtilityAmount(product Product, requestedAmountKobo *int64) (int64, error) {
	var amountKobo *int64
	if product.AmountType == AmountTypeFixed {
		amountKobo = product.AmountKobo
	} else {
		amountKobo = requestedAmountKobo
	}
	if amountKobo == nil {
		return 0, ErrAmountRequired
	}
	resolved := *amountKobo

	if resolved <= 0 {
		return 0, fmt.Errorf("%w: got %d", ErrInvalidAmount, resolved)
	}

	if product.MinAmountKobo != nil && resolved < *product.MinAmountKobo {
		return 0, fmt.Errorf("%w: minimum is %d kobo, got %d", ErrAmountBelowMinimum, *product.MinAmountKobo, resolved)
	}

	if product.MaxAmountKobo != nil && resolved > *product.MaxAmountKobo {
		return 0, fmt.Errorf("%w: maximum is %d kobo, got %d", ErrAmountAboveMaximum, *product.MaxAmountKobo, resolved)
	}

	return resolved, nil
}

// CalculateUtilityPricing mirrors pricing.ts's calculateUtilityPricing
// exactly, field for field and in the same order (including computing
// grossMarginBps BEFORE the providerCostKobo<=0 check, matching the TS
// source's statement order — the check does not short-circuit anything
// upstream of it since all fields are pure computations of already-resolved
// values).
func CalculateUtilityPricing(product Product, mapping ProviderMapping, requestedAmountKobo *int64) (Pricing, error) {
	amountKobo, err := resolveUtilityAmount(product, requestedAmountKobo)
	if err != nil {
		return Pricing{}, err
	}

	markupKobo := applyBasisPoints(amountKobo, product.MarkupBps)
	convenienceFeeKobo := product.ConvenienceFeeKobo
	retailAmountKobo := amountKobo + markupKobo + convenienceFeeKobo

	// TS: `mapping.provider_discount_bps || product.provider_discount_bps`.
	// JS `||` treats 0 as falsy, so a mapping-level 0 bps falls back to the
	// product default — this is NOT the same rule as ProviderCostKobo below.
	discountBps := mapping.ProviderDiscountBps
	if discountBps == 0 {
		discountBps = product.ProviderDiscountBps
	}

	// TS: `mapping.provider_cost_kobo ?? amountKobo - applyBasisPoints(...)`.
	// JS `??` (nullish coalescing) only falls back on null/undefined — a
	// mapping-level cost of exactly 0 (or negative) is used VERBATIM, unlike
	// the `||` above. A non-nil pointer, even to 0, must not fall back.
	var providerCostKobo int64
	if mapping.ProviderCostKobo != nil {
		providerCostKobo = *mapping.ProviderCostKobo
	} else {
		providerCostKobo = amountKobo - applyBasisPoints(amountKobo, discountBps)
	}

	grossProfitKobo := retailAmountKobo - providerCostKobo

	var grossMarginBps int64
	if retailAmountKobo > 0 {
		grossMarginBps = floorDivInt64(grossProfitKobo*10_000, retailAmountKobo)
	}

	if providerCostKobo <= 0 {
		return Pricing{}, fmt.Errorf("%w: got %d", ErrProviderCostNotPositive, providerCostKobo)
	}

	return Pricing{
		AmountKobo:         amountKobo,
		MarkupKobo:         markupKobo,
		ConvenienceFeeKobo: convenienceFeeKobo,
		RetailAmountKobo:   retailAmountKobo,
		ProviderCostKobo:   providerCostKobo,
		GrossProfitKobo:    grossProfitKobo,
		GrossMarginBps:     grossMarginBps,
	}, nil
}

// Pure port of frontend-web/src/server/commission/config.ts's mapping half —
// utilityCategoryToService + deriveUtilitySubtype and their normalisation
// helpers. Zero I/O, so it is unit-tested directly; the actual commission_config
// LOOKUP is the Go commission module's job (commission.Service.Calculate already
// does the exact-subtype → service-level fallback the TS helper hand-rolled).
// Getting the (service, subtype) pair right is not cosmetic: it selects which
// commission_config row prices the transaction, which decides both the
// convenience fee the CUSTOMER pays and the revenue Paymax books. A subtype that
// silently fails to match falls back to the service-level row, which is the
// intended behaviour — but a subtype that matches the WRONG row (e.g. 'Aba'
// matching 'Abuja') would mis-price. That is why the TS source does exact-match
// first and this port keeps that ordering exactly.

// CommissionCategory is the service_category every utility earning is filed
// under. Mirrors config.ts's UTILITY_COMMISSION_CATEGORY.
const CommissionCategory = "Utility_Bills"

// categoryToCommissionService mirrors config.ts's CATEGORY_TO_SERVICE. Note
// 'internet' is deliberately ABSENT: it has no seeded commission service, and the
// TS source lets it resolve to null so the caller keeps the legacy
// utility_products-only pricing. Adding it here would silently start pricing
// internet bills off a config row that does not exist.
var categoryToCommissionService = map[Category]string{
	CategoryElectricity: "Electricity",
	CategoryCableTV:     "CableTv",
	CategoryAirtime:     "Airtime",
	CategoryData:        "Data",
	CategoryEducation:   "Education",
}

// commissionSubtypes mirrors config.ts's SERVICE_SUBTYPES (the seeded rows).
var commissionSubtypes = map[string][]string{
	"Airtime": {"9mobile", "MTN", "GLO", "Airtel"},
	"Data":    {"9mobile", "MTN", "GLO", "Airtel", "Smile", "Spectranet"},
	"Electricity": {
		"Abuja", "Aba", "Ikeja", "Eko", "Ibadan", "Yola", "Kano", "Kaduna", "Jos",
		"Enugu", "Benin", "PortHarcourt",
	},
	"CableTv":   {"DSTV", "GoTV", "Startime", "Showmax"},
	"Education": {"WAEC", "NECO", "JAMB"},
}

// CategoryToCommissionService maps a utility category onto its commission
// service name, or "" when the category has none (mirrors the TS `?? null`).
func CategoryToCommissionService(category Category) string {
	return categoryToCommissionService[category]
}

// normalizeToken mirrors config.ts's normalize(): lowercase, then strip every
// character that is not a-z0-9.
func normalizeToken(value string) string {
	var b strings.Builder
	b.Grow(len(value))
	for _, r := range strings.ToLower(value) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// billerCodeToken mirrors config.ts's billerCodeToken(): drop a leading
// "vtpass-" and one trailing category suffix, then normalise. E.g.
// "vtpass-portharcourt-electric" → "portharcourt", "vtpass-dstv" → "dstv".
func billerCodeToken(code string) string {
	trimmed := code
	// TS: .replace(/^vtpass-/i, '')
	if len(trimmed) >= 7 && strings.EqualFold(trimmed[:7], "vtpass-") {
		trimmed = trimmed[7:]
	}
	// TS: .replace(/-(electric|electricity|airtime|data|internet|cabletv|tv|variable)$/i, '')
	for _, suffix := range []string{
		"-electricity", "-electric", "-airtime", "-internet", "-cabletv",
		"-variable", "-data", "-tv",
	} {
		if len(trimmed) > len(suffix) && strings.EqualFold(trimmed[len(trimmed)-len(suffix):], suffix) {
			trimmed = trimmed[:len(trimmed)-len(suffix)]
			break
		}
	}
	return normalizeToken(trimmed)
}

// DeriveCommissionSubtype mirrors config.ts's deriveUtilitySubtype: best-effort
// match of a biller onto one of its service's known subtypes. Returns "" when
// nothing matches, so the caller falls back to the service-level (”) config row.
// Two passes, in this order and for this reason:
//
//	Pass 1 — exact normalised equality. Most specific and collision-free.
//	Pass 2 — loose substring either way, longest subtypes first, so a longer and
//	         more specific subtype wins ('Startime' before shorter neighbours).
//
// Inverting those passes would let 'aba' match 'abuja' by substring before the
// exact 'Aba' row was ever considered — the exact case the TS comment calls out.
func DeriveCommissionSubtype(service, billerCode, billerName string) string {
	subtypes := commissionSubtypes[service]
	if len(subtypes) == 0 {
		return ""
	}

	tokens := make([]string, 0, 2)
	for _, t := range []string{billerCodeToken(billerCode), normalizeToken(billerName)} {
		if t != "" {
			tokens = append(tokens, t)
		}
	}

	// Pass 1: exact normalised equality.
	for _, token := range tokens {
		for _, subtype := range subtypes {
			if normalizeToken(subtype) == token {
				return subtype
			}
		}
	}

	// Pass 2: loose contains, longest subtypes first.
	byLengthDesc := append([]string(nil), subtypes...)
	sort.SliceStable(byLengthDesc, func(i, j int) bool {
		return len(normalizeToken(byLengthDesc[i])) > len(normalizeToken(byLengthDesc[j]))
	})
	for _, token := range tokens {
		for _, subtype := range byLengthDesc {
			sub := normalizeToken(subtype)
			if sub == "" {
				continue
			}
			if strings.Contains(token, sub) || strings.Contains(sub, token) {
				return subtype
			}
		}
	}

	return ""
}

// ApplyCommissionConvenienceFee ports service.ts's applyCommissionConvenienceFee.
// When an active commission_config row prices this (service, subtype) with a
// DIFFERENT convenience fee from the one on utility_products, the config wins and
// the pricing is re-derived around it. When the fee is unchanged — the current
// seeded case for every category — the pricing is returned byte-identical, so
// amounts do not move unless a config row deliberately differs.
// Only the three fields that actually depend on the fee move: retail, gross
// profit, and the margin recomputed from them. AmountKobo / MarkupKobo /
// ProviderCostKobo are upstream of the fee and are left exactly as priced.
func ApplyCommissionConvenienceFee(pricing Pricing, configConvenienceFeeKobo int64, hasConfig bool) Pricing {
	if !hasConfig {
		return pricing
	}
	if configConvenienceFeeKobo == pricing.ConvenienceFeeKobo {
		return pricing
	}

	delta := configConvenienceFeeKobo - pricing.ConvenienceFeeKobo
	out := pricing
	out.ConvenienceFeeKobo = configConvenienceFeeKobo
	out.RetailAmountKobo = pricing.RetailAmountKobo + delta
	out.GrossProfitKobo = pricing.GrossProfitKobo + delta
	out.GrossMarginBps = 0
	if out.RetailAmountKobo > 0 {
		// Same floor-division helper the original pricing used, so a negative gross
		// profit truncates in the same direction here as it does there.
		out.GrossMarginBps = floorDivInt64(out.GrossProfitKobo*10_000, out.RetailAmountKobo)
	}
	return out
}

// This file ports frontend-web/src/server/utility/routing.ts (39 lines)
// exactly: getViableUtilityRoutes / selectUtilityProvider's filter chain and
// priority sort.
// routing.ts's exported functions take an `input: { category, product,
// amountKobo }` bag, but only `input.category` is ever read in the filter
// chain — `product` and `amountKobo` are unused dead parameters in the TS
// source. GetViableRoutes/SelectProvider below take just `category`,
// matching actual behavior rather than the wider unused signature; flagged
// as a judgment call in the task report.

// GetViableRoutes mirrors routing.ts's getViableUtilityRoutes: filters
// candidates through the full AND chain (provider active, mapping active,
// health not down, category supported), then sorts ascending by
// (RouteCandidate.Priority, Provider.Priority) — lower number tried first,
// route-level priority breaking ties before provider-level priority.
func GetViableRoutes(candidates []RouteCandidate, category Category) []RouteCandidate {
	viable := make([]RouteCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.Provider.Status != ProviderStatusActive {
			continue
		}
		if candidate.Mapping.Status != MappingStatusActive {
			continue
		}
		if candidate.Provider.HealthStatus == HealthDown {
			continue
		}
		if !supportsCategory(candidate.Provider.SupportedCategories, category) {
			continue
		}
		viable = append(viable, candidate)
	}

	// SliceStable to mirror Array.prototype.sort, stable since ES2019 (the
	// JS engines this codebase targets) — candidates that compare equal on
	// both priorities keep their input relative order rather than an
	// arbitrary one.
	sort.SliceStable(viable, func(i, j int) bool {
		if viable[i].Priority != viable[j].Priority {
			return viable[i].Priority < viable[j].Priority
		}
		return viable[i].Provider.Priority < viable[j].Provider.Priority
	})

	return viable
}

// SelectProvider mirrors routing.ts's selectUtilityProvider: the first
// viable route, or ErrNoViableRoute if none exist.
func SelectProvider(candidates []RouteCandidate, category Category) (RouteCandidate, error) {
	viable := GetViableRoutes(candidates, category)
	if len(viable) == 0 {
		return RouteCandidate{}, ErrNoViableRoute
	}
	return viable[0], nil
}

func supportsCategory(supported []Category, category Category) bool {
	return slices.Contains(supported, category)
}

// Provider failover for bill purchases.
// Modelled on backend/internal/provider/disbursement/registry.go: a PURE ordering
// function that decides which providers to try and in what order, plus a registry
// that resolves an adapter by name. The walking loop itself lives in service.go,
// because each attempt has to write a utility_provider_attempts row and claim an
// outbound idempotency key — I/O the pure part must stay free of.
// The ordering is not reimplemented here:  (Phase 0) already ports the
// TS filter chain and priority sort. FailoverOrder just runs it and re-associates
// each surviving slim RouteCandidate with the full DB rows behind it.

// FailoverOrder returns the routes to attempt, in the order to attempt them.
// PURE — no I/O, no clock, no network. Unit-tested directly.
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
			// same priority values  sorted on.
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
// an error, because  trusts that column.
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
