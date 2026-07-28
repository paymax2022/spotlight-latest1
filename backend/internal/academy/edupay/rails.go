package edupay

import "context"

// INJECTED money rails (paymax-rails.md §1 — "adapter, not SDK leak"). The domain
// code calls these interfaces; the concrete vendor / wallet / VA / payout adapter is
// wired at the composition root. No vendor type ever leaks into this package. The rail
// OWNS the actual value movement; this module only flips LOCAL disbursement state once
// the rail confirms, and records the returned reference.
//
// Every rail op MUST be idempotent on idemKey: the same (idemKey, reference, amount)
// returns the same provider ref with no second movement.

// CollectRail collects funds FROM the payer (wallet debit / VA inbound collection)
// toward a fee or a savings-pot contribution.
type CollectRail interface {
	Collect(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (ref string, err error)
}

// DisburseRail pays OUT to a school's virtual account (finance/va payout).
type DisburseRail interface {
	Disburse(ctx context.Context, schoolAccountRef, reference, idemKey string, amountMinor int64) (ref string, err error)
}

// BNPLRail opens a buy-now-pay-later plan for a fee. Eligibility + schedule are OWNED
// by the rail; this module only treats the started plan as the "collected" leg.
type BNPLRail interface {
	StartPlan(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (ref string, err error)
}

// ── Default no-op / stub implementations (dev) ────────────────────────────────
// These let the package run end-to-end in dev without binding a vendor. They are
// deterministic and idempotent (the caller persists the result keyed by idemKey),
// returning a synthetic reference derived from the idempotency key.

// StubCollectRail is a dev-only CollectRail that "succeeds" instantly.
type StubCollectRail struct{}

func (StubCollectRail) Collect(_ context.Context, _, reference, idemKey string, _ int64) (string, error) {
	return "stub-collect-" + pick(idemKey, reference), nil
}

// StubDisburseRail is a dev-only DisburseRail that "pays out" instantly.
type StubDisburseRail struct{}

func (StubDisburseRail) Disburse(_ context.Context, _, reference, idemKey string, _ int64) (string, error) {
	return "stub-disburse-" + pick(idemKey, reference), nil
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
