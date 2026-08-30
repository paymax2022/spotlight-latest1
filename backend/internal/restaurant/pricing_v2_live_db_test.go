package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for pricing v2 (Phase 10): the free-delivery promo
// (discount == the delivery fee) and the platform pricing-config setter
// (service_fee_bp / surge_bp). Skipped unless TEST_DATABASE_URL is set.
// The settlement money legs (service fee → platform, surge in gross) are proven by
// the settlement package's pure conservation tests.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func pricingV2LivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB pricing v2 test")
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

func TestLiveDB_PricingV2(t *testing.T) {
	pool := pricingV2LivePool(t)
	t.Cleanup(pool.Close)
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
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Pricing Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// Platform pricing config: 5% service fee, 1.5x surge. Range-guarded.
	if err := svc.SetPricingConfig(ctx, restID, PricingConfig{ServiceFeeBp: 500, SurgeBp: 15000}); err != nil {
		t.Fatalf("set pricing config: %v", err)
	}
	if err := svc.SetPricingConfig(ctx, restID, PricingConfig{ServiceFeeBp: 20000}); err == nil {
		t.Fatal("out-of-range service_fee_bp should be rejected")
	}
	var feeBp, surgeBp int
	if err := pool.QueryRow(ctx, `SELECT service_fee_bp, surge_bp FROM restaurants WHERE id=$1`, restID).Scan(&feeBp, &surgeBp); err != nil {
		t.Fatalf("read config: %v", err)
	}
	if feeBp != 500 || surgeBp != 15000 {
		t.Fatalf("config not persisted: fee=%d surge=%d", feeBp, surgeBp)
	}

	// A free-delivery promo resolves to a discount equal to the delivery fee.
	if _, err := svc.CreatePromo(ctx, restID, owner, CreatePromoRequest{Code: "FREESHIP", Kind: PromoFreeDelivery, MinSubtotalKobo: 100_000}); err != nil {
		t.Fatalf("create free-delivery promo: %v", err)
	}
	const delivery = 50_000
	ap, err := svc.resolvePromo(ctx, restID, customer, "freeship", 200_000, delivery, time.Now())
	if err != nil {
		t.Fatalf("resolve free-delivery: %v", err)
	}
	if ap.DiscountKobo != delivery {
		t.Fatalf("free-delivery discount = %d, want the delivery fee %d", ap.DiscountKobo, delivery)
	}
	// Below the promo minimum → rejected (no discount).
	if _, err := svc.resolvePromo(ctx, restID, customer, "freeship", 50_000, delivery, time.Now()); err == nil {
		t.Fatal("free-delivery below min should be rejected")
	}
}
