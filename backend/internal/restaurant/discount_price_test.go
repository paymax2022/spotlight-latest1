package restaurant

import (
	"testing"
	"time"
)

var (
	t0 = time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)
)

func pd(id, kind string, value int64, scope string, startsOff, endsOff time.Duration) PriceDiscount {
	return PriceDiscount{
		ID: id, Kind: kind, Value: value, Scope: scope, Active: true,
		StartsAt: t0.Add(startsOff), EndsAt: t0.Add(endsOff),
		ItemIDs:     map[string]bool{"item-1": true},
		CategoryIDs: map[string]bool{"cat-1": true},
	}
}

func TestPercentRoundsDownAndRespectsTheCap(t *testing.T) {
	d := pd("p", discountPercent, 15, scopeRestaurant, -time.Hour, time.Hour)
	if got := d.saving(999); got != 149 { // 999*15/100 = 149.85 -> 149
		t.Fatalf("saving = %d, want 149 (floor)", got)
	}
	cap := int64(100)
	d.MaxKobo = &cap
	if got := d.saving(100000); got != 100 {
		t.Fatalf("capped saving = %d, want 100", got)
	}
}

func TestFixedIsCappedSoTheFinalPriceStaysAtLeastOneKobo(t *testing.T) {
	d := pd("f", discountFixed, 50000, scopeRestaurant, -time.Hour, time.Hour)
	if got := d.saving(30000); got != 29999 {
		t.Fatalf("saving = %d, want 29999 (final stays at 1 kobo)", got)
	}
	if got := d.saving(1); got != 0 {
		t.Fatalf("a 1-kobo item cannot be discounted, got %d", got)
	}
}

func TestBestSingleDiscountWinsAndNothingStacks(t *testing.T) {
	ds := []PriceDiscount{
		pd("ten-pct", discountPercent, 10, scopeRestaurant, -time.Hour, time.Hour),
		pd("fixed-2000", discountFixed, 200000, scopeRestaurant, -time.Hour, time.Hour),
	}
	got := PriceItem(1000000, "item-1", "cat-1", "", ds, t0)
	// 10% = 100000; fixed = 200000. Only the 200000 applies, not both.
	if got.FinalKobo != 800000 || got.Discount == nil || got.Discount.ID != "fixed-2000" {
		t.Fatalf("got %+v", got)
	}
}

func TestStartIsInclusiveEndIsExclusive(t *testing.T) {
	onStart := pd("s", discountPercent, 10, scopeRestaurant, 0, time.Hour)
	if PriceItem(10000, "item-1", "", "", []PriceDiscount{onStart}, t0).Discount == nil {
		t.Fatal("a discount must apply at its start instant")
	}
	atEnd := pd("e", discountPercent, 10, scopeRestaurant, -time.Hour, 0)
	if PriceItem(10000, "item-1", "", "", []PriceDiscount{atEnd}, t0).Discount != nil {
		t.Fatal("a discount must be off at its end instant")
	}
}

func TestPausedDiscountIsIgnored(t *testing.T) {
	d := pd("paused", discountPercent, 50, scopeRestaurant, -time.Hour, time.Hour)
	d.Active = false
	if PriceItem(10000, "item-1", "", "", []PriceDiscount{d}, t0).Discount != nil {
		t.Fatal("a paused discount must not apply")
	}
}

func TestScopeDecidesWhichItemsAreCovered(t *testing.T) {
	byItem := pd("i", discountPercent, 10, scopeItem, -time.Hour, time.Hour)
	if PriceItem(10000, "other-item", "cat-1", "", []PriceDiscount{byItem}, t0).Discount != nil {
		t.Fatal("an ITEM discount must not cover another item")
	}
	byCat := pd("c", discountPercent, 10, scopeCategory, -time.Hour, time.Hour)
	if PriceItem(10000, "other-item", "cat-1", "", []PriceDiscount{byCat}, t0).Discount == nil {
		t.Fatal("a CATEGORY discount must cover items in that category")
	}
	if PriceItem(10000, "other-item", "cat-9", "cat-1", []PriceDiscount{byCat}, t0).Discount == nil {
		t.Fatal("a CATEGORY discount on a parent must cover items in its sub-category")
	}
	if PriceItem(10000, "x", "cat-9", "", []PriceDiscount{byCat}, t0).Discount != nil {
		t.Fatal("an item outside the category must not be discounted")
	}
}

func TestTieGoesToTheEarlierEnding(t *testing.T) {
	early := pd("early", discountPercent, 10, scopeRestaurant, -time.Hour, time.Hour)
	late := pd("late", discountPercent, 10, scopeRestaurant, -time.Hour, 2*time.Hour)
	got := PriceItem(10000, "item-1", "", "", []PriceDiscount{late, early}, t0)
	if got.Discount == nil || got.Discount.ID != "early" {
		t.Fatalf("tie should pick the earlier-ending discount, got %+v", got.Discount)
	}
}

func TestLabelsAreExact(t *testing.T) {
	if got := discountLabel(pd("p", discountPercent, 15, scopeRestaurant, 0, time.Hour)); got != "15% OFF" {
		t.Fatalf("percent label = %q", got)
	}
	if got := discountLabel(pd("f", discountFixed, 250050, scopeRestaurant, 0, time.Hour)); got != "₦2500.50 OFF" {
		t.Fatalf("fixed label = %q", got)
	}
}
