package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for review moderation + PII (Phase 16): auto-flag,
// hide-excludes-from-average, public reviews anonymized, and offered-rider address
// masking. Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func modPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB moderation test")
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

// seedDeliveredOrder inserts a delivered order the customer can rate.
func seedDeliveredOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restID, customer string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, idempotency_key, delivery_address)
		VALUES ($1,$2,$3,1000,1000,'delivered',$4,'12b Adeola St, Victoria Island, Lagos')`,
		id, customer, restID, "rate-"+id); err != nil {
		t.Fatalf("seed delivered order: %v", err)
	}
	return id
}

func TestLiveDB_ReviewModeration(t *testing.T) {
	pool := modPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	c1 := uuid.New().String()
	c2 := uuid.New().String()
	for _, u := range []string{owner, c1, c2} {
		_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test")
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, rating) VALUES ($1,$2,'Review Kitchen','1 St',TRUE,5.0)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// c1 leaves a clean 5-star; c2 leaves an abusive 1-star (auto-flagged).
	o1 := seedDeliveredOrder(t, ctx, pool, restID, c1)
	if _, err := svc.RateOrder(ctx, o1, c1, RateOrderRequest{RestaurantStars: 5, Comment: "great jollof"}); err != nil {
		t.Fatalf("rate 1: %v", err)
	}
	o2 := seedDeliveredOrder(t, ctx, pool, restID, c2)
	if _, err := svc.RateOrder(ctx, o2, c2, RateOrderRequest{RestaurantStars: 1, Comment: "total scam do not order"}); err != nil {
		t.Fatalf("rate 2: %v", err)
	}
	var flagged string
	_ = pool.QueryRow(ctx, `SELECT moderation_status FROM restaurant_ratings WHERE order_id=$1`, o2).Scan(&flagged)
	if flagged != "flagged" {
		t.Errorf("abusive review should auto-flag, got %s", flagged)
	}

	// Average currently blends 5 and 1 = 3.0.
	if avg := restaurantRating(t, ctx, pool, restID); avg > 3.01 || avg < 2.99 {
		t.Fatalf("rating with both reviews = %.2f, want ~3.0", avg)
	}
	// Hide the abusive review → average recomputes to just the 5-star.
	var reviewID string
	_ = pool.QueryRow(ctx, `SELECT id FROM restaurant_ratings WHERE order_id=$1`, o2).Scan(&reviewID)
	if err := svc.ModerateReview(ctx, reviewID, "hidden"); err != nil {
		t.Fatalf("moderate: %v", err)
	}
	if avg := restaurantRating(t, ctx, pool, restID); avg < 4.99 {
		t.Errorf("after hiding the 1-star, rating = %.2f, want ~5.0", avg)
	}
	// Public reviews exclude the hidden one and never expose a rater id.
	reviews, err := svc.ListReviews(ctx, restID)
	if err != nil {
		t.Fatalf("list reviews: %v", err)
	}
	if len(reviews) != 1 || reviews[0].Stars != 5 {
		t.Errorf("public reviews should show only the visible 5-star, got %+v", reviews)
	}

	// Offered-rider address masking (SEC-009): a searching order's address is masked in
	// the rider's OFFERS list.
	rider := uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, rider, rider+"@t")
	oid := uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO orders (id, customer_id, restaurant_id, subtotal_kobo, total_kobo, status, dispatch_status, idempotency_key, delivery_address) VALUES ($1,$2,$3,1000,1000,'ready','searching',$4,'12b Adeola St, Victoria Island, Lagos')`,
		oid, c1, restID, "offer-"+oid)
	_, _ = pool.Exec(ctx, `INSERT INTO restaurant_delivery_offers (id, order_id, rider_id, status) VALUES ($1,$2,$3,'offered')`, uuid.New().String(), oid, rider)
	offers, err := svc.RiderOffers(ctx, rider)
	if err != nil {
		t.Fatalf("rider offers: %v", err)
	}
	for _, o := range offers {
		if o.ID == oid && o.DeliveryAddress != "…, Victoria Island, Lagos" {
			t.Errorf("offered address should be masked, got %q", o.DeliveryAddress)
		}
	}
}

func restaurantRating(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restID string) float64 {
	t.Helper()
	var r float64
	if err := pool.QueryRow(ctx, `SELECT rating FROM restaurants WHERE id=$1`, restID).Scan(&r); err != nil {
		t.Fatalf("read rating: %v", err)
	}
	return r
}
