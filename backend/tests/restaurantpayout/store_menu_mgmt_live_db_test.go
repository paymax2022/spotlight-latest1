package restaurantpayout_test

// ---------------------------------------------------------------------------
// LIVE-DB tests for merchant self-serve store & menu management (slice 2):
// UpdateRestaurant, SetAvailability, DeleteItem, DeleteCategory. All are
// owner-scoped (assertOwner) — a non-owner must be rejected, and the destructive
// paths must guard (category-with-items blocked, missing rows → not found).
//
// Skips unless TEST_DATABASE_URL/DATABASE_URL is set (same gate as the sibling
// live-DB tests). Reuses seedUser/seedRestaurant + the live service helpers.
// ---------------------------------------------------------------------------

import (
	"context"
	"strings"
	"testing"

	"spotlight/backend/internal/restaurant"
)

func TestLiveDB_StoreAndMenuManagement(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := newLiveRestaurantService(pool, newLiveLedgerService(pool))

	owner := seedUser(t, ctx, pool)
	stranger := seedUser(t, ctx, pool)
	restID := seedRestaurant(t, ctx, pool, owner)

	// ── ListMyRestaurants (owner sees own store; stranger doesn't) ────────────
	mine, err := svc.ListMyRestaurants(ctx, owner)
	if err != nil {
		t.Fatalf("ListMyRestaurants(owner): %v", err)
	}
	foundMine := false
	for _, r := range mine {
		if r.ID == restID {
			foundMine = true
		}
	}
	if !foundMine {
		t.Fatalf("owner's store %s not in ListMyRestaurants", restID)
	}
	othersOnly := true
	strangerStores, _ := svc.ListMyRestaurants(ctx, stranger)
	for _, r := range strangerStores {
		if r.ID == restID {
			othersOnly = false
		}
	}
	if !othersOnly {
		t.Fatal("stranger's ListMyRestaurants leaked the owner's store")
	}

	// ── UpdateRestaurant ──────────────────────────────────────────────────────
	newName, desc := "Blue Yam Kitchen (Updated)", "Now serving jollof"
	r, err := svc.UpdateRestaurant(ctx, restID, owner, restaurant.UpdateRestaurantRequest{Name: &newName, Description: &desc})
	if err != nil {
		t.Fatalf("owner UpdateRestaurant: %v", err)
	}
	if r.Name != newName || r.Description != desc {
		t.Fatalf("update not applied: name=%q desc=%q", r.Name, r.Description)
	}
	// Partial update leaves other fields untouched.
	onlyDesc := "Second edit"
	r, err = svc.UpdateRestaurant(ctx, restID, owner, restaurant.UpdateRestaurantRequest{Description: &onlyDesc})
	if err != nil || r.Name != newName || r.Description != onlyDesc {
		t.Fatalf("partial update: err=%v name=%q desc=%q", err, r.Name, r.Description)
	}
	if _, err := svc.UpdateRestaurant(ctx, restID, stranger, restaurant.UpdateRestaurantRequest{Name: &newName}); err == nil {
		t.Fatal("stranger UpdateRestaurant: want owner error, got nil")
	}
	empty := ""
	if _, err := svc.UpdateRestaurant(ctx, restID, owner, restaurant.UpdateRestaurantRequest{Name: &empty}); err == nil {
		t.Fatal("empty name: want validation error, got nil")
	}

	// ── SetAvailability (operational open/close) ──────────────────────────────
	if r, err = svc.SetAvailability(ctx, restID, owner, true); err != nil || !r.IsOpen {
		t.Fatalf("owner open: err=%v isOpen=%v", err, r != nil && r.IsOpen)
	}
	if r, err = svc.SetAvailability(ctx, restID, owner, false); err != nil || r.IsOpen {
		t.Fatalf("owner close: err=%v isOpen=%v", err, r != nil && r.IsOpen)
	}
	if _, err := svc.SetAvailability(ctx, restID, stranger, true); err == nil {
		t.Fatal("stranger SetAvailability: want owner error, got nil")
	}

	// ── Menu: create then exercise the delete guards ──────────────────────────
	cat, err := svc.CreateCategory(ctx, restID, owner, "Mains")
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	item, err := svc.CreateItem(ctx, restID, owner, restaurant.CreateItemRequest{CategoryID: cat.ID, Name: "Jollof Rice", PriceKobo: 250000})
	if err != nil {
		t.Fatalf("CreateItem: %v", err)
	}

	// A category that still has items cannot be deleted.
	if err := svc.DeleteCategory(ctx, restID, owner, cat.ID); err == nil || !strings.Contains(err.Error(), "remove the category") {
		t.Fatalf("delete non-empty category: want block, got %v", err)
	}
	// A non-owner cannot delete an item.
	if err := svc.DeleteItem(ctx, restID, stranger, item.ID); err == nil {
		t.Fatal("stranger DeleteItem: want owner error, got nil")
	}
	// The owner deletes the item.
	if err := svc.DeleteItem(ctx, restID, owner, item.ID); err != nil {
		t.Fatalf("owner DeleteItem: %v", err)
	}
	// Deleting a now-missing item → not found.
	if err := svc.DeleteItem(ctx, restID, owner, item.ID); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("delete missing item: want not-found, got %v", err)
	}
	// With the category empty, the owner can delete it.
	if err := svc.DeleteCategory(ctx, restID, owner, cat.ID); err != nil {
		t.Fatalf("owner DeleteCategory (empty): %v", err)
	}
}
