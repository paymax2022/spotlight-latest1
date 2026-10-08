package orchestration

import (
	"context"
	"strings"
	"time"
)

// LimitRule is the per-tier limit band (spec §8). All thresholds are expressed in
// the engine's check currency (minor units); a 0 threshold means "unbounded".
type LimitRule struct {
	PerTxnMinMinor  int64 // reject below this (QT-006 / LM-001)
	PerTxnMaxMinor  int64 // reject above this (LM-001)
	DailyMaxMinor   int64 // rolling-24h cumulative cap (LM-002)
	MonthlyMaxMinor int64 // rolling-30d cumulative cap (LM-002)
	MaxTxnsPerHour  int   // velocity / anti-structuring throttle (LM-004)
}

// LimitUsage is a customer's rolling usage in the check currency (minor units).
type LimitUsage struct {
	DailyMinor    int64
	MonthlyMinor  int64
	LastHourCount int
}

// UsageFunc reports a customer's rolling usage at `now`. Injected so the engine
// stays storage-agnostic and unit-testable; production wires it over the ledger.
type UsageFunc func(ctx context.Context, customerID string, now time.Time) (LimitUsage, error)

// LimitsEngine enforces per-transaction, cumulative, tier, and velocity limits
// before a conversion is priced or executed — a hard gate (spec §4 invariant 8).
type LimitsEngine struct {
	checkCurrency string
	def           LimitRule
	byTier        map[string]LimitRule
	usage         UsageFunc
}

// NewLimitsEngine builds an engine. checkCurrency is the currency all thresholds
// are denominated in (e.g. "USD"); the request amount is normalized to it via the
// indicative mid rate. A nil usage func disables cumulative/velocity checks
// (per-txn min/max still apply).
func NewLimitsEngine(checkCurrency string, def LimitRule, byTier map[string]LimitRule, usage UsageFunc) *LimitsEngine {
	if byTier == nil {
		byTier = map[string]LimitRule{}
	}
	return &LimitsEngine{checkCurrency: strings.ToUpper(checkCurrency), def: def, byTier: byTier, usage: usage}
}

func (e *LimitsEngine) rule(tier string) LimitRule {
	if r, ok := e.byTier[strings.ToLower(tier)]; ok {
		return r
	}
	return e.def
}

// toCheckMinor converts a source-currency minor amount to the check currency for
// threshold comparison. Falls back to the raw amount when the pair is unknown
// (guard degrades safely rather than silently passing an unconvertible amount).
func (e *LimitsEngine) toCheckMinor(source string, amountMinor int64) int64 {
	src := strings.ToUpper(source)
	if src == e.checkCurrency {
		return amountMinor
	}
	rate := MidRate(src, e.checkCurrency)
	if rate <= 0 {
		return amountMinor
	}
	return convertMinor(amountMinor, src, e.checkCurrency, rate)
}

// Check validates a conversion request against all limit bands. Returns nil when
// allowed, or a normalized APIError (invalid_request for min/max, limit_exceeded
// for cumulative/velocity) that the caller returns before pricing/execution.
func (e *LimitsEngine) Check(ctx context.Context, customerID, tier, source string, amountMinor int64, now time.Time) *APIError {
	r := e.rule(tier)
	amt := e.toCheckMinor(source, amountMinor)

	if r.PerTxnMinMinor > 0 && amt < r.PerTxnMinMinor {
		return NewError(ErrInvalidRequest, "amount_below_min", "Amount is below the minimum for your tier.").WithParam("amount")
	}
	if r.PerTxnMaxMinor > 0 && amt > r.PerTxnMaxMinor {
		return NewError(ErrInvalidRequest, "amount_above_max", "Amount exceeds the per-transaction maximum for your tier.").WithParam("amount")
	}

	needsUsage := r.DailyMaxMinor > 0 || r.MonthlyMaxMinor > 0 || r.MaxTxnsPerHour > 0
	if e.usage == nil || !needsUsage {
		return nil
	}
	u, err := e.usage(ctx, customerID, now)
	if err != nil {
		// Fail-closed on a usage-lookup error: cumulative limits are a hard gate.
		return NewError(ErrLimitExceeded, "limit_check_unavailable", "Could not verify your limits; please retry.")
	}
	if r.MaxTxnsPerHour > 0 && u.LastHourCount >= r.MaxTxnsPerHour {
		return NewError(ErrLimitExceeded, "velocity", "Too many conversions in a short period; please try again later.")
	}
	if r.DailyMaxMinor > 0 && u.DailyMinor+amt > r.DailyMaxMinor {
		return NewError(ErrLimitExceeded, "daily_limit", "This conversion would exceed your daily limit.")
	}
	if r.MonthlyMaxMinor > 0 && u.MonthlyMinor+amt > r.MonthlyMaxMinor {
		return NewError(ErrLimitExceeded, "monthly_limit", "This conversion would exceed your monthly limit.")
	}
	return nil
}

// NewStoreUsage builds a UsageFunc that derives a customer's rolling usage from
// the unified ledger, converting each transaction's source leg to the check
// currency via the indicative mid rate. Windows: 24h (daily), 30d (monthly), 1h
// (velocity count).
func NewStoreUsage(store Store, checkCurrency string) UsageFunc {
	cc := strings.ToUpper(checkCurrency)
	return func(ctx context.Context, customerID string, now time.Time) (LimitUsage, error) {
		txs, err := store.Transactions(ctx, customerID)
		if err != nil {
			return LimitUsage{}, err
		}
		var u LimitUsage
		dayAgo, monthAgo, hourAgo := now.Add(-24*time.Hour), now.Add(-30*24*time.Hour), now.Add(-time.Hour)
		for _, tx := range txs {
			if tx.Type != "conversion" && tx.Type != "transfer" {
				continue
			}
			amt := tx.Source.AmountMinor
			if src := strings.ToUpper(tx.Source.Currency); src != cc {
				if rate := MidRate(src, cc); rate > 0 {
					amt = convertMinor(tx.Source.AmountMinor, src, cc, rate)
				}
			}
			if tx.CreatedAt.After(monthAgo) {
				u.MonthlyMinor += amt
			}
			if tx.CreatedAt.After(dayAgo) {
				u.DailyMinor += amt
			}
			if tx.CreatedAt.After(hourAgo) {
				u.LastHourCount++
			}
		}
		return u, nil
	}
}

// ComplianceScreener is the injection seam for KYC/AML/sanctions screening. It
// is consulted on the money paths (quote pricing and transfer/conversion
// execution) before a route is priced or funds move. A blocked result yields a
// first-class compliance_block outcome (the request is neither priced nor
// executed); a screener error is treated fail-closed (also a compliance_block),
// since we must not let an unverified caller through on a screening outage.
// The real vendor integration (sanctions lists, AML transaction monitoring,
// per-corridor watchlists) is blocked on vendor credentials. This interface,
// the AllowAllScreener default, and Service.SetScreener mirror the invest
// module's PINVerifier/Notifier injection pattern so the production
// implementation drops in without touching the money-path logic.
type ComplianceScreener interface {
	// Screen reports whether the customer may transact the given amount over the
	// corridor. amountMinor is in minor units (kobo/cents). reason is a short,
	// machine-stable code surfaced to ops/audit (e.g. "sanctions_hit",
	// "kyc_tier_insufficient"); err signals a screening failure (provider down,
	// timeout) and MUST be treated fail-closed by callers.
	Screen(ctx context.Context, customerID, corridor string, amountMinor int64) (allowed bool, reason string, err error)
}

// AllowAllScreener is the no-op default: every request is allowed. It keeps the
// quote/transfer flow exercisable end-to-end (mock/local, and any environment
// where no real vendor is configured) without weakening the enforcement seam —
// production injects a real ComplianceScreener via Service.SetScreener.
type AllowAllScreener struct{}

// Screen always allows.
func (AllowAllScreener) Screen(_ context.Context, _, _ string, _ int64) (bool, string, error) {
	return true, "", nil
}

// ScreenerFunc adapts a plain function to the ComplianceScreener interface, for
// tests and lightweight policies.
type ScreenerFunc func(ctx context.Context, customerID, corridor string, amountMinor int64) (bool, string, error)

// Screen calls the wrapped function.
func (f ScreenerFunc) Screen(ctx context.Context, customerID, corridor string, amountMinor int64) (bool, string, error) {
	return f(ctx, customerID, corridor, amountMinor)
}

// SetScreener injects a real compliance screener (defaults to AllowAllScreener;
// the router installs the vendor-backed screener in production once credentials
// are available). A nil argument is ignored so the default stays in place.
func (s *Service) SetScreener(sc ComplianceScreener) {
	if sc != nil {
		s.screener = sc
	}
}

// screen runs the configured screener and maps its result to the normalized
// error taxonomy. Fail-closed: a screener error becomes a compliance_block so a
// screening outage can never silently let an unscreened request through.
// A nil reason/code is normalized to "compliance_block" so the outcome is always
// attributable in audit/ops.
func (s *Service) screen(ctx context.Context, customerID, corridor string, amountMinor int64) *APIError {
	screener := s.screener
	if screener == nil {
		// Defensive: NewService always sets AllowAllScreener, but a zero-value
		// Service must still fail-closed rather than skip screening.
		return NewError(ErrComplianceBlock, "compliance_block", "Compliance screening is unavailable.")
	}
	allowed, reason, err := screener.Screen(ctx, customerID, corridor, amountMinor)
	if err != nil {
		return NewError(ErrComplianceBlock, "compliance_block",
			"Compliance screening could not be completed; the request was blocked.")
	}
	if !allowed {
		code := strings.TrimSpace(reason)
		if code == "" {
			code = "compliance_block"
		}
		return NewError(ErrComplianceBlock, code,
			"This transaction is blocked pending compliance review.")
	}
	return nil
}
