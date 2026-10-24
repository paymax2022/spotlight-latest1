package restaurant

// LIVE-DB integration test for discovery completeness (Phase 13): dish search,
// dietary filter, and saved-address CRUD (default invariant). Skipped unless
// TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func discoveryPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB discovery test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func TestLiveDB_Discovery(t *testing.T) {
	pool := discoveryPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	customer := uuid.New().String()
	for _, u := range []string{owner, customer} {
		_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test")
		testsupport.CleanupUser(t, pool, u)
	}
	// A restaurant whose name doesn't match, but which serves a dish that does.
	uniqueDish := "Zebra" + uuid.New().String()[:8] // unique so the search is deterministic
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, rating) VALUES ($1,$2,'Plain Name Cafe','1 St',TRUE,5.0)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	cat, _ := svc.CreateCategory(ctx, restID, owner, "Mains")
	if _, err := svc.CreateItem(ctx, restID, owner, CreateItemRequest{
		CategoryID: cat.ID, Name: uniqueDish + " Special", PriceKobo: 200000, DietaryTags: []string{"vegan"},
	}); err != nil {
		t.Fatalf("create item: %v", err)
	}

	// Dish search (DS-002): the restaurant surfaces for a menu-item query.
	res, err := svc.SearchRestaurants(ctx, SearchParams{Query: uniqueDish})
	if err != nil {
		t.Fatalf("dish search: %v", err)
	}
	if !hasRestaurant(res, restID) {
		t.Errorf("dish search for %q should surface the restaurant serving it", uniqueDish)
	}

	// Dietary filter (DS-003): matches the vegan item; a made-up tag matches nothing.
	res, err = svc.SearchRestaurants(ctx, SearchParams{Query: uniqueDish, DietaryTags: []string{"vegan"}})
	if err != nil || !hasRestaurant(res, restID) {
		t.Errorf("dietary=vegan should keep the restaurant, err=%v", err)
	}
	res, _ = svc.SearchRestaurants(ctx, SearchParams{Query: uniqueDish, DietaryTags: []string{"carnivore_only_xyz"}})
	if hasRestaurant(res, restID) {
		t.Error("a non-matching dietary tag should exclude the restaurant")
	}

	// Saved addresses (GEO-001/005/006): first is default; adding a default flips it;
	// the one-default invariant holds.
	a1, err := svc.AddAddress(ctx, customer, SavedAddress{Label: "Home", Address: "1 Test Street, Lagos"})
	if err != nil || !a1.IsDefault {
		t.Fatalf("first address should be default: %+v err=%v", a1, err)
	}
	a2, err := svc.AddAddress(ctx, customer, SavedAddress{Label: "Office", Address: "2 Work Road, Lagos", IsDefault: true})
	if err != nil || !a2.IsDefault {
		t.Fatalf("new default address: %+v err=%v", a2, err)
	}
	list, _ := svc.ListAddresses(ctx, customer)
	defaults := 0
	for _, a := range list {
		if a.IsDefault {
			defaults++
		}
	}
	if defaults != 1 {
		t.Fatalf("exactly one default expected, got %d", defaults)
	}
	if list[0].ID != a2.ID {
		t.Error("default (Office) should sort first")
	}
	// Re-point default back to Home.
	if err := svc.SetDefaultAddress(ctx, customer, a1.ID); err != nil {
		t.Fatalf("set default: %v", err)
	}
	// A stranger cannot re-point someone else's address.
	if err := svc.SetDefaultAddress(ctx, owner, a1.ID); err == nil {
		t.Error("a non-owner must not set another user's default")
	}
}

func hasRestaurant(list []Restaurant, id string) bool {
	for _, r := range list {
		if r.ID == id {
			return true
		}
	}
	return false
}

// TestLiveDB_DiscoveryTaxonomyFilters: category_id matches a restaurant through
// an available item's category OR sub-category; a category with no available
// item matches nothing (total == 0); cuisine_id matches via restaurant_cuisines.
func TestLiveDB_DiscoveryTaxonomyFilters(t *testing.T) {
	pool := discoveryPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test")
	testsupport.CleanupUser(t, pool, owner)

	suffix := uuid.New().String()[:8]
	parentID, subID, emptyID, cuisineID := uuid.New().String(), uuid.New().String(), uuid.New().String(), uuid.New().String()
	mustExec := func(q string, a ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, a...); err != nil {
			t.Fatalf("seed: %v (%s)", err, q)
		}
	}
	mustExec(`INSERT INTO restaurant_taxonomy_categories (id,name,slug,kind) VALUES ($1,$2,$3,'FOOD')`, parentID, "Rice "+suffix, "rice-"+suffix)
	mustExec(`INSERT INTO restaurant_taxonomy_categories (id,parent_id,name,slug,kind) VALUES ($1,$2,$3,$4,'FOOD')`, subID, parentID, "Jollof "+suffix, "jollof-"+suffix)
	mustExec(`INSERT INTO restaurant_taxonomy_categories (id,name,slug,kind) VALUES ($1,$2,$3,'FOOD')`, emptyID, "Empty "+suffix, "empty-"+suffix)
	mustExec(`INSERT INTO cuisines (id,name,slug) VALUES ($1,$2,$3)`, cuisineID, "Cu "+suffix, "cu-"+suffix)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM menu_items WHERE taxonomy_category_id = ANY($1::uuid[])`, []string{parentID, emptyID})
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant_cuisines WHERE cuisine_id = $1`, cuisineID)
		_, _ = pool.Exec(ctx, `DELETE FROM cuisines WHERE id = $1`, cuisineID)
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant_taxonomy_categories WHERE id = $1`, subID)
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant_taxonomy_categories WHERE id = ANY($1::uuid[])`, []string{parentID, emptyID})
	})

	withItem, other := uuid.New().String(), uuid.New().String()
	for _, id := range []string{withItem, other} {
		mustExec(`INSERT INTO restaurants (id, owner_id, name, address, is_open, rating) VALUES ($1,$2,'Taxo Cafe','1 St',TRUE,5.0)`, id, owner)
	}
	cat, err := svc.CreateCategory(ctx, withItem, owner, "Mains")
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	item, err := svc.CreateItem(ctx, withItem, owner, CreateItemRequest{CategoryID: cat.ID, Name: "Party " + suffix, PriceKobo: 100000})
	if err != nil {
		t.Fatalf("item: %v", err)
	}
	mustExec(`UPDATE menu_items SET taxonomy_category_id=$1, taxonomy_subcategory_id=$2, is_available=TRUE WHERE id=$3`, parentID, subID, item.ID)
	mustExec(`INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id) VALUES ($1,$2)`, withItem, cuisineID)

	page := func(p DiscoveryParams) *RestaurantPage {
		t.Helper()
		pg, err := svc.ListOpenRestaurantsPage(ctx, p, "")
		if err != nil {
			t.Fatalf("page: %v", err)
		}
		return pg
	}
	for name, id := range map[string]string{"parent": parentID, "sub": subID} {
		pg := page(DiscoveryParams{CategoryIDs: []string{id}})
		if !hasRestaurant(pg.Restaurants, withItem) || hasRestaurant(pg.Restaurants, other) || pg.Total != 1 {
			t.Errorf("category_id (%s) should return only the restaurant with the item; total=%d", name, pg.Total)
		}
	}
	if pg := page(DiscoveryParams{CategoryIDs: []string{emptyID}}); pg.Total != 0 || len(pg.Restaurants) != 0 {
		t.Errorf("empty category should match nothing, total=%d", pg.Total)
	}
	// An unavailable item must not make the restaurant match.
	mustExec(`UPDATE menu_items SET is_available=FALSE WHERE id=$1`, item.ID)
	if pg := page(DiscoveryParams{CategoryIDs: []string{parentID}}); pg.Total != 0 {
		t.Errorf("unavailable item must not match, total=%d", pg.Total)
	}
	if pg := page(DiscoveryParams{CuisineIDs: []string{cuisineID}}); pg.Total != 1 || !hasRestaurant(pg.Restaurants, withItem) {
		t.Errorf("cuisine_id should match via restaurant_cuisines, total=%d", pg.Total)
	}
	// All-invalid ids -> empty page, not an unfiltered one.
	if pg := page(DiscoveryParams{CategoryIDs: []string{"not-a-uuid"}}); pg.Total != 0 {
		t.Errorf("invalid ids must match nothing, total=%d", pg.Total)
	}
}
