// Package utilitybills is the DOMAIN layer for the Utility Bills money path
// (electricity / airtime / data / cable TV / internet / education purchases
// via third-party providers such as VTpass), being migrated out of
// frontend-web/src/server/utility into the Go backend.
//
// Phase 0 (this file, statemachine.go, pricing.go, routing.go) is
// EXPLICITLY scope-limited to pure types and pure functions: zero I/O,
// nothing wired into the running app. Phase 1 adds provider_bind.go,
// credentials.go, repository.go, service.go and handler.go on top of this
// package — see /Users/paymax/.claude/plans/robust-crunching-simon.md.
//
// Types here mirror the shapes in frontend-web/src/server/utility/types.ts
// that pricing.ts, routing.ts and status.ts consume — not the full DB row
// shapes (those, and any DB-facing concerns, are Phase 1's repository.go).
package utilitybills

import "errors"

// ── Category ─────────────────────────────────────────────────────────────

// Category enumerates the utility bill verticals. Mirrors types.ts's
// UtilityCategory exactly — six values, confirmed by reading types.ts line 1
// rather than guessed:
//
//	export type UtilityCategory = 'airtime' | 'data' | 'electricity' | 'cable_tv' | 'internet' | 'education';
type Category string

const (
	CategoryAirtime     Category = "airtime"
	CategoryData        Category = "data"
	CategoryElectricity Category = "electricity"
	CategoryCableTV     Category = "cable_tv"
	CategoryInternet    Category = "internet"
	CategoryEducation   Category = "education"
)

// ── Status ───────────────────────────────────────────────────────────────

// Status is a utility transaction's lifecycle state. Mirrors types.ts's
// UtilityTransactionStatus exactly (7 values).
type Status string

const (
	StatusInitiated       Status = "initiated"
	StatusWalletDebited   Status = "wallet_debited"
	StatusProviderPending Status = "provider_pending"
	StatusSuccessful      Status = "successful"
	StatusFailed          Status = "failed"
	StatusReversed        Status = "reversed"
	StatusDisputed        Status = "disputed"
)

// ── Product / mapping / provider configuration ──────────────────────────

// AmountType is a product's pricing mode: a fixed catalog price, or a
// caller-supplied variable amount (bounded by Min/MaxAmountKobo).
type AmountType string

const (
	AmountTypeFixed    AmountType = "fixed"
	AmountTypeVariable AmountType = "variable"
)

// MappingStatus is a provider/product mapping's admin-configured status.
type MappingStatus string

const (
	MappingStatusActive   MappingStatus = "active"
	MappingStatusDisabled MappingStatus = "disabled"
)

// ProviderOperationalStatus is a provider's admin-configured status.
type ProviderOperationalStatus string

const (
	ProviderStatusActive      ProviderOperationalStatus = "active"
	ProviderStatusDisabled    ProviderOperationalStatus = "disabled"
	ProviderStatusMaintenance ProviderOperationalStatus = "maintenance"
)

// HealthStatus is a provider's live operational health, distinct from its
// admin-configured Status. Only HealthDown excludes a route in routing.go —
// degraded/unknown providers stay eligible, mirroring routing.ts exactly
// (`provider.health_status !== 'down'`, not an allow-list of "healthy").
type HealthStatus string

const (
	HealthHealthy  HealthStatus = "healthy"
	HealthDegraded HealthStatus = "degraded"
	HealthDown     HealthStatus = "down"
	HealthUnknown  HealthStatus = "unknown"
)

// Product mirrors the subset of UtilityProductRow (types.ts) that
// pricing.ts's calculateUtilityPricing consumes.
type Product struct {
	AmountType AmountType
	// AmountKobo is the fixed catalog price. Required (non-nil) when
	// AmountType is AmountTypeFixed; ignored when AmountTypeVariable.
	// Mirrors amount_kobo's `number | null` in types.ts.
	AmountKobo *int64
	// MinAmountKobo / MaxAmountKobo bound the resolved amount when set; nil
	// means unbounded on that side. Mirrors `number | null` in types.ts.
	MinAmountKobo *int64
	MaxAmountKobo *int64
	// MarkupBps is Paymax's markup in basis points, applied to the resolved
	// amount (see pricing.go's applyBasisPoints).
	MarkupBps int64
	// ConvenienceFeeKobo is a flat fee added on top of amount + markup.
	ConvenienceFeeKobo int64
	// ProviderDiscountBps is the FALLBACK discount rate, used only when the
	// selected ProviderMapping does not set its own (JS `||` semantics —
	// see CalculateUtilityPricing).
	ProviderDiscountBps int64
}

// ProviderMapping mirrors the subset of UtilityProductMappingRow (types.ts)
// pricing.go and routing.go consume.
type ProviderMapping struct {
	// Status gates routing eligibility in routing.go — only
	// MappingStatusActive is viable. This field is not in the Phase-0 task
	// prompt's literal field list for ProviderMapping (which named only
	// ProviderCostKobo/ProviderDiscountBps, the pricing.go inputs); it is
	// added here because routing.ts's filter chain checks
	// `candidate.mapping.status === 'active'` and routing.go cannot port
	// that faithfully without it. Flagged in the task report.
	Status MappingStatus
	// ProviderCostKobo, when non-nil, is used VERBATIM as the provider cost
	// — including zero or negative — mirroring TS's `??` (nullish
	// coalescing, NOT `||`): only a missing value falls back to the
	// computed discount; a present-but-zero value does not. See
	// CalculateUtilityPricing.
	ProviderCostKobo    *int64
	ProviderDiscountBps int64
}

// Provider mirrors the subset of UtilityProviderRow (types.ts) routing.go
// consumes. ID is a small addition beyond the Phase-0 task prompt's literal
// field list (Status/HealthStatus/SupportedCategories/Priority): Phase 1's
// service.go needs a way to identify which provider a RouteCandidate
// resolved to. Flagged in the task report.
type Provider struct {
	ID                  string
	Status              ProviderOperationalStatus
	HealthStatus        HealthStatus
	SupportedCategories []Category
	// Priority is the tiebreaker used when two routes share the same
	// RouteCandidate.Priority. Lower number = higher priority (tried
	// first).
	Priority int
}

// RouteCandidate is one viable (provider, mapping) pairing a purchase
// attempt could route through. Mirrors UtilityRouteCandidate in routing.ts.
type RouteCandidate struct {
	Provider Provider
	Mapping  ProviderMapping
	// Priority is the ROUTE-level priority (e.g. a per-product-mapping
	// override), sorted ascending BEFORE Provider.Priority as tiebreaker.
	// Lower number = higher priority (tried first).
	Priority int
}

// ── Pricing result ───────────────────────────────────────────────────────

// Pricing is CalculateUtilityPricing's result. Mirrors UtilityPricing in
// types.ts, plus MarkupKobo: pricing.ts computes markupKobo as a local
// variable but never returns it on UtilityPricing. It is exposed here per
// this phase's task spec, since Phase 1 will want it for ledger posting /
// receipt display without recomputing it from AmountKobo and MarkupBps.
type Pricing struct {
	AmountKobo         int64
	MarkupKobo         int64
	ConvenienceFeeKobo int64
	RetailAmountKobo   int64
	ProviderCostKobo   int64
	GrossProfitKobo    int64
	GrossMarginBps     int64
}

// ── Domain errors (Phase 1's handler.go maps these to HTTP) ─────────────

var (
	// ErrAmountRequired — a variable-amount product was purchased without an
	// explicit amountKobo, or a fixed-amount product has no configured
	// AmountKobo. Mirrors pricing.ts's resolveUtilityAmount 400
	// ("amount_kobo is required for variable utility products.") — TS uses
	// one generic message for both cases; ported verbatim rather than
	// splitting it, to keep behavior identical.
	ErrAmountRequired = errors.New("utilitybills: amount_kobo is required for variable utility products")
	// ErrInvalidAmount — the resolved amount is not a positive kobo integer.
	// Mirrors wallet/ledger.ts's validateAmountKobo, which pricing.ts calls.
	ErrInvalidAmount = errors.New("utilitybills: amount must be a positive integer (kobo)")
	// ErrAmountBelowMinimum — resolved amount is below the product's
	// configured minimum. 400.
	ErrAmountBelowMinimum = errors.New("utilitybills: amount is below the product minimum")
	// ErrAmountAboveMaximum — resolved amount is above the product's
	// configured maximum. 400.
	ErrAmountAboveMaximum = errors.New("utilitybills: amount is above the product maximum")
	// ErrProviderCostNotPositive — computed provider cost is <= 0, mirroring
	// pricing.ts's `throw new ApiError('Provider cost must be positive.', 500)`.
	ErrProviderCostNotPositive = errors.New("utilitybills: provider cost must be positive")
	// ErrNoViableRoute — no active/healthy provider route supports this
	// category. Mirrors routing.ts's
	// `throw new ApiError('No available provider route for this utility product.', 503)`.
	ErrNoViableRoute = errors.New("utilitybills: no available provider route for this utility product")
)
