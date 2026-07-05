package commerce

import "context"

// PaymentRail is the INJECTED money rail for one-off charges (pay-now). Domain code
// calls this interface; the concrete vendor/Paystack/wallet adapter is wired in at
// the composition root. No vendor type ever leaks into this package (paymax-rails.md
// §1 "adapter, not SDK leak"). The rail owns the actual value movement; this module
// only flips LOCAL entitlement state once the rail confirms.
//
// Charge MUST be idempotent on idemKey: the same (idemKey, reference, amount) returns
// the same provider ref with no second charge.
type PaymentRail interface {
	Charge(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (ref string, err error)
}

// BNPLRail is the INJECTED buy-now-pay-later rail. Eligibility and the repayment
// schedule are OWNED by the rail (paymax-rails.md §BNPL); this module only flips
// entitlement on bnpl_active. StartPlan MUST be idempotent on idemKey.
type BNPLRail interface {
	StartPlan(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (ref string, err error)
}

// ── Default no-op / stub implementations (dev) ────────────────────────────────
// These let the package run end-to-end in dev without binding a vendor. They are
// deterministic and idempotent (the caller persists the result keyed by idemKey),
// returning a synthetic reference derived from the idempotency key.

// StubPaymentRail is a dev-only PaymentRail that "succeeds" instantly.
type StubPaymentRail struct{}

func (StubPaymentRail) Charge(_ context.Context, _, reference, idemKey string, _ int64) (string, error) {
	return "stub-pay-" + pick(idemKey, reference), nil
}

// StubBNPLRail is a dev-only BNPLRail that approves every plan.
type StubBNPLRail struct{}

func (StubBNPLRail) StartPlan(_ context.Context, _, reference, idemKey string, _ int64) (string, error) {
	return "stub-bnpl-" + pick(idemKey, reference), nil
}

func pick(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
