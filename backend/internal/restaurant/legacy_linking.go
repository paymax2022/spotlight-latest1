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
