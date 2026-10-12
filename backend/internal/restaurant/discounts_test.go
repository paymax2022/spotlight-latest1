package restaurant

import (
	"testing"
	"time"
)

func validInput() DiscountInput {
	return DiscountInput{
		Name: "Weekend Jollof Deal", Kind: discountPercent, Value: 15, Scope: scopeRestaurant,
		StartsAt: t0, EndsAt: t0.Add(48 * time.Hour),
	}
}

func TestValidateDiscount_AcceptsAWellFormedDiscount(t *testing.T) {
	if err := ValidateDiscount(validInput()); err != nil {
		t.Fatalf("valid discount refused: %v", err)
	}
}

func TestValidateDiscount_RefusesEachBadRule(t *testing.T) {
	cases := map[string]func(*DiscountInput){
		"percent above 90":     func(in *DiscountInput) { in.Value = 91 },
		"percent of zero":      func(in *DiscountInput) { in.Value = 0 },
		"fixed of zero":        func(in *DiscountInput) { in.Kind = discountFixed; in.Value = 0 },
		"fixed above limit":    func(in *DiscountInput) { in.Kind = discountFixed; in.Value = maxItemPriceKobo + 1 },
		"unknown kind":         func(in *DiscountInput) { in.Kind = "BOGO" },
		"unknown scope":        func(in *DiscountInput) { in.Scope = "EVERYTHING" },
		"item scope, no items": func(in *DiscountInput) { in.Scope = scopeItem },
		"category, no cats":    func(in *DiscountInput) { in.Scope = scopeCategory },
		"end equals start":     func(in *DiscountInput) { in.EndsAt = in.StartsAt },
		"end before start":     func(in *DiscountInput) { in.EndsAt = in.StartsAt.Add(-time.Hour) },
		"blank name":           func(in *DiscountInput) { in.Name = "   " },
		"zero cap":             func(in *DiscountInput) { z := int64(0); in.MaxDiscountKobo = &z },
	}
	for name, mutate := range cases {
		in := validInput()
		mutate(&in)
		if err := ValidateDiscount(in); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestValidateDiscount_ItemScopeNeedsItemsAndCategoryScopeNeedsCategories(t *testing.T) {
	in := validInput()
	in.Scope = scopeItem
	in.ItemIDs = []string{"a"}
	if err := ValidateDiscount(in); err != nil {
		t.Fatalf("item scope with an item refused: %v", err)
	}
	in = validInput()
	in.Scope = scopeCategory
	in.CategoryIDs = []string{"c"}
	if err := ValidateDiscount(in); err != nil {
		t.Fatalf("category scope with a category refused: %v", err)
	}
}
