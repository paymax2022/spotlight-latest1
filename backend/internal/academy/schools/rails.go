package schools

import "context"

// BillingRail is the INJECTED money rail for institution billing (paymax-rails.md
// §Virtual accounts — "adapter, not SDK leak"). The domain code calls this interface;
// the concrete finance/va adapter is wired at the composition root. No vendor type ever
// leaks into this package. The rail OWNS the actual value movement (charging the
// institution's virtual account); this module only flips LOCAL billing state open→paid
// once the rail confirms, and records the returned reference.
//
// Charge MUST be idempotent on idemKey: the same (idemKey, reference, amount) returns
// the same provider ref with no second charge.
type BillingRail interface {
	Charge(ctx context.Context, institutionRef, reference, idemKey string, amountMinor int64) (ref string, err error)
}

// ── Default no-op / stub implementation (dev) ─────────────────────────────────────
// Lets the package run end-to-end in dev without binding a vendor. Deterministic and
// idempotent (the caller persists the result keyed by idemKey), returning a synthetic
// reference derived from the idempotency key.

// StubBillingRail is a dev-only BillingRail that "charges" instantly.
type StubBillingRail struct{}

func (StubBillingRail) Charge(_ context.Context, _, reference, idemKey string, _ int64) (string, error) {
	return "stub-bill-" + pick(idemKey, reference), nil
}

func pick(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
