package restaurant

import (
	"errors"
	"fmt"
)

// ErrInvalidModifierSelection is returned when a client's chosen modifiers for a
// line violate the menu item's modifier rules (unknown/unavailable option, a
// duplicate, or a group's min/max/required constraint). It is a client error — the
// PlaceOrder handler maps it to HTTP 400, not 500.
var ErrInvalidModifierSelection = errors.New("restaurant: invalid modifier selection")

// ModifierGroup is a set of options attached to a menu item (e.g. "Size", "Extras")
// with selection rules. A line's chosen options are validated against every group.
type ModifierGroup struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Required  bool       `json:"required"`
	MinSelect int        `json:"min_select"` // minimum options that must be chosen from this group
	MaxSelect int        `json:"max_select"` // maximum options that may be chosen (>= 1)
	Modifiers []Modifier `json:"modifiers"`
}

// Modifier is one selectable option within a group, priced as a per-unit delta on
// top of the menu item's base price (delta is always >= 0 — add-ons never discount).
type Modifier struct {
	ID             string `json:"id"`
	GroupID        string `json:"group_id"`
	Name           string `json:"name"`
	PriceDeltaKobo int64  `json:"price_delta_kobo"`
	IsAvailable    bool   `json:"is_available"`
}

// effectiveMin is the true lower bound on selections for a group: a required group
// must have at least one choice even if MinSelect was left at 0.
func (g ModifierGroup) effectiveMin() int {
	if g.Required && g.MinSelect < 1 {
		return 1
	}
	return g.MinSelect
}

// resolveLineModifiers validates the client's chosen modifier IDs for ONE menu item
// against that item's modifier groups, and returns the chosen modifiers (in group
// order, for a stable order-line snapshot) plus the per-unit price delta to add to
// the item's base price.
//
// It is pure (no DB, no clock) so the whole selection policy is table-testable. The
// rules, all fail-closed:
//
//   - every chosen ID must be a KNOWN, AVAILABLE option of one of this item's groups;
//   - the chosen IDs must be DISTINCT (no selecting the same option twice);
//   - per group, the number of chosen options must fall within
//     [effectiveMin, MaxSelect] — this enforces "required", "pick exactly one"
//     (min=max=1), and "pick up to N" uniformly.
//
// deltaKobo is the sum of the chosen options' PriceDeltaKobo (a PER-UNIT amount; the
// caller multiplies the line unit price by quantity).
func resolveLineModifiers(groups []ModifierGroup, chosenIDs []string) (chosen []Modifier, deltaKobo int64, err error) {
	// Index every available option by ID, and remember which group it belongs to, so
	// an unknown/unavailable ID is rejected rather than silently priced at zero.
	type owned struct {
		mod     Modifier
		groupID string
	}
	byID := make(map[string]owned, 16)
	for _, g := range groups {
		for _, m := range g.Modifiers {
			if m.IsAvailable {
				byID[m.ID] = owned{mod: m, groupID: g.ID}
			}
		}
	}

	// Count distinct valid choices per group; reject unknown IDs and duplicates.
	seen := make(map[string]bool, len(chosenIDs))
	perGroup := make(map[string]int, len(groups))
	for _, id := range chosenIDs {
		if seen[id] {
			return nil, 0, fmt.Errorf("%w: option %s selected more than once", ErrInvalidModifierSelection, id)
		}
		seen[id] = true
		o, ok := byID[id]
		if !ok {
			return nil, 0, fmt.Errorf("%w: option %s is not an available choice for this item", ErrInvalidModifierSelection, id)
		}
		perGroup[o.groupID]++
	}

	// Enforce each group's min/max. Iterate groups (not the map) for deterministic
	// error messages and a stable chosen-modifier ordering.
	for _, g := range groups {
		n := perGroup[g.ID]
		if lo := g.effectiveMin(); n < lo {
			return nil, 0, fmt.Errorf("%w: group %q requires at least %d selection(s), got %d", ErrInvalidModifierSelection, g.Name, lo, n)
		}
		if n > g.MaxSelect {
			return nil, 0, fmt.Errorf("%w: group %q allows at most %d selection(s), got %d", ErrInvalidModifierSelection, g.Name, g.MaxSelect, n)
		}
		// Append this group's chosen options in the group's own option order.
		for _, m := range g.Modifiers {
			if seen[m.ID] && m.IsAvailable {
				chosen = append(chosen, m)
				deltaKobo += m.PriceDeltaKobo
			}
		}
	}
	return chosen, deltaKobo, nil
}
