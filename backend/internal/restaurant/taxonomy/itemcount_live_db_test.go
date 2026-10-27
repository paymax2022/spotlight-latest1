package taxonomy_test

// LIVE-DB test: ListTree's aggregated item_count keeps the old per-category
// "category OR subcategory" semantics. Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/restaurant/taxonomy"
)

func flattenCounts(nodes []taxonomy.Node, out map[string]int) {
	for _, n := range nodes {
		out[n.ID] = n.ItemCount
		flattenCounts(n.Children, out)
	}
}

func TestLiveDB_ListTree_ItemCountKeepsOrSemantics_Integration(t *testing.T) {
	db := pool(t)
	ctx := context.Background()
	svc := taxonomy.NewService(db)
	if _, err := taxonomy.SeedDefaults(ctx, db); err != nil {
		t.Fatal(err)
	}

	tree, err := svc.ListTree(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	var top *taxonomy.Node
	for i := range tree {
		if len(tree[i].Children) >= 2 {
			top = &tree[i]
			break
		}
	}
	if top == nil {
		t.Fatal("no seeded category with two subcategories")
	}
	subA, subB := top.Children[0].ID, top.Children[1].ID

	before := map[string]int{}
	flattenCounts(tree, before)

	rid := uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address) VALUES ($1,$2,'Count Kitchen','1 Test Road')`, rid, actor(t, db)); err != nil {
		t.Fatal(err)
	}
	add := func(cat, sub *string) {
		if _, err := db.Exec(ctx, `INSERT INTO menu_items (restaurant_id, name, price_kobo, taxonomy_category_id, taxonomy_subcategory_id) VALUES ($1,'Item',1000,$2,$3)`, rid, cat, sub); err != nil {
			t.Fatal(err)
		}
	}
	add(&top.ID, &subA) // both columns set: +1 top, +1 subA (once each)
	add(&top.ID, &subA) // again
	// Subcategory only: a trigger forbids this through normal writes, but the old
	// OR semantics counted such a row, so bypass triggers (replica role) for it.
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SET LOCAL session_replication_role = replica`); err != nil {
		t.Skipf("cannot bypass triggers: %v", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO menu_items (restaurant_id, name, price_kobo, taxonomy_subcategory_id) VALUES ($1,'Item',1000,$2)`, rid, subB); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	add(&top.ID, nil) // category only: +1 top

	after, err := svc.ListTree(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]int{}
	flattenCounts(after, got)

	if d := got[top.ID] - before[top.ID]; d != 3 {
		t.Errorf("top item_count delta = %d, want 3", d)
	}
	if d := got[subA] - before[subA]; d != 2 {
		t.Errorf("subA item_count delta = %d, want 2", d)
	}
	if d := got[subB] - before[subB]; d != 1 {
		t.Errorf("subB item_count delta = %d, want 1", d)
	}

	// Equivalence with the legacy correlated-subquery semantics for every row.
	rows, err := db.Query(ctx, `SELECT c.id, (SELECT COUNT(*) FROM menu_items m
		WHERE m.taxonomy_category_id = c.id OR m.taxonomy_subcategory_id = c.id)
		FROM restaurant_taxonomy_categories c`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			t.Fatal(err)
		}
		if got[id] != n {
			t.Errorf("category %s: item_count %d, legacy %d", id, got[id], n)
		}
	}
}
