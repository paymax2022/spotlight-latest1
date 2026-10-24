package restaurant

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
)

func secItem(id, name string, avail bool) MenuItem {
	return MenuItem{ID: id, Name: name, IsAvailable: avail}
}

func TestGroupMenuSections_OrdersByCategoryThenOmitsEmpty(t *testing.T) {
	items := []MenuItem{secItem("a", "Jollof", true), secItem("b", "Cola", true), secItem("c", "Rice", true)}
	itemCat := map[string]string{"a": "mains", "b": "drinks", "c": "mains"}
	cats := []sectionCategory{
		{ID: "drinks", Name: "Drinks", Slug: "drinks", SortOrder: 2},
		{ID: "mains", Name: "Mains", Slug: "mains", SortOrder: 1},
		{ID: "empty", Name: "Empty", Slug: "empty", SortOrder: 0},
	}
	got := groupMenuSections(items, itemCat, cats, nil)
	if len(got) != 2 {
		t.Fatalf("want 2 sections (empty omitted), got %d", len(got))
	}
	if got[0].Slug != "mains" || got[1].Slug != "drinks" {
		t.Fatalf("order wrong: %s, %s", got[0].Slug, got[1].Slug)
	}
	if got[0].ID == nil || *got[0].ID != "mains" {
		t.Fatalf("category section must carry its id")
	}
	if len(got[0].Items) != 2 || got[0].Items[0].ID != "a" || got[0].Items[1].ID != "c" {
		t.Fatalf("input order within a section must be stable: %+v", got[0].Items)
	}
}

func TestGroupMenuSections_TieBreaksByName(t *testing.T) {
	items := []MenuItem{secItem("a", "x", true), secItem("b", "y", true)}
	cats := []sectionCategory{{ID: "z", Name: "Zeta", Slug: "zeta"}, {ID: "al", Name: "Alpha", Slug: "alpha"}}
	got := groupMenuSections(items, map[string]string{"a": "z", "b": "al"}, cats, nil)
	if got[0].Name != "Alpha" || got[1].Name != "Zeta" {
		t.Fatalf("equal sort_order should order by name: %s, %s", got[0].Name, got[1].Name)
	}
}

func TestGroupMenuSections_LegacyAndOther(t *testing.T) {
	items := []MenuItem{
		secItem("a", "Jollof", true),
		secItem("b", "Soup", true),
		secItem("c", "Stew", false),
		secItem("d", "Mystery", true),
		secItem("e", "Wine", true),
	}
	itemCat := map[string]string{"a": "mains"}
	cats := []sectionCategory{{ID: "mains", Name: "Mains", Slug: "mains", SortOrder: 1}}
	legacy := map[string]string{"b": "Specials", "c": "Specials", "e": "Beverages"}
	got := groupMenuSections(items, itemCat, cats, legacy)
	if len(got) != 4 {
		t.Fatalf("want mains + 2 legacy + other = 4, got %d", len(got))
	}
	if got[1].Name != "Beverages" || got[2].Name != "Specials" {
		t.Fatalf("legacy sections ordered by label: %s, %s", got[1].Name, got[2].Name)
	}
	if got[1].ID != nil || got[2].ID != nil || got[3].ID != nil {
		t.Fatalf("legacy and Other sections must have nil id")
	}
	if len(got[2].Items) != 2 || got[2].Items[1].IsAvailable {
		t.Fatalf("unavailable items must still be included: %+v", got[2].Items)
	}
	if got[3].Name != "Other" || len(got[3].Items) != 1 || got[3].Items[0].ID != "d" {
		t.Fatalf("item with neither goes to Other: %+v", got[3])
	}
	for i := 1; i < len(got); i++ {
		if got[i].SortOrder <= got[i-1].SortOrder {
			t.Fatalf("sort_order must be increasing across sections")
		}
	}
}

func TestGroupMenuSections_UnknownCategoryFallsBack(t *testing.T) {
	// An item pointing at an inactive/unknown taxonomy category is not lost.
	got := groupMenuSections([]MenuItem{secItem("a", "x", true)}, map[string]string{"a": "gone"}, nil, nil)
	if len(got) != 1 || got[0].Name != "Other" {
		t.Fatalf("want Other, got %+v", got)
	}
}

func TestGroupMenuSections_EmptyAndJSON(t *testing.T) {
	if got := groupMenuSections(nil, nil, nil, nil); len(got) != 0 {
		t.Fatalf("no items -> no sections")
	}
	b, _ := json.Marshal(RestaurantDetail{})
	if strings.Contains(string(b), `"sections"`) {
		t.Fatalf("sections must be omitted when unset: %s", b)
	}
	b, _ = json.Marshal(Restaurant{})
	if strings.Contains(string(b), `"cuisines"`) {
		t.Fatalf("cuisines must be omitted when unset: %s", b)
	}
}

func TestLegacySlug_AlwaysValid(t *testing.T) {
	re := regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	seen := map[string]string{}
	for _, l := range []string{"Hot Food!", "???", "日本料理", "🍕", "한국", "  "} {
		got := legacySlug(l)
		if got == "" || !re.MatchString(got) {
			t.Errorf("legacySlug(%q) = %q, want non-empty valid slug", l, got)
		}
		if prev, dup := seen[got]; dup {
			t.Errorf("legacySlug(%q) = %q collides with %q", l, got, prev)
		}
		seen[got] = l
		if legacySlug(l) != got {
			t.Errorf("legacySlug(%q) not stable", l)
		}
	}
}
