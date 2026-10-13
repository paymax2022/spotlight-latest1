package restaurant

// LIVE-DB test for per-item prep time: an item's own override wins, and an item
// without one follows the restaurant's default. Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"spotlight/backend/internal/restaurant/taxonomy"
)

func TestLiveDB_ItemPrepTime_OverrideOrRestaurantDefault_Integration(t *testing.T) {
	db := tiPool(t)
	ctx := context.Background()
	if _, err := taxonomy.SeedDefaults(ctx, db); err != nil {
		t.Fatal(err)
	}
	rid := tiRestaurant(t, db)
	if _, err := db.Exec(ctx, `UPDATE restaurants SET prep_time_minutes=40 WHERE id=$1`, rid); err != nil {
		t.Fatal(err)
	}
	rice := tiTaxonomyID(t, db, "rice-dishes")

	override := 25
	withOverride, err := createTaxonomyItem(ctx, db, rid, CreateTaxonomyItemRequest{
		Name: "Quick Jollof", PriceKobo: 100000, TaxonomyCategoryID: rice, PrepTimeMinutes: &override,
	})
	if err != nil {
		t.Fatal(err)
	}
	plain, err := createTaxonomyItem(ctx, db, rid, CreateTaxonomyItemRequest{
		Name: "Slow Stew", PriceKobo: 100000, TaxonomyCategoryID: rice,
	})
	if err != nil {
		t.Fatal(err)
	}

	read := func(id string) (int, *int) {
		t.Helper()
		var (
			itemID, restID, name, desc string
			catID, img                 *string
			price                      int64
			avail                      bool
			tags                       []string
			override                   *int
			prep                       int
		)
		row := db.QueryRow(ctx, `SELECT `+menuItemCols+` FROM menu_items WHERE id=$1`, id)
		if err := row.Scan(&itemID, &catID, &restID, &name, &desc, &price, &img, &avail, &tags, &override, &prep); err != nil {
			t.Fatalf("read %s: %v", id, err)
		}
		return prep, override
	}

	if prep, over := read(withOverride.ID); prep != 25 || over == nil || *over != 25 {
		t.Fatalf("override item: prep=%d override=%v, want 25 and 25", prep, over)
	}
	if prep, over := read(plain.ID); prep != 40 || over != nil {
		t.Fatalf("plain item: prep=%d override=%v, want the restaurant default 40 and no override", prep, over)
	}
}
