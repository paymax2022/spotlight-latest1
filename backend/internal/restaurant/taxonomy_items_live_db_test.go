package restaurant

// LIVE-DB test for owner items placed in the admin taxonomy: the item is saved and
// mirrored into a visible legacy category, placement is checked, names are unique per
// category, and inactive categories are refused. Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/restaurant/taxonomy"
)

func tiPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB taxonomy item test")
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func tiRestaurant(t *testing.T, db *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	owner := uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO auth.users (id) VALUES ($1)`, owner); err != nil {
		t.Fatalf("owner: %v", err)
	}
	rid := uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address) VALUES ($1,$2,'Item Test Kitchen','1 Test Road')`, rid, owner); err != nil {
		t.Fatalf("restaurant: %v", err)
	}
	return rid
}

func tiTaxonomyID(t *testing.T, db *pgxpool.Pool, slug string) string {
	t.Helper()
	var id string
	if err := db.QueryRow(context.Background(), `SELECT id::text FROM restaurant_taxonomy_categories WHERE slug=$1`, slug).Scan(&id); err != nil {
		t.Fatalf("taxonomy %s: %v", slug, err)
	}
	return id
}

func TestLiveDB_TaxonomyItem_SavedMirroredAndChecked_Integration(t *testing.T) {
	db := tiPool(t)
	ctx := context.Background()
	if _, err := taxonomy.SeedDefaults(ctx, db); err != nil {
		t.Fatal(err)
	}
	rid := tiRestaurant(t, db)
	rice := tiTaxonomyID(t, db, "rice-dishes")
	jollof := tiTaxonomyID(t, db, "jollof-rice")
	desserts := tiTaxonomyID(t, db, "desserts")

	base := CreateTaxonomyItemRequest{Name: "Party Jollof", PriceKobo: 350000, TaxonomyCategoryID: rice, TaxonomySubcategoryID: &jollof}
	it, err := createTaxonomyItem(ctx, db, rid, base)
	if err != nil {
		t.Fatalf("valid item: %v", err)
	}

	// Saved with its taxonomy placement, and mirrored into a visible legacy category.
	var legacyName string
	var taxCat, taxSub string
	if err := db.QueryRow(ctx, `
		SELECT c.name, m.taxonomy_category_id::text, m.taxonomy_subcategory_id::text
		  FROM menu_items m JOIN menu_categories c ON c.id = m.category_id
		 WHERE m.id=$1`, it.ID).Scan(&legacyName, &taxCat, &taxSub); err != nil {
		t.Fatalf("saved row: %v", err)
	}
	if legacyName != "Rice Dishes" || taxCat != rice || taxSub != jollof {
		t.Fatalf("saved as legacy=%q tax=%s sub=%s", legacyName, taxCat, taxSub)
	}

	// A sub-category under the wrong category is refused.
	wrong := CreateTaxonomyItemRequest{Name: "Mismatch", PriceKobo: 1000, TaxonomyCategoryID: desserts, TaxonomySubcategoryID: &jollof}
	if _, err := createTaxonomyItem(ctx, db, rid, wrong); !errors.Is(err, taxonomy.ErrInvalid) {
		t.Fatalf("mismatched sub-category: err = %v, want ErrInvalid", err)
	}

	// The same name in the same category is refused, ignoring case.
	dup := base
	dup.Name = "party JOLLOF"
	dup.TaxonomySubcategoryID = nil
	if _, err := createTaxonomyItem(ctx, db, rid, dup); !errors.Is(err, ErrItemNameTaken) {
		t.Fatalf("duplicate name: err = %v, want ErrItemNameTaken", err)
	}

	// The same name in a different category is fine.
	other := CreateTaxonomyItemRequest{Name: "Party Jollof", PriceKobo: 1000, TaxonomyCategoryID: desserts}
	if _, err := createTaxonomyItem(ctx, db, rid, other); err != nil {
		t.Fatalf("same name, other category: %v", err)
	}

	// An inactive category cannot take new items.
	if _, err := db.Exec(ctx, `UPDATE restaurant_taxonomy_categories SET is_active=false WHERE id=$1`, desserts); err != nil {
		t.Fatal(err)
	}
	inactive := CreateTaxonomyItemRequest{Name: "Late Cake", PriceKobo: 1000, TaxonomyCategoryID: desserts}
	if _, err := createTaxonomyItem(ctx, db, rid, inactive); !errors.Is(err, taxonomy.ErrNotFound) {
		t.Fatalf("inactive category: err = %v, want ErrNotFound", err)
	}
	_, _ = db.Exec(ctx, `UPDATE restaurant_taxonomy_categories SET is_active=true WHERE id=$1`, desserts)
}
