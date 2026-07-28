package credentials

import "context"

// RoleUpgrader is the INJECTED bridge into the EXISTING Paymax role-upgrade / KYC
// flow (paymax-rails.md "Earning bridge"; state-machines.md §6). Domain code calls
// this interface; the concrete adapter (RBACService.AssignRoleToUser + KYC) is wired
// at the composition root. This module NEVER rebuilds role-upgrade or KYC — it only
// surfaces unlocked roles and routes the application; Paymax owns the onboarding.
//
// UpgradeRole MUST be idempotent on `ref`: the same (userID, role, ref) returns the
// same paymax reference with no second onboarding. `ref` is the earning-application
// id so a replayed apply routes to the same upgrade. The application's
// idempotency_key gives us a SECOND idempotency guarantee at the persistence layer.
type RoleUpgrader interface {
	UpgradeRole(ctx context.Context, userID, role, ref string) (paymaxRef string, err error)
}

// noopRoleUpgrader is the default when no upgrader is injected (dev). It is
// deterministic and idempotent: it returns a synthetic reference derived from the
// application ref so a replay yields the same value. It performs NO onboarding — the
// real adapter is wired at the composition root.
type noopRoleUpgrader struct{}

func (noopRoleUpgrader) UpgradeRole(_ context.Context, _, role, ref string) (string, error) {
	return "noop-roleupgrade-" + role + "-" + ref, nil
}
