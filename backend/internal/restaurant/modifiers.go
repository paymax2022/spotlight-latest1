package restaurant

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// loadItemModifierGroups returns the modifier groups (each with its options) for a
// menu item, ordered deterministically (sort_order, then created_at) so pricing and
// the chosen-option snapshot are stable. Returns an empty slice for a plain item.
func (s *Service) loadItemModifierGroups(ctx context.Context, itemID string) ([]ModifierGroup, error) {
	const gq = `SELECT id, name, required, min_select, max_select
	            FROM menu_modifier_groups WHERE menu_item_id=$1
	            ORDER BY sort_order, created_at`
	rows, err := s.db.Query(ctx, gq, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var groups []ModifierGroup
	index := map[string]int{}
	var ids []string
	for rows.Next() {
		var g ModifierGroup
		if err := rows.Scan(&g.ID, &g.Name, &g.Required, &g.MinSelect, &g.MaxSelect); err != nil {
			return nil, err
		}
		index[g.ID] = len(groups)
		groups = append(groups, g)
		ids = append(ids, g.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(groups) == 0 {
		return groups, nil
	}

	const mq = `SELECT id, group_id, name, price_delta_kobo, is_available
	            FROM menu_modifiers WHERE group_id = ANY($1)
	            ORDER BY sort_order, created_at`
	mrows, err := s.db.Query(ctx, mq, ids)
	if err != nil {
		return nil, err
	}
	defer mrows.Close()
	for mrows.Next() {
		var m Modifier
		if err := mrows.Scan(&m.ID, &m.GroupID, &m.Name, &m.PriceDeltaKobo, &m.IsAvailable); err != nil {
			return nil, err
		}
		if i, ok := index[m.GroupID]; ok {
			groups[i].Modifiers = append(groups[i].Modifiers, m)
		}
	}
	return groups, mrows.Err()
}

// ListItemModifierGroups is the public read used by clients to render an item's
// options before ordering.
func (s *Service) ListItemModifierGroups(ctx context.Context, itemID string) ([]ModifierGroup, error) {
	return s.loadItemModifierGroups(ctx, itemID)
}

// assertItemOwned verifies the menu item belongs to the restaurant the caller owns.
// Ownership of the restaurant is checked first, then the item→restaurant link, so a
// cross-restaurant itemID can never be modified.
func (s *Service) assertItemOwned(ctx context.Context, restaurantID, userID, itemID string) error {
	if err := s.assertOwner(ctx, restaurantID, userID); err != nil {
		return err
	}
	var owned bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM menu_items WHERE id=$1 AND restaurant_id=$2)`,
		itemID, restaurantID).Scan(&owned); err != nil {
		return err
	}
	if !owned {
		return fmt.Errorf("restaurant: menu item does not belong to this restaurant")
	}
	return nil
}

// CreateModifierGroupRequest is the body for adding a modifier group to an item.
type CreateModifierGroupRequest struct {
	Name      string `json:"name" binding:"required,min=1,max=100"`
	Required  bool   `json:"required"`
	MinSelect int    `json:"min_select"`
	MaxSelect int    `json:"max_select"`
	SortOrder int    `json:"sort_order"`
}

// CreateModifierGroup adds a modifier group to a menu item (owner only). The
// selection rules are validated up front so the DB CHECK constraints are never the
// first line of defense.
func (s *Service) CreateModifierGroup(ctx context.Context, restaurantID, userID, itemID string, req CreateModifierGroupRequest) (*ModifierGroup, error) {
	if err := s.assertItemOwned(ctx, restaurantID, userID, itemID); err != nil {
		return nil, err
	}
	if req.MaxSelect < 1 {
		req.MaxSelect = 1
	}
	if req.MinSelect < 0 || req.MaxSelect < req.MinSelect {
		return nil, fmt.Errorf("restaurant: invalid selection rule (need 0 <= min_select <= max_select)")
	}
	if req.Required && req.MinSelect < 1 {
		req.MinSelect = 1
	}
	g := &ModifierGroup{
		ID: uuid.New().String(), Name: req.Name, Required: req.Required,
		MinSelect: req.MinSelect, MaxSelect: req.MaxSelect,
	}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO menu_modifier_groups (id, menu_item_id, name, required, min_select, max_select, sort_order)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		g.ID, itemID, g.Name, g.Required, g.MinSelect, g.MaxSelect, req.SortOrder); err != nil {
		return nil, err
	}
	return g, nil
}

// AddModifierRequest is the body for adding an option to a group.
type AddModifierRequest struct {
	Name           string `json:"name" binding:"required,min=1,max=100"`
	PriceDeltaKobo int64  `json:"price_delta_kobo"`
	SortOrder      int    `json:"sort_order"`
}

// AddModifier adds an option to a modifier group (owner only). The group is resolved
// back to its restaurant so a caller can only add options to their own menu.
func (s *Service) AddModifier(ctx context.Context, restaurantID, userID, groupID string, req AddModifierRequest) (*Modifier, error) {
	// Resolve the group's item, then assert the caller owns that item's restaurant.
	var itemID string
	if err := s.db.QueryRow(ctx,
		`SELECT menu_item_id FROM menu_modifier_groups WHERE id=$1`, groupID).Scan(&itemID); err != nil {
		return nil, fmt.Errorf("restaurant: modifier group not found")
	}
	if err := s.assertItemOwned(ctx, restaurantID, userID, itemID); err != nil {
		return nil, err
	}
	if req.PriceDeltaKobo < 0 {
		return nil, fmt.Errorf("restaurant: price_delta_kobo must be >= 0")
	}
	m := &Modifier{
		ID: uuid.New().String(), GroupID: groupID, Name: req.Name,
		PriceDeltaKobo: req.PriceDeltaKobo, IsAvailable: true,
	}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO menu_modifiers (id, group_id, name, price_delta_kobo, is_available, sort_order)
		 VALUES ($1,$2,$3,$4,true,$5)`,
		m.ID, m.GroupID, m.Name, m.PriceDeltaKobo, req.SortOrder); err != nil {
		return nil, err
	}
	return m, nil
}
