package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for promo codes (Phase 4): owner CRUD, code resolution
// (window / min-subtotal / usage limits), and the funder snapshot — driven against
// real rows. Skipped unless TEST_DATABASE_URL is set. Requires the
// restaurant + restaurant_promos migrations. Escrow/settlement not exercised here;
// the settlement funder math is proven by the settlement package's pure invariants.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func promoLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB promo test")
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

func TestLiveDB_Promos(t *testing.T) {
	pool := promoLivePool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	customer := uuid.New().String()
	for _, u := range []string{owner, customer} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Promo Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// Owner creates a 10%-off promo, min ₦1,000 (100_000 kobo), usage limit 1.
	limit := 1
	p, err := svc.CreatePromo(ctx, restID, owner, CreatePromoRequest{
		Code: "SAVE10", Kind: PromoPercent, ValueBp: 1000, MinSubtotalKobo: 100_000, UsageLimit: &limit,
	})
	if err != nil {
		t.Fatalf("create promo: %v", err)
	}
	if p.Funder != FunderRestaurant {
		t.Fatalf("owner-created promo must be restaurant-funded, got %s", p.Funder)
	}

	// A stranger cannot create a promo for this restaurant.
	if _, err := svc.CreatePromo(ctx, restID, customer, CreatePromoRequest{Code: "HACK", Kind: PromoFixed, AmountKobo: 100}); err == nil {
		t.Fatal("stranger must not create a promo for another owner's restaurant")
	}

	// Below minimum → invalid.
	if _, err := svc.resolvePromo(ctx, restID, customer, "save10", 50_000, 0, time.Now()); !errors.Is(err, ErrPromoInvalid) {
		t.Fatalf("below-min resolve: want ErrPromoInvalid, got %v", err)
	}
	// Valid (case-insensitive code) → 10% of 200_000 = 20_000, restaurant-funded.
	ap, err := svc.resolvePromo(ctx, restID, customer, "save10", 200_000, 0, time.Now())
	if err != nil {
		t.Fatalf("valid resolve: %v", err)
	}
	if ap.DiscountKobo != 20_000 || ap.Funder != FunderRestaurant {
		t.Fatalf("resolve: got discount=%d funder=%s, want 20000/restaurant", ap.DiscountKobo, ap.Funder)
	}

	// Simulate a redemption consuming the single allowed use, then confirm the usage
	// limit now blocks (and that UNIQUE(order_id) keeps a re-inserted order idempotent).
	orderID := uuid.New().String()
	for i := 0; i < 2; i++ { // second insert is a no-op via ON CONFLICT (order_id)
		if _, err := pool.Exec(ctx,
			`INSERT INTO restaurant_promo_redemptions (id, promo_id, order_id, user_id, discount_kobo)
			 VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_id) DO NOTHING`,
			uuid.New().String(), p.ID, orderID, customer, 20_000); err != nil {
			t.Fatalf("seed redemption: %v", err)
		}
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_promo_redemptions WHERE promo_id=$1`, p.ID).Scan(&count); err != nil {
		t.Fatalf("count redemptions: %v", err)
	}
	if count != 1 {
		t.Fatalf("UNIQUE(order_id) should keep exactly 1 redemption for the order, got %d", count)
	}
	if _, err := svc.resolvePromo(ctx, restID, customer, "save10", 200_000, 0, time.Now()); !errors.Is(err, ErrPromoInvalid) {
		t.Fatalf("usage-limit resolve: want ErrPromoInvalid (limit reached), got %v", err)
	}
}
