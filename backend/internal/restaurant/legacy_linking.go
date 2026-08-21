package restaurant

import (
	"context"
	"time"
)

// ── Unclaimed restaurants (foodhub §5.4 case 2) ─────────────────────────────
//
// A restaurant is UNCLAIMED when nobody can be identified as its merchant: no
// owner, or an owner with no active merchant profile. Such a shop can appear in
// discovery and take orders while no one can manage it and no payout has a
// destination.
//
// There are none today — the linking migration (20261213000000) gave all 1539
// owners a profile, and every restaurant has an owner_id. This exists so the
// state is DETECTABLE rather than silent: an admin-seeded or imported row would
// otherwise sit unmanaged with nothing surfacing it.

// UnclaimedRestaurant is a shop with no identifiable merchant behind it.
type UnclaimedRestaurant struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Address   string    `json:"address"`
	IsOpen    bool      `json:"is_open"`
	CreatedAt time.Time `json:"created_at"`
	// Reason distinguishes "no owner at all" from "owner has no merchant profile",
	// because the fix differs: assign an owner, versus link the one who is there.
	Reason string `json:"reason"`
}

// UnclaimedRestaurants lists shops with no identifiable merchant.
//
// Deliberately DERIVED rather than stored as an `unclaimed` flag: a flag drifts
// the moment an owner is assigned or a profile is created, and a stale flag on
// this particular question would either hide a real orphan or accuse a working
// restaurant.
func (s *Service) UnclaimedRestaurants(ctx context.Context) ([]UnclaimedRestaurant, error) {
	const q = `
		SELECT r.id, r.name, r.address, r.is_open, r.created_at,
		       CASE WHEN r.owner_id IS NULL THEN 'no owner assigned'
		            ELSE 'owner has no merchant profile' END AS reason
		FROM restaurants r
		WHERE r.owner_id IS NULL
		   OR NOT EXISTS (
		     SELECT 1 FROM onb_merchant_profile p
		     WHERE p.user_id = r.owner_id
		       AND p.merchant_type_id = 'mt-restaurant'
		       AND p.status = 'ACTIVE'
		   )
		ORDER BY r.created_at DESC
		LIMIT 200`

	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []UnclaimedRestaurant{}
	for rows.Next() {
		var u UnclaimedRestaurant
		if err := rows.Scan(&u.ID, &u.Name, &u.Address, &u.IsOpen, &u.CreatedAt, &u.Reason); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// ── Legacy owner linking (foodhub §5.4 case 1) ──────────────────────────────

// LinkLegacyOwners gives every restaurant owner without one an ACTIVE merchant
// profile, the RBAC role, and a link from their shops to that profile.
//
// The same statements the 20261213000000 migration runs, exposed as a callable
// job because the condition recurs: an imported or admin-created restaurant
// arrives with an owner who has never been through onboarding, and would
// otherwise be invisible to the merchant hub while trading normally.
//
// Idempotent — every statement is ON CONFLICT DO NOTHING or a no-op UPDATE — so
// running it twice links nothing twice. Returns how many profiles it created.
//
// Legacy profiles keep application_id NULL: nobody applied, and inventing an
// application would fabricate a review that never happened.
func (s *Service) LinkLegacyOwners(ctx context.Context) (int, error) {
	tag, err := s.db.Exec(ctx, `
		INSERT INTO onb_merchant_profile
		  (user_id, module_id, merchant_type_id, application_id, role_granted, status, workspace_route, activated_at)
		SELECT DISTINCT r.owner_id, 'mod-food', 'mt-restaurant', NULL::uuid, 'restaurant_merchant', 'ACTIVE',
		       '/merchant/restaurant', now()
		FROM restaurants r
		WHERE r.owner_id IS NOT NULL
		  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.owner_id)
		ON CONFLICT (user_id, merchant_type_id) DO NOTHING`)
	if err != nil {
		return 0, err
	}
	created := int(tag.RowsAffected())

	// A profile without the role is a half grant: the hub shows the business while
	// permissioned routes refuse it.
	if _, err := s.db.Exec(ctx, `
		INSERT INTO user_roles (user_id, role_id, scope_type, scope_id, is_active)
		SELECT DISTINCT p.user_id, ro.id, 'global', NULL, true
		FROM onb_merchant_profile p
		JOIN roles ro ON ro.slug = 'restaurant_merchant' AND ro.is_active
		WHERE p.merchant_type_id = 'mt-restaurant' AND p.status = 'ACTIVE'
		ON CONFLICT (user_id, role_id, scope_type, scope_id) DO UPDATE SET is_active = true, updated_at = NOW()`); err != nil {
		return created, err
	}

	// Matched on user_id, so a shop can never be attributed to someone else's
	// merchant record.
	if _, err := s.db.Exec(ctx, `
		UPDATE restaurants r
		   SET owner_profile_id = p.id
		  FROM onb_merchant_profile p
		 WHERE p.user_id = r.owner_id
		   AND p.merchant_type_id = 'mt-restaurant'
		   AND p.status = 'ACTIVE'
		   AND r.owner_profile_id IS DISTINCT FROM p.id`); err != nil {
		return created, err
	}
	return created, nil
}
