package tutor

import "context"

// INJECTED capability + money interfaces (paymax-rails.md — "adapter, not SDK leak").
// The domain code calls these interfaces; the concrete vendor / KYC / payout adapter is
// wired at the composition root. No vendor type ever leaks into this package.

// KYCChecker reports a user's current KYC tier. Tutor verification is GATED on tier >= 1
// (fail-closed). This module NEVER rebuilds KYC — it only reads the tier from the
// EXISTING finance/kyc flow via this injected adapter.
type KYCChecker interface {
	Tier(ctx context.Context, userID string) (int, error)
}

// PayoutRail OWNS the actual value movement to the tutor (finance payout). It MUST be
// idempotent on idemKey: the same (userID, reference, idemKey, amount) returns the same
// provider ref with NO second movement. This module only flips LOCAL payout state once
// the rail confirms, and records the returned reference.
type PayoutRail interface {
	Payout(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (ref string, err error)
}

// ── Default no-op / stub implementations (dev) ────────────────────────────────────
// These let the package run end-to-end in dev without binding a vendor.

// stubKYCChecker is the default when no checker is injected (dev). It reports tier 1 so
// onboarding can be exercised end-to-end; the real adapter is wired at the root.
type stubKYCChecker struct{}

func (stubKYCChecker) Tier(_ context.Context, _ string) (int, error) { return 1, nil }

// stubPayoutRail is a dev-only PayoutRail that "pays out" instantly. It is deterministic
// and idempotent: the same idemKey yields the same synthetic reference.
type stubPayoutRail struct{}

func (stubPayoutRail) Payout(_ context.Context, _, reference, idemKey string, _ int64) (string, error) {
	return "stub-payout-" + pick(idemKey, reference), nil
}

func pick(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
