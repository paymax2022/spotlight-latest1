package restaurant

import (
	"context"
	"errors"
	"fmt"
)

// applyBp returns amountKobo × bp / 10000 in whole kobo (basis points; 1000 = 10%),
// flooring so a derived fee/surge never rounds UP past the exact fraction. Pure —
// used for the item surge and the platform service fee. Negative/zero inputs → 0.
func applyBp(amountKobo int64, bp int) int64 {
	if amountKobo <= 0 || bp <= 0 {
		return 0
	}
	return amountKobo * int64(bp) / 10000
}

// PricingConfig is a restaurant's platform-controlled pricing knobs (basis points).
type PricingConfig struct {
	ServiceFeeBp     int `json:"service_fee_bp"`     // platform service fee, 0–10000 (0–100% of subtotal)
	SurgeBp          int `json:"surge_bp"`           // peak surge on the item subtotal, 0–50000 (0–5x)
	AcceptSlaMinutes int `json:"accept_sla_minutes"` // auto-cancel unaccepted orders after N min (0 = off)
}

// SetPricingConfig sets a restaurant's service-fee + surge basis points. Intended for
// platform ops (the route is fail-closed behind restaurant.admin.pricing); it is a
// platform control, not owner-settable, so a merchant cannot zero the service fee or
// inflate surge.
func (s *Service) SetPricingConfig(ctx context.Context, restaurantID string, cfg PricingConfig) error {
	if cfg.ServiceFeeBp < 0 || cfg.ServiceFeeBp > 10000 {
		return errors.New("restaurant: service_fee_bp must be in [0,10000]")
	}
	if cfg.SurgeBp < 0 || cfg.SurgeBp > 50000 {
		return errors.New("restaurant: surge_bp must be in [0,50000]")
	}
	if cfg.AcceptSlaMinutes < 0 || cfg.AcceptSlaMinutes > 1440 {
		return errors.New("restaurant: accept_sla_minutes must be in [0,1440]")
	}
	tag, err := s.db.Exec(ctx, `UPDATE restaurants SET service_fee_bp=$1, surge_bp=$2, accept_sla_minutes=$3, updated_at=now() WHERE id=$4`,
		cfg.ServiceFeeBp, cfg.SurgeBp, cfg.AcceptSlaMinutes, restaurantID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("restaurant: not found")
	}
	return nil
}

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
// It is pure (no DB, no clock) so the whole selection policy is table-testable. The
// rules, all fail-closed:
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

// The cart is built on a "takeaway package" model: the customer adds a pack,
// then puts food into it, and pays a mandatory fee per pack so the restaurant
// can package the order. `restaurants.packaging_fee_kobo` is the per-pack price
// the owner sets (₦200 by default).
// The pack COUNT is a customer choice — the packing rules set a floor (one main
// per pack, at most two portions of it) but the customer may add more packs than
// that — so the server cannot derive it and has to take it from the client. It is
// therefore bounded here before it can reach the escrow debit, for the same
// reason TipKobo is clamped: a client-supplied number must never price money
// without a ceiling the server owns.
// The fee settles 100% to the restaurant (settlement.Split.ProviderFeeKobo): the
// restaurant buys the packs, so it is a pass-through cost and neither the
// platform nor the rider takes a cut of it.

// maxPackagingKobo caps the packaging charge at ₦1,000,000 — far above any real
// order, low enough that packs × fee cannot overflow int64 or quietly become the
// dominant term of a total.
const maxPackagingKobo int64 = 100_000_000

// maxPackagingFeePerPackKobo bounds what an owner may charge for a single pack at
// ₦10,000. Well above any real takeaway pack, and low enough to catch the obvious
// data-entry slip — an owner typing a naira figure into a kobo field — before it
// is billed to customers.
const maxPackagingFeePerPackKobo int64 = 1_000_000

// PackagingKobo returns the number of packs actually charged and what they cost.
//   - requestedPacks is the customer's choice, clamped to [1, totalPortions]:
//     packaging is mandatory so it never falls below one, and a pack has to hold
//     something so it never exceeds one pack per portion. That upper bound is what
//     stops a hostile client inflating the escrow debit with empty packs.
//   - feePerPackKobo of 0 (or a negative, which the DB check already forbids)
//     costs the customer nothing.
//   - With no portions there is nothing to pack and nothing to charge.
func PackagingKobo(requestedPacks, totalPortions int, feePerPackKobo int64) (int, int64) {
	var kobo int64

	var packs int

	if totalPortions <= 0 {
		return 0, 0
	}

	packs = min(max(requestedPacks, 1), totalPortions)

	if feePerPackKobo <= 0 {
		return packs, 0
	}

	kobo = int64(packs) * feePerPackKobo
	// Guard the multiplication itself: a wrapped product would land in the order
	// total as a negative and break settlement conservation.
	if kobo < 0 || kobo > maxPackagingKobo {
		kobo = maxPackagingKobo
	}
	return packs, kobo
}
