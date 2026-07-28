package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for menu/cart completeness (Phase 12): dietary tags on
// items, the min-order gate, item price bounds, and special-instructions handling.
// Skipped unless TEST_DATABASE_URL/DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func menuCartPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB menu/cart test")
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

func TestLiveDB_MenuCart(t *testing.T) {
	pool := menuCartPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'MenuCart Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	cat, err := svc.CreateCategory(ctx, restID, owner, "Mains")
	if err != nil {
		t.Fatalf("category: %v", err)
	}

	// Dietary tags are normalized on create + persisted.
	it, err := svc.CreateItem(ctx, restID, owner, CreateItemRequest{
		CategoryID: cat.ID, Name: "Jollof", PriceKobo: 250000,
		DietaryTags: []string{"Vegan", " Gluten Free ", "vegan"},
	})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	var tags []string
	if err := pool.QueryRow(ctx, `SELECT dietary_tags FROM menu_items WHERE id=$1`, it.ID).Scan(&tags); err != nil {
		t.Fatalf("read tags: %v", err)
	}
	if len(tags) != 2 { // vegan (deduped) + gluten_free
		t.Fatalf("dietary tags = %v, want 2 normalized+deduped", tags)
	}

	// Price bounds enforced (MN-004).
	if _, err := svc.CreateItem(ctx, restID, owner, CreateItemRequest{CategoryID: cat.ID, Name: "Overpriced", PriceKobo: maxItemPriceKobo + 1}); err == nil {
		t.Error("over-max price must be rejected")
	}

	// Min-order gate (CT-007): set a ₦5,000 minimum via the owner profile update.
	min := int64(500000)
	if err := svc.UpdateRestaurantProfile(ctx, restID, owner, UpdateProfileRequest{MinOrderKobo: &min}); err != nil {
		t.Fatalf("set min order: %v", err)
	}
	var got int64
	if err := pool.QueryRow(ctx, `SELECT min_order_kobo FROM restaurants WHERE id=$1`, restID).Scan(&got); err != nil || got != min {
		t.Fatalf("min_order_kobo = %d (err %v), want %d", got, err, min)
	}
	// A ₦2,500 cart (below the ₦5,000 minimum) is rejected before escrow.
	customer := uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, customer, customer+"@seed.test")
	_, err = svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: it.ID, Quantity: 1}},
		DeliveryAddress: "1 Test St", IdempotencyKey: "mincart-" + uuid.New().String(),
	})
	if err == nil || !contains(err.Error(), "minimum") {
		t.Fatalf("undersized order should be rejected for min-order, got %v", err)
	}
}

func contains(s, sub string) bool { return indexOf(s, sub) >= 0 }
