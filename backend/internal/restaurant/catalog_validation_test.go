package restaurant

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestPriceValidationIs400(t *testing.T) {
	for _, k := range []int64{-1, maxItemPriceKobo + 1} {
		err := validateItemPriceKobo(k)
		if !errors.Is(err, ErrInvalidInput) || menuErrStatus(err) != http.StatusBadRequest {
			t.Fatalf("price %d: want 400, got %v / %d", k, err, menuErrStatus(err))
		}
	}
	if menuErrStatus(errors.New("restaurant: only the owner may manage the menu")) != http.StatusForbidden {
		t.Fatal("permission failure must stay 403")
	}
}

func TestEmptyMenuShape(t *testing.T) {
	b, _ := json.Marshal(withEmptyMenuShape(&RestaurantDetail{}))
	var m map[string]json.RawMessage
	_ = json.Unmarshal(b, &m)
	if string(m["categories"]) != "[]" {
		t.Fatalf("categories = %s", m["categories"])
	}
	b, _ = json.Marshal(MenuItem{})
	if !json.Valid(b) || string(b) == "" {
		t.Fatal("bad json")
	}
}

func TestWithEmptyMenuShape_NormalisesSectionItems(t *testing.T) {
	d := &RestaurantDetail{
		Categories: []MenuCategory{{Items: []MenuItem{{}}}},
		Sections:   []MenuSection{{Items: []MenuItem{{}}}, {}},
	}
	b, _ := json.Marshal(withEmptyMenuShape(d))
	s := string(b)
	if strings.Contains(s, `"modifier_groups":null`) || strings.Contains(s, `"dietary_tags":null`) || strings.Contains(s, `"items":null`) {
		t.Errorf("null leaked: %s", s)
	}
	si := d.Sections[0].Items[0]
	ci := d.Categories[0].Items[0]
	if si.ModifierGroups == nil || si.DietaryTags == nil || ci.ModifierGroups == nil || ci.DietaryTags == nil {
		t.Errorf("section and category items must both read []")
	}
}
