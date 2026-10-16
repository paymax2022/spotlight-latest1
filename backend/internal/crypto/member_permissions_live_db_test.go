package crypto

// LIVE-DB regression: ordinary members must hold the crypto MEMBER permissions.
//
// 20260815001600_crypto.sql attached crypto.view / crypto.trade / crypto.admin only to
// super-admin and system-admin, so every member route (RequirePermission) answered 403
// for a normal user whatever the feature flags said. 20271042000000_crypto_member_permissions
// grants view+trade to the default member roles. crypto.admin must stay admin-only.
// SKIPPED whenever TEST_DATABASE_URL is unset.

import (
	"context"
	"testing"
)

func TestLiveDB_MembersHoldCryptoViewAndTrade_NotAdmin(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	has := func(role, perm string) bool {
		var n int
		err := pool.QueryRow(ctx, `
			SELECT count(*) FROM public.roles r
			JOIN public.role_permissions rp ON rp.role_id = r.id
			JOIN public.permissions p ON p.id = rp.permission_id
			WHERE r.slug = $1 AND p.slug = $2`, role, perm).Scan(&n)
		if err != nil {
			t.Fatalf("lookup %s/%s: %v", role, perm, err)
		}
		return n > 0
	}

	for _, role := range []string{"registered-user", "verified-user"} {
		for _, perm := range []string{PermView, PermTrade} {
			if !has(role, perm) {
				t.Errorf("role %q is missing %q: members get 403 on every crypto route", role, perm)
			}
		}
		if has(role, "crypto.admin") {
			t.Errorf("role %q must NOT hold crypto.admin", role)
		}
	}
	for _, perm := range []string{PermView, PermTrade, "crypto.admin"} {
		if !has("super-admin", perm) {
			t.Errorf("super-admin lost %q", perm)
		}
	}
}
