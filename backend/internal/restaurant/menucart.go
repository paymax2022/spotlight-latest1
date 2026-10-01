package restaurant

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"github.com/google/uuid"
)

const (
	// maxItemPriceKobo caps a single menu item at ₦1,000,000 (MN-004 — a sanity bound
	// against fat-finger/overflow prices; the DB already forbids negatives).
	maxItemPriceKobo = 100_000_000
	// maxInstructionsLen caps the free-text order note (CT-009).
	maxInstructionsLen = 500
	// maxDietaryTags / maxTagLen bound the per-item dietary label set (MN-009).
	maxDietaryTags = 12
	maxTagLen      = 32
	// maxLineQuantity and maxOrderSubtotalKobo bound the cart so the derived pricing
	// arithmetic stays inside int64. They are SANITY bounds, far above any real food
	// order (1,000 units of one dish; ₦10,000,000 of food), not business policy.
	// They matter because the surge/service-fee maths multiplies BEFORE it divides:
	// applyBp computes `amountKobo * bp` first, and with surge_bp at its 50,000 ceiling
	// that overflows int64 once the subtotal passes ~1.845e14 kobo. Quantity was
	// otherwise only bounded below (>= 1), so a client sending quantity 2,000,000 of a
	// max-priced item reached that on its own — and a wrapped-negative subtotal on the
	// money path is not a state worth reasoning about. order_items.quantity is a
	// Postgres INT, but that only errors AFTER the escrow debit has been posted.
	maxLineQuantity      = 1_000
	maxOrderSubtotalKobo = 1_000_000_000_000
)

// validateItemPriceKobo enforces the menu-item price bounds (MN-004): non-negative and
// no larger than maxItemPriceKobo.
func validateItemPriceKobo(kobo int64) error {
	if kobo < 0 {
		return fmt.Errorf("restaurant: price_kobo must be >= 0")
	}
	if kobo > maxItemPriceKobo {
		return fmt.Errorf("restaurant: price_kobo must be <= %d (₦1,000,000)", maxItemPriceKobo)
	}
	return nil
}

// sanitizeInstructions cleans a customer's free-text order note (CT-009): strips control
// characters (so no injected escape/format bytes reach downstream views), collapses
// runs of whitespace, trims, and caps the length. Purely defensive normalization — it
// never trusts client formatting.
func sanitizeInstructions(s string) string {
	var b strings.Builder
	lastSpace := false
	for _, r := range s {
		if r == '\n' || r == '\t' {
			r = ' '
		}
		if unicode.IsControl(r) {
			continue // drop other control chars
		}
		if r == ' ' {
			if lastSpace {
				continue
			}
			lastSpace = true
		} else {
			lastSpace = false
		}
		b.WriteRune(r)
	}
	out := strings.TrimSpace(b.String())
	if len(out) > maxInstructionsLen {
		out = strings.TrimSpace(out[:maxInstructionsLen])
	}
	return out
}

// normalizeDietaryTags cleans a set of dietary/allergen labels (MN-009): lower-cased,
// trimmed, de-duplicated, sorted (stable output), each capped at maxTagLen, empties
// dropped, and the whole set capped at maxDietaryTags. Open vocabulary (vegan,
// vegetarian, halal, gluten_free, contains_nuts, …) — normalized, not white-listed.
func normalizeDietaryTags(tags []string) []string {
	seen := map[string]bool{}
	out := []string{} // non-nil so a tag-less item inserts '{}' (NOT NULL column), not NULL
	for _, t := range tags {
		t = strings.ToLower(strings.TrimSpace(t))
		t = strings.ReplaceAll(t, " ", "_")
		if t == "" || seen[t] {
			continue
		}
		if len(t) > maxTagLen {
			t = t[:maxTagLen]
		}
		seen[t] = true
		out = append(out, t)
		if len(out) >= maxDietaryTags {
			break
		}
	}
	sort.Strings(out)
	return out
}

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
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageMenu); err != nil {
		return err
	}
	var owned bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM menu_items WHERE id=$1 AND restaurant_id=$2)`,
		itemID, restaurantID).Scan(&owned); err != nil {
		return err
	}
	if !owned {
		return errors.New("restaurant: menu item does not belong to this restaurant")
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
		return nil, errors.New("restaurant: invalid selection rule (need 0 <= min_select <= max_select)")
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
		return nil, errors.New("restaurant: modifier group not found")
	}
	if err := s.assertItemOwned(ctx, restaurantID, userID, itemID); err != nil {
		return nil, err
	}
	if req.PriceDeltaKobo < 0 {
		return nil, errors.New("restaurant: price_delta_kobo must be >= 0")
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
