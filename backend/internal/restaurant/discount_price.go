package restaurant

import (
	"fmt"
	"time"
)

// Discount kinds and scopes, as stored.
const (
	discountPercent = "PERCENT"
	discountFixed   = "FIXED"

	scopeItem       = "ITEM"
	scopeCategory   = "CATEGORY"
	scopeRestaurant = "RESTAURANT"
)

// PriceDiscount is one live discount, loaded with the item links it applies to.
type PriceDiscount struct {
	ID          string
	Name        string
	Kind        string
	Value       int64
	Scope       string
	StartsAt    time.Time
	EndsAt      time.Time
	Active      bool
	MaxKobo     *int64
	ItemIDs     map[string]bool
	CategoryIDs map[string]bool // taxonomy node ids (a top-level category or a sub-category)
}

// ItemPrice is an item's price as a customer sees it.
type ItemPrice struct {
	OriginalKobo int64         `json:"original_kobo"`
	FinalKobo    int64         `json:"final_kobo"`
	Discount     *AppliedLabel `json:"discount"`
}

// AppliedLabel names the discount behind a reduced price.
type AppliedLabel struct {
	ID     string    `json:"id"`
	Kind   string    `json:"kind"`
	Label  string    `json:"label"`
	EndsAt time.Time `json:"ends_at"`
}

// live reports whether a discount is on at t: active, and inside [starts, ends).
// Start is inclusive and end is exclusive, so a discount is off the instant it ends.
func (d PriceDiscount) live(t time.Time) bool {
	return d.Active && !t.Before(d.StartsAt) && t.Before(d.EndsAt)
}

// appliesTo: an ITEM discount names the item; a CATEGORY discount matches the item's
// category or sub-category; a RESTAURANT discount covers every item.
func (d PriceDiscount) appliesTo(itemID, categoryID, subcategoryID string) bool {
	switch d.Scope {
	case scopeItem:
		return d.ItemIDs[itemID]
	case scopeCategory:
		return d.CategoryIDs[categoryID] || (subcategoryID != "" && d.CategoryIDs[subcategoryID])
	case scopeRestaurant:
		return true
	}
	return false
}

// saving is the kobo taken off a price. PERCENT rounds down and respects the cap;
// FIXED is capped so the final price is never below 1 kobo.
func (d PriceDiscount) saving(price int64) int64 {
	if price <= 1 {
		return 0
	}
	var s int64
	switch d.Kind {
	case discountPercent:
		s = price * d.Value / 100
		if d.MaxKobo != nil && s > *d.MaxKobo {
			s = *d.MaxKobo
		}
	case discountFixed:
		s = d.Value
	}
	if s > price-1 {
		s = price - 1
	}
	if s < 0 {
		s = 0
	}
	return s
}

// PriceItem prices one item at t. Only the single best live discount applies: the
// largest saving wins, ties go to the earlier-ending one, and nothing stacks.
func PriceItem(price int64, itemID, categoryID, subcategoryID string, ds []PriceDiscount, t time.Time) ItemPrice {
	out := ItemPrice{OriginalKobo: price, FinalKobo: price}
	var best *PriceDiscount
	var bestSave int64
	for i := range ds {
		d := ds[i]
		if !d.live(t) || !d.appliesTo(itemID, categoryID, subcategoryID) {
			continue
		}
		s := d.saving(price)
		if s <= 0 {
			continue
		}
		if best == nil || s > bestSave || (s == bestSave && d.EndsAt.Before(best.EndsAt)) {
			best = &ds[i]
			bestSave = s
		}
	}
	if best == nil {
		return out
	}
	out.FinalKobo = price - bestSave
	out.Discount = &AppliedLabel{ID: best.ID, Kind: best.Kind, Label: discountLabel(*best), EndsAt: best.EndsAt}
	return out
}

func discountLabel(d PriceDiscount) string {
	if d.Kind == discountPercent {
		return fmt.Sprintf("%d%% OFF", d.Value)
	}
	return fmt.Sprintf("₦%s OFF", kobosAsNaira(d.Value))
}

// kobosAsNaira formats whole kobo as naira with two decimals, using integers only.
func kobosAsNaira(k int64) string {
	return fmt.Sprintf("%d.%02d", k/100, k%100)
}
