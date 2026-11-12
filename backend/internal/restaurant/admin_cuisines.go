package restaurant

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/google/uuid"
)

// Operator cuisine assignment for a restaurant.
//
// `restaurant_cuisines` is the only restaurant-level tag table: discovery filters
// on it (`?cuisine_id=`) and the store page renders it. Until this endpoint there
// was no writer anywhere in the codebase — the onboarding console showed eight
// hardcoded, permanently disabled checkboxes, so no restaurant could ever be
// tagged and cuisine browsing had nothing to match. Menu CATEGORIES are not
// restaurant tags at all; they belong to individual menu items
// (menu_items.taxonomy_category_id), so they are not assigned here.

// AdminCuisineOption is one row of the assignment picker. Inactive cuisines are
// included: a restaurant tagged before deactivation still holds the tag, and the
// operator needs to be able to clear it.
type AdminCuisineOption struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Slug      string `json:"slug"`
	SortOrder int    `json:"sort_order"`
	IsActive  bool   `json:"is_active"`
}

// AdminRestaurantCuisines is the restaurant's assignment view: everything
// assignable, plus the cuisine ids currently attached.
type AdminRestaurantCuisines struct {
	Available []AdminCuisineOption `json:"available"`
	Selected  []string             `json:"selected"`
}

func (s *Service) AdminGetRestaurantCuisines(ctx context.Context, restaurantID string) (AdminRestaurantCuisines, error) {
	out := AdminRestaurantCuisines{Available: []AdminCuisineOption{}, Selected: []string{}}
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM restaurants WHERE id=$1)`, restaurantID).Scan(&exists); err != nil {
		return out, err
	}
	if !exists {
		return out, ErrRestaurantNotFound
	}

	rows, err := s.db.Query(ctx, `
		SELECT id::text, name, slug, sort_order, is_active
		  FROM cuisines
		 ORDER BY is_active DESC, sort_order, name`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var o AdminCuisineOption
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.SortOrder, &o.IsActive); err != nil {
			return out, err
		}
		out.Available = append(out.Available, o)
	}
	if err := rows.Err(); err != nil {
		return out, err
	}

	sel, err := s.db.Query(ctx, `SELECT cuisine_id::text FROM restaurant_cuisines WHERE restaurant_id=$1`, restaurantID)
	if err != nil {
		return out, err
	}
	defer sel.Close()
	for sel.Next() {
		var id string
		if err := sel.Scan(&id); err != nil {
			return out, err
		}
		out.Selected = append(out.Selected, id)
	}
	return out, sel.Err()
}

// AdminSetRestaurantCuisines replaces the restaurant's cuisine tags with exactly
// the supplied set (an empty set clears them). Unknown ids are refused rather
// than silently dropped: a reviewer who ticked a cuisine that no longer exists
// must see why the save failed.
func (s *Service) AdminSetRestaurantCuisines(ctx context.Context, actorID, restaurantID string, cuisineIDs []string) (AdminRestaurantCuisines, error) {
	ids := make([]string, 0, len(cuisineIDs))
	seen := make(map[string]struct{}, len(cuisineIDs))
	for _, raw := range cuisineIDs {
		u, err := uuid.Parse(strings.TrimSpace(raw))
		if err != nil {
			return AdminRestaurantCuisines{}, fmt.Errorf("%w: %q is not a cuisine id", ErrInvalidInput, raw)
		}
		id := u.String()
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return AdminRestaurantCuisines{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM restaurants WHERE id=$1)`, restaurantID).Scan(&exists); err != nil {
		return AdminRestaurantCuisines{}, err
	}
	if !exists {
		return AdminRestaurantCuisines{}, ErrRestaurantNotFound
	}

	if len(ids) > 0 {
		var found int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM cuisines WHERE id = ANY($1::uuid[])`, ids).Scan(&found); err != nil {
			return AdminRestaurantCuisines{}, err
		}
		if found != len(ids) {
			return AdminRestaurantCuisines{}, fmt.Errorf("%w: unknown cuisine id", ErrInvalidInput)
		}
	}

	if _, err := tx.Exec(ctx, `DELETE FROM restaurant_cuisines WHERE restaurant_id=$1`, restaurantID); err != nil {
		return AdminRestaurantCuisines{}, err
	}
	if len(ids) > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id)
			SELECT $1, unnest($2::uuid[])`, restaurantID, ids); err != nil {
			return AdminRestaurantCuisines{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return AdminRestaurantCuisines{}, err
	}
	log.Printf("[restaurant] admin %s set %d cuisines on %s", actorID, len(ids), restaurantID)
	return s.AdminGetRestaurantCuisines(ctx, restaurantID)
}
