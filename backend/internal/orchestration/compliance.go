package orchestration

import (
	"context"
	"strings"
)

// ComplianceScreener is the injection seam for KYC/AML/sanctions screening. It
// is consulted on the money paths (quote pricing and transfer/conversion
// execution) before a route is priced or funds move. A blocked result yields a
// first-class compliance_block outcome (the request is neither priced nor
// executed); a screener error is treated fail-closed (also a compliance_block),
// since we must not let an unverified caller through on a screening outage.
//
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
//
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
