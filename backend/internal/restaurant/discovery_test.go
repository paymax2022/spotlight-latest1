package restaurant

import (
	"strings"
	"testing"
	"time"
)

func TestBuildSearchQuery_DishSearch(t *testing.T) {
	sql, args := buildSearchQuery(SearchParams{Query: "jollof"}, time.Now(), time.UTC)
	if !strings.Contains(sql, "EXISTS (SELECT 1 FROM menu_items mi WHERE mi.restaurant_id = r.id AND mi.name ILIKE") {
		t.Errorf("text query must also match menu-item names (dish search): %s", sql)
	}
	if args[0] != "%jollof%" {
		t.Errorf("query arg = %v", args[0])
	}
}

func TestBuildSearchQuery_DietaryFilter(t *testing.T) {
	sql, args := buildSearchQuery(SearchParams{DietaryTags: []string{"Vegan", "vegan", "Gluten Free"}}, time.Now(), time.UTC)
	if !strings.Contains(sql, "mi.dietary_tags &&") {
		t.Errorf("dietary filter must use array-overlap on available items: %s", sql)
	}
	// The normalized, de-duped tag array is passed as one param.
	tags, ok := args[len(args)-3].([]string) // before LIMIT/OFFSET
	if !ok {
		// fall back: find the []string arg
		for _, a := range args {
			if v, isSlice := a.([]string); isSlice {
				tags, ok = v, true
			}
		}
	}
	if !ok || len(tags) != 2 {
		t.Errorf("dietary tags should be normalized+deduped to 2, got %v", tags)
	}
}

func TestValidateAddress(t *testing.T) {
	ok := SavedAddress{Label: "Home", Address: "1 Test Street, Lagos"}
	if err := validateAddress(ok); err != nil {
		t.Errorf("valid address rejected: %v", err)
	}
	bad := []SavedAddress{
		{Label: "", Address: "1 Test Street"},                              // empty label
		{Label: "Home", Address: "x"},                                      // too short
		{Label: "Home", Address: "1 Test Street", Lat: new(float64(200))},  // lat out of range
		{Label: "Home", Address: "1 Test Street", Lng: new(float64(-999))}, // lng out of range
	}
	for i, a := range bad {
		if err := validateAddress(a); err == nil {
			t.Errorf("case %d should be rejected", i)
		}
	}
}

//go:fix inline
func fptr(f float64) *float64 { return new(f) }

const taxUUID1 = "11111111-1111-4111-8111-111111111111"
const taxUUID2 = "22222222-2222-4222-8222-222222222222"

func TestBuildDiscoveryWhere_CuisineIDs(t *testing.T) {
	sql, args := buildDiscoveryWhere(DiscoveryParams{CuisineIDs: []string{taxUUID1}}, false)
	if !strings.Contains(sql, "EXISTS (SELECT 1 FROM restaurant_cuisines") {
		t.Errorf("cuisine_id must filter via restaurant_cuisines: %s", sql)
	}
	if len(args) != 1 {
		t.Fatalf("want 1 arg, got %v", args)
	}
	if got, ok := args[0].([]string); !ok || len(got) != 1 || got[0] != taxUUID1 {
		t.Errorf("arg must be the []string array placeholder, got %#v", args[0])
	}
	if strings.Contains(sql, taxUUID1) {
		t.Errorf("id must not be interpolated: %s", sql)
	}
}

func TestBuildDiscoveryWhere_CategoryIDs_MatchesSubcategory(t *testing.T) {
	sql, args := buildDiscoveryWhere(DiscoveryParams{CategoryIDs: []string{taxUUID1, taxUUID2}}, false)
	for _, want := range []string{"taxonomy_category_id", "taxonomy_subcategory_id", "mi.is_available"} {
		if !strings.Contains(sql, want) {
			t.Errorf("missing %q in %s", want, sql)
		}
	}
	if len(args) != 1 {
		t.Errorf("category array must reuse one placeholder, args=%v", args)
	}
	if strings.Contains(sql, taxUUID1) {
		t.Errorf("id must not be interpolated: %s", sql)
	}
}

func TestBuildDiscoveryWhere_NoTaxonomyParams_Unchanged(t *testing.T) {
	want, wantArgs := buildDiscoveryWhere(DiscoveryParams{Query: "x"}, true)
	got, gotArgs := buildDiscoveryWhere(DiscoveryParams{Query: "x", CuisineIDs: []string{}, CategoryIDs: nil}, true)
	if got != want || len(gotArgs) != len(wantArgs) {
		t.Errorf("empty slices changed the WHERE:\n%s\n%s", want, got)
	}
	if strings.Contains(got, "restaurant_cuisines") || strings.Contains(got, "FALSE") {
		t.Errorf("unexpected taxonomy clause: %s", got)
	}
}

func TestBuildDiscoveryWhere_AllInvalidCategoryIDs_MatchesNothing(t *testing.T) {
	p := DiscoveryParams{CategoryIDs: []string{"x"}}.normalized()
	sql, _ := buildDiscoveryWhere(p, false)
	if !strings.Contains(sql, "AND FALSE") {
		t.Errorf("all-invalid category ids must yield an empty page: %s", sql)
	}
	p = DiscoveryParams{CuisineIDs: []string{"x"}}.normalized()
	sql, _ = buildDiscoveryWhere(p, false)
	if !strings.Contains(sql, "AND FALSE") {
		t.Errorf("all-invalid cuisine ids must yield an empty page: %s", sql)
	}
}

func TestNormalized_DropsNonUUIDIDs(t *testing.T) {
	n := DiscoveryParams{
		CuisineIDs:  []string{"x", "", taxUUID1},
		CategoryIDs: []string{"", "nope"},
	}.normalized()
	if len(n.CuisineIDs) != 1 || n.CuisineIDs[0] != taxUUID1 {
		t.Errorf("CuisineIDs = %v", n.CuisineIDs)
	}
	if len(n.CategoryIDs) != 0 {
		t.Errorf("CategoryIDs = %v", n.CategoryIDs)
	}
}
