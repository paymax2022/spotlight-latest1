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
		{Label: "", Address: "1 Test Street"},                      // empty label
		{Label: "Home", Address: "x"},                              // too short
		{Label: "Home", Address: "1 Test Street", Lat: fptr(200)},  // lat out of range
		{Label: "Home", Address: "1 Test Street", Lng: fptr(-999)}, // lng out of range
	}
	for i, a := range bad {
		if err := validateAddress(a); err == nil {
			t.Errorf("case %d should be rejected", i)
		}
	}
}

func fptr(f float64) *float64 { return &f }
