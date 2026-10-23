package restaurant

// LIVE-DB test for taxonomy browsing: cuisines on a discovery page and taxonomy
// sections on the menu detail, flag on and off. Skipped unless TEST_DATABASE_URL
// is set (see discoveryPool).

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_TaxonomyBrowse(t *testing.T) {
	pool := discoveryPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	owner := uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test")
	testsupport.CleanupUser(t, pool, owner)

	// Explicitly APPROVED so the page is visible even if moderation is on.
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, rating, listing_review_status)
		VALUES ($1,$2,'Taxonomy Test Kitchen','1 St',TRUE,5.0,'APPROVED')`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	sfx := uuid.New().String()[:8]
	var catMains, catDrinks, cuiActive, cuiInactive string
	ins := func(dst *string, q string, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, q, args...).Scan(dst); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	ins(&catDrinks, `INSERT INTO restaurant_taxonomy_categories (name,slug,kind,sort_order) VALUES ($1,$2,'DRINK',2) RETURNING id::text`, "Drinks "+sfx, "drinks-"+sfx)
	ins(&catMains, `INSERT INTO restaurant_taxonomy_categories (name,slug,kind,sort_order) VALUES ($1,$2,'FOOD',1) RETURNING id::text`, "Mains "+sfx, "mains-"+sfx)
	ins(&cuiActive, `INSERT INTO cuisines (name,slug,sort_order,is_active) VALUES ($1,$2,1,TRUE) RETURNING id::text`, "Nigerian "+sfx, "nigerian-"+sfx)
	ins(&cuiInactive, `INSERT INTO cuisines (name,slug,sort_order,is_active) VALUES ($1,$2,2,FALSE) RETURNING id::text`, "Hidden "+sfx, "hidden-"+sfx)
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM restaurant_cuisines WHERE restaurant_id=$1`, restID)
		_, _ = pool.Exec(c, `DELETE FROM menu_items WHERE restaurant_id=$1`, restID)
		_, _ = pool.Exec(c, `DELETE FROM cuisines WHERE id = ANY($1::uuid[])`, []string{cuiActive, cuiInactive})
		_, _ = pool.Exec(c, `DELETE FROM restaurant_taxonomy_categories WHERE id = ANY($1::uuid[])`, []string{catMains, catDrinks})
	})
	for _, c := range []string{cuiActive, cuiInactive} {
		if _, err := pool.Exec(ctx, `INSERT INTO restaurant_cuisines (restaurant_id,cuisine_id) VALUES ($1,$2)`, restID, c); err != nil {
			t.Fatalf("link cuisine: %v", err)
		}
	}

	svcOff := NewService(pool, nil)
	legacyCat, err := svcOff.CreateCategory(ctx, restID, owner, "Legacy")
	if err != nil {
		t.Fatalf("legacy category: %v", err)
	}
	mk := func(name string) string {
		it, err := svcOff.CreateItem(ctx, restID, owner, CreateItemRequest{CategoryID: legacyCat.ID, Name: name, PriceKobo: 1000})
		if err != nil {
			t.Fatalf("item %s: %v", name, err)
		}
		return it.ID
	}
	jollof, cola, soup, mystery := mk("Jollof"), mk("Cola"), mk("Soup"), mk("Mystery")
	exec := func(q string, a ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, a...); err != nil {
			t.Fatalf("exec: %v", err)
		}
	}
	exec(`UPDATE menu_items SET taxonomy_category_id=$2 WHERE id=$1`, jollof, catMains)
	exec(`UPDATE menu_items SET taxonomy_category_id=$2, is_available=FALSE WHERE id=$1`, cola, catDrinks)
	exec(`UPDATE menu_items SET legacy_category_label='Specials' WHERE id=$1`, soup)
	_ = mystery
	exec(`UPDATE menu_items SET category_id=NULL WHERE id=$1`, mystery)

	svcOn := NewService(pool, nil).WithTaxonomy(true)

	d, err := svcOn.GetRestaurantDetail(ctx, restID)
	if err != nil {
		t.Fatalf("detail on: %v", err)
	}
	var names []string
	for _, s := range d.Sections {
		names = append(names, s.Name)
	}
	want := []string{"Mains " + sfx, "Drinks " + sfx, "Specials", "Other"}
	if len(names) != len(want) {
		t.Fatalf("sections = %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("sections = %v, want %v", names, want)
		}
	}
	if d.Sections[1].Items[0].IsAvailable {
		t.Error("unavailable item must still be listed")
	}
	if d.Sections[2].ID != nil || d.Sections[3].ID != nil {
		t.Error("fallback sections must have nil id")
	}
	if len(d.Restaurant.Cuisines) != 1 || d.Restaurant.Cuisines[0].ID != cuiActive {
		t.Errorf("detail cuisines = %+v, want only the active one", d.Restaurant.Cuisines)
	}

	page, err := svcOn.ListOpenRestaurantsPage(ctx, DiscoveryParams{CuisineIDs: []string{cuiActive}}, "")
	if err != nil {
		t.Fatalf("page on: %v", err)
	}
	found := false
	for _, r := range page.Restaurants {
		if r.ID == restID {
			found = true
			if len(r.Cuisines) != 1 || r.Cuisines[0].Slug != "nigerian-"+sfx {
				t.Errorf("page cuisines = %+v", r.Cuisines)
			}
		}
	}
	if !found {
		t.Fatal("restaurant missing from cuisine-filtered page")
	}

	// Flag off: neither key appears.
	dOff, err := svcOff.GetRestaurantDetail(ctx, restID)
	if err != nil {
		t.Fatalf("detail off: %v", err)
	}
	b, _ := json.Marshal(dOff)
	if strings.Contains(string(b), `"sections"`) || strings.Contains(string(b), `"cuisines"`) {
		t.Errorf("flag off must omit sections and cuisines: %s", b)
	}
	pOff, err := svcOff.ListOpenRestaurantsPage(ctx, DiscoveryParams{CuisineIDs: []string{cuiActive}}, "")
	if err != nil {
		t.Fatalf("page off: %v", err)
	}
	b, _ = json.Marshal(pOff)
	if strings.Contains(string(b), `"cuisines"`) {
		t.Errorf("flag off page must omit cuisines: %s", b)
	}
}
