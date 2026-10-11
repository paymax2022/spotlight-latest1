package taxonomy_test

// LIVE-DB test for the legacy category backfill: a dry run reports what a real run
// does and writes nothing, unmapped labels reach the review queue, a re-run changes
// nothing, and a remap moves a whole label at once. Skipped unless TEST_DATABASE_URL
// is set.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/restaurant/taxonomy"
)

func taxIDBySlug(t *testing.T, ctx context.Context, svc *taxonomy.Service, slug string) (string, *string) {
	t.Helper()
	tree, err := svc.ListTree(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, top := range tree {
		if top.Slug == slug {
			return top.ID, nil
		}
		for _, sub := range top.Children {
			if sub.Slug == slug {
				id := sub.ID
				return top.ID, &id
			}
		}
	}
	t.Fatalf("taxonomy slug %q not seeded", slug)
	return "", nil
}

func TestLiveDB_Backfill_DryRunMatchesRealRunAndQueuesTheRest_Integration(t *testing.T) {
	db := pool(t)
	ctx := context.Background()
	svc := taxonomy.NewService(db)
	if _, err := taxonomy.SeedDefaults(ctx, db); err != nil {
		t.Fatal(err)
	}

	rid := uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address) VALUES ($1,$2,'Backfill Kitchen','1 Test Road')`, rid, actor(t, db)); err != nil {
		t.Fatal(err)
	}
	legacy := map[string]string{}
	for _, name := range []string{"rice", "Jollof Rice", "Mystery Stuff"} {
		id := uuid.NewString()
		if _, err := db.Exec(ctx, `INSERT INTO menu_categories (id, restaurant_id, name) VALUES ($1,$2,$3)`, id, rid, name); err != nil {
			t.Fatal(err)
		}
		legacy[name] = id
	}
	addItem := func(categoryID *string) {
		if _, err := db.Exec(ctx, `INSERT INTO menu_items (restaurant_id, name, price_kobo, category_id) VALUES ($1,'Item',1000,$2)`, rid, categoryID); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		c := legacy["rice"]
		addItem(&c)
	}
	jj := legacy["Jollof Rice"]
	addItem(&jj)
	for i := 0; i < 2; i++ {
		c := legacy["Mystery Stuff"]
		addItem(&c)
	}
	addItem(nil) // an item that never had a legacy category

	countUnmapped := func() int {
		var n int
		if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM menu_items WHERE restaurant_id=$1 AND taxonomy_category_id IS NULL`, rid).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	before := countUnmapped()
	dry, err := taxonomy.Backfill(ctx, db, true)
	if err != nil {
		t.Fatal(err)
	}
	if countUnmapped() != before {
		t.Fatal("dry run wrote to the database")
	}

	real, err := taxonomy.Backfill(ctx, db, false)
	if err != nil {
		t.Fatal(err)
	}
	if dry.Total != real.Total || dry.Mapped != real.Mapped || dry.Unmapped != real.Unmapped {
		t.Fatalf("dry run and real run disagree: dry=%+v real=%+v", dry, real)
	}

	riceTop, _ := taxIDBySlug(t, ctx, svc, "rice-dishes")
	jollofTop, jollofSub := taxIDBySlug(t, ctx, svc, "jollof-rice")

	// "rice" is a synonym for the top-level category.
	var got string
	if err := db.QueryRow(ctx, `SELECT taxonomy_category_id::text FROM menu_items WHERE restaurant_id=$1 AND taxonomy_category_id=$2 AND taxonomy_subcategory_id IS NULL LIMIT 1`, rid, riceTop).Scan(&got); err != nil {
		t.Fatalf("synonym 'rice' not mapped to rice-dishes: %v", err)
	}
	// "Jollof Rice" matches the sub-category and lands under its parent.
	var subGot string
	if err := db.QueryRow(ctx, `SELECT taxonomy_subcategory_id::text FROM menu_items WHERE restaurant_id=$1 AND taxonomy_category_id=$2 AND taxonomy_subcategory_id=$3`, rid, jollofTop, *jollofSub).Scan(&subGot); err != nil {
		t.Fatalf("Jollof Rice not mapped to its sub-category: %v", err)
	}

	// "Mystery Stuff" keeps its label and joins the queue; the unlabelled item too.
	queue, err := taxonomy.NeedsReview(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, g := range queue {
		counts[g.Label] = g.Items
	}
	if counts["Mystery Stuff"] != 2 || counts["(no category)"] < 1 {
		t.Fatalf("review queue = %+v", queue)
	}

	// A re-run finds nothing new to map.
	again, err := taxonomy.Backfill(ctx, db, false)
	if err != nil {
		t.Fatal(err)
	}
	if again.Mapped != 0 {
		t.Fatalf("re-run mapped %d items; must be a no-op for already-mapped rows", again.Mapped)
	}

	// Remap the whole "Mystery Stuff" label to Desserts in one call.
	desserts, _ := taxIDBySlug(t, ctx, svc, "desserts")
	n, err := taxonomy.RemapLabel(ctx, db, actor(t, db), "Mystery Stuff", desserts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("remap changed %d items, want 2", n)
	}
	queue, _ = taxonomy.NeedsReview(ctx, db)
	for _, g := range queue {
		if g.Label == "Mystery Stuff" {
			t.Fatal("remapped label is still in the review queue")
		}
	}

	// A sub-category must belong to the chosen category.
	_, cakes := taxIDBySlug(t, ctx, svc, "cakes")
	if _, err := taxonomy.RemapLabel(ctx, db, actor(t, db), "(no category)", riceTop, cakes); !errors.Is(err, taxonomy.ErrInvalid) {
		t.Fatalf("mismatched sub-category: err = %v, want ErrInvalid", err)
	}
}
