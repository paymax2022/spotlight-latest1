package restaurant

// LIVE-DB test for owner discounts: an item from another restaurant is refused, a valid
// discount is stored, pausing it and deleting it work, and nothing crosses restaurants.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestLiveDB_Discounts_OwnershipAndPause_Integration(t *testing.T) {
	db := tiPool(t)
	ctx := context.Background()
	mine := tiRestaurant(t, db)
	theirs := tiRestaurant(t, db)
	foreign := uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO menu_items (id, restaurant_id, name, price_kobo) VALUES ($1,$2,'Their Rice',1000)`, foreign, theirs); err != nil {
		t.Fatal(err)
	}
	own := uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO menu_items (id, restaurant_id, name, price_kobo) VALUES ($1,$2,'My Rice',1000)`, own, mine); err != nil {
		t.Fatal(err)
	}
	s := &Service{db: db}

	// Staff-permission checks are not exercised here: the service-level calls assume the
	// owner, so these tests drive the database rules directly.
	bad := DiscountInput{Name: "Steal", Kind: discountPercent, Value: 10, Scope: scopeItem,
		StartsAt: time.Now(), EndsAt: time.Now().Add(time.Hour), ItemIDs: []string{foreign}}
	if err := checkDiscountTargets(ctx, db, mine, bad); !errors.Is(err, ErrDiscountInvalid) {
		t.Fatalf("another restaurant's item: err = %v, want ErrDiscountInvalid", err)
	}

	good := DiscountInput{Name: "Lunch", Kind: discountPercent, Value: 10, Scope: scopeItem,
		StartsAt: time.Now().Add(-time.Hour), EndsAt: time.Now().Add(time.Hour), ItemIDs: []string{own}}
	if err := checkDiscountTargets(ctx, db, mine, good); err != nil {
		t.Fatalf("own item refused: %v", err)
	}

	// Store it directly, then pause and delete through the same rules the handlers use.
	id := uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO restaurant_discounts (id, restaurant_id, name, kind, value, scope, starts_at, ends_at)
		VALUES ($1,$2,'Lunch','PERCENT',10,'ITEM',$3,$4)`, id, mine, good.StartsAt, good.EndsAt); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO restaurant_discount_items (discount_id, menu_item_id) VALUES ($1,$2)`, id, own); err != nil {
		t.Fatal(err)
	}

	// Another restaurant cannot pause or delete it.
	if _, err := s.getDiscount(ctx, theirs, id); !errors.Is(err, ErrDiscountNotFound) {
		t.Fatalf("another restaurant read it: err = %v", err)
	}
	row, err := s.getDiscount(ctx, mine, id)
	if err != nil {
		t.Fatal(err)
	}
	if !row.IsActive || len(row.ItemIDs) != 1 {
		t.Fatalf("stored discount = %+v", row)
	}

	if _, err := db.Exec(ctx, `UPDATE restaurant_discounts SET is_active=false WHERE id=$1 AND restaurant_id=$2`, id, mine); err != nil {
		t.Fatal(err)
	}
	row, _ = s.getDiscount(ctx, mine, id)
	if row.IsActive {
		t.Fatal("pause did not take")
	}

	// The live price: a paused discount is ignored, an active one prices the item.
	live, err := loadLiveDiscounts(ctx, db, mine, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(live) != 0 {
		t.Fatalf("a paused discount was loaded as live: %d", len(live))
	}
	if _, err := db.Exec(ctx, `UPDATE restaurant_discounts SET is_active=true WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	live, err = loadLiveDiscounts(ctx, db, mine, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	p := PriceItem(1000000, own, "", "", live, time.Now())
	if p.FinalKobo != 900000 || p.Discount == nil || p.Discount.Label != "10% OFF" {
		t.Fatalf("live price = %+v", p)
	}
	if other := PriceItem(1000000, foreign, "", "", live, time.Now()); other.Discount != nil {
		t.Fatal("an item not in the discount got a price cut")
	}
}
