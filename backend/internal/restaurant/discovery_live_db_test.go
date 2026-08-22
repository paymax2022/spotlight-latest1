package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for discovery completeness (Phase 13): dish search,
// dietary filter, and saved-address CRUD (default invariant). Skipped unless
// TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
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
	defer pool.Close()
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	customer := uuid.New().String()
	for _, u := range []string{owner, customer} {
		_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test")
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
