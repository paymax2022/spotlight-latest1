package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for takeaway packaging on the food-delivery money
// path: restaurants.packaging_fee_kobo must be charged per pack, escrowed with
// the order, persisted on it, and settled 100% to the RESTAURANT
// (settlement.Split.ProviderFeeKobo) — with conservation intact.
//
// Regression guard, and the reason this exists: 20261113000000 gave the per-pack
// price a column, but PlaceOrder had no packaging term at all, so the fee was
// configuration nothing ever read. Checkout meanwhile displayed a "Takeaway
// packaging" line and added it to the total it showed — the customer was shown
// one number and billed another.
//
// Skipped unless TEST_DATABASE_URL/DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

const testPackFeeKobo = 20_000 // ₦200, the platform default

// TestLiveDB_PackagingChargedAndPaidWholeToRestaurant is the end-to-end case:
// three packs are priced, escrowed, persisted, and land in the restaurant's leg
// without the platform or the rider taking a cut.
func TestLiveDB_PackagingChargedAndPaidWholeToRestaurant(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Packaging Kitchen", 450_000)

	if _, err := pool.Exec(ctx,
		`UPDATE restaurants SET packaging_fee_kobo=$2 WHERE id=$1`, f.restID, int64(testPackFeeKobo)); err != nil {
		t.Fatalf("set packaging fee: %v", err)
	}

	const packs = 3
	subtotal := int64(4) * 450_000 // 4 portions, so 3 packs is under the cap
	gross := subtotal + DeliveryFeeKobo
	wantPackaging := int64(packs * testPackFeeKobo) // 60_000
	wantTotal := gross + wantPackaging

	balBefore, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 4}},
		DeliveryAddress: "Victoria Island",
		PackageCount:    packs,
		IdempotencyKey:  "packaging-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}

	if order.PackagingFeeKobo != wantPackaging {
		t.Errorf("returned packaging_fee_kobo = %d, want %d (%d packs × ₦200)", order.PackagingFeeKobo, wantPackaging, packs)
	}
	if order.PackageCount != packs {
		t.Errorf("returned package_count = %d, want %d", order.PackageCount, packs)
	}
	if order.TotalKobo != wantTotal {
		t.Errorf("returned total = %d, want %d (gross %d + packaging %d)", order.TotalKobo, wantTotal, gross, wantPackaging)
	}

	var dbPackaging, dbTotal int64
	var dbPacks int
	if err := pool.QueryRow(ctx,
		`SELECT packaging_fee_kobo, package_count, total_kobo FROM orders WHERE id=$1`, order.ID).
		Scan(&dbPackaging, &dbPacks, &dbTotal); err != nil {
		t.Fatalf("read order row: %v", err)
	}
	if dbPackaging != wantPackaging || dbPacks != packs || dbTotal != wantTotal {
		t.Errorf("persisted (packaging=%d, packs=%d, total=%d), want (%d, %d, %d)",
			dbPackaging, dbPacks, dbTotal, wantPackaging, packs, wantTotal)
	}

	// The customer was actually charged for the packs.
	var debited int64
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE reference=$1 AND type='DEBIT'`,
		"escrow:order:"+order.ID).Scan(&debited); err != nil {
		t.Fatalf("read escrow debit: %v", err)
	}
	if debited != wantTotal {
		t.Errorf("customer debited %d, want %d — packaging must be escrowed with the order", debited, wantTotal)
	}
	balAfter, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if balBefore-balAfter != wantTotal {
		t.Errorf("customer paid %d, want %d", balBefore-balAfter, wantTotal)
	}

	// --- Settlement. ---
	deliverWithRider(t, ctx, f, order.ID)

	wantRider := int64(float64(gross) * splitRiderPct)
	wantPlatform := int64(float64(gross) * splitPlatformPct)
	wantProvider := wantTotal - wantPlatform - wantRider

	gotProvider, gotPlatform, gotRider := legs(t, ctx, pool, order.ID)
	if gotPlatform != wantPlatform {
		t.Errorf("platform leg = %d, want %d — the platform takes no cut of packaging", gotPlatform, wantPlatform)
	}
	if gotRider != wantRider {
		t.Errorf("rider leg = %d, want %d — the rider takes no cut of packaging", gotRider, wantRider)
	}
	if gotProvider != wantProvider {
		t.Errorf("provider leg = %d, want %d", gotProvider, wantProvider)
	}

	// The sharp assertion: the restaurant's leg is what it would have been WITHOUT
	// packaging, plus the WHOLE packaging fee. If packaging had been folded into the
	// gross instead, this is short by 20% of it (₦120).
	noPackagingProvider := gross - wantPlatform - wantRider
	if gotProvider != noPackagingProvider+wantPackaging {
		t.Errorf("provider leg = %d, want %d (its normal share %d + all packaging %d)",
			gotProvider, noPackagingProvider+wantPackaging, noPackagingProvider, wantPackaging)
	}

	if sum := gotProvider + gotPlatform + gotRider; sum != wantTotal {
		t.Errorf("settlement legs sum to %d, want the escrowed total %d", sum, wantTotal)
	}
}

// TestLiveDB_PackagingPackCountIsClampedServerSide proves the client number is
// bounded before it prices anything: a request for 99 packs on a 2-portion order
// is charged as 2, not 99.
func TestLiveDB_PackagingPackCountIsClampedServerSide(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Clamp Kitchen", 300_000)

	if _, err := pool.Exec(ctx,
		`UPDATE restaurants SET packaging_fee_kobo=$2 WHERE id=$1`, f.restID, int64(testPackFeeKobo)); err != nil {
		t.Fatalf("set packaging fee: %v", err)
	}

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 2}},
		DeliveryAddress: "Victoria Island",
		PackageCount:    99,
		IdempotencyKey:  "clamp-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}

	if order.PackageCount != 2 {
		t.Errorf("package_count = %d, want 2 — one pack per portion is the ceiling", order.PackageCount)
	}
	if want := int64(2 * testPackFeeKobo); order.PackagingFeeKobo != want {
		t.Errorf("packaging = %d, want %d — 99 packs must never reach the escrow debit", order.PackagingFeeKobo, want)
	}
}

// TestLiveDB_PackagingOmittedCountStillChargesOnePack: packaging is mandatory, so
// a client that sends no count is charged for one pack rather than nothing.
func TestLiveDB_PackagingOmittedCountStillChargesOnePack(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Default Pack Kitchen", 300_000)

	if _, err := pool.Exec(ctx,
		`UPDATE restaurants SET packaging_fee_kobo=$2 WHERE id=$1`, f.restID, int64(testPackFeeKobo)); err != nil {
		t.Fatalf("set packaging fee: %v", err)
	}

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 2}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "nopacks-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}
	if order.PackageCount != 1 || order.PackagingFeeKobo != testPackFeeKobo {
		t.Errorf("packs=%d packaging=%d, want 1 and %d", order.PackageCount, order.PackagingFeeKobo, testPackFeeKobo)
	}
}

// TestLiveDB_PackagingFreeWhenOwnerSetsZero: the owner sets the price, and 0 is a
// legitimate choice that must cost the customer nothing.
func TestLiveDB_PackagingFreeWhenOwnerSetsZero(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Free Pack Kitchen", 300_000)

	if _, err := pool.Exec(ctx,
		`UPDATE restaurants SET packaging_fee_kobo=0 WHERE id=$1`, f.restID); err != nil {
		t.Fatalf("clear packaging fee: %v", err)
	}

	subtotal := int64(2) * 300_000
	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 2}},
		DeliveryAddress: "Victoria Island",
		PackageCount:    2,
		IdempotencyKey:  "freepack-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}
	if order.PackagingFeeKobo != 0 {
		t.Errorf("packaging = %d, want 0 when the owner charges nothing", order.PackagingFeeKobo)
	}
	if want := subtotal + DeliveryFeeKobo; order.TotalKobo != want {
		t.Errorf("total = %d, want %d — a zero packaging price must add nothing", order.TotalKobo, want)
	}
}

// TestLiveDB_OwnerSetsPackagingPrice: ₦200 is the platform DEFAULT, not a fixed
// rate — the owner sets their own price, and the next order is charged at it.
func TestLiveDB_OwnerSetsPackagingPrice(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Owner Priced Kitchen", 300_000)

	const ownPrice = 35_000 // ₦350 a pack
	if _, err := f.svc.UpdateRestaurant(ctx, f.restID, f.owner, UpdateRestaurantRequest{
		PackagingFeeKobo: ptrInt64(ownPrice),
	}); err != nil {
		t.Fatalf("owner set packaging price: %v", err)
	}

	var stored int64
	if err := pool.QueryRow(ctx, `SELECT packaging_fee_kobo FROM restaurants WHERE id=$1`, f.restID).Scan(&stored); err != nil {
		t.Fatalf("read stored price: %v", err)
	}
	if stored != ownPrice {
		t.Errorf("stored packaging price = %d, want %d", stored, ownPrice)
	}

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 2}},
		DeliveryAddress: "Victoria Island",
		PackageCount:    2,
		IdempotencyKey:  "ownerprice-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}
	if want := int64(2 * ownPrice); order.PackagingFeeKobo != want {
		t.Errorf("packaging = %d, want %d — the order must be priced at the OWNER's rate", order.PackagingFeeKobo, want)
	}
}

// TestLiveDB_PackagingPriceIsOwnerOnly: setting a price is a money decision, so it
// is object-level authorized — not merely route-level.
func TestLiveDB_PackagingPriceIsOwnerOnly(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Guarded Kitchen", 300_000)

	stranger := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		stranger, stranger+"@seed.test"); err != nil {
		t.Fatalf("seed stranger: %v", err)
	}
	if _, err := f.svc.UpdateRestaurant(ctx, f.restID, stranger, UpdateRestaurantRequest{
		PackagingFeeKobo: ptrInt64(999_000),
	}); err == nil {
		t.Fatal("a non-owner must not be able to price another restaurant's packaging")
	}
}

// TestLiveDB_PackagingPriceRejectsNonsense: a negative price would subtract from
// the escrowed total; an absurd one is a data-entry slip that would otherwise be
// charged to real customers.
func TestLiveDB_PackagingPriceRejectsNonsense(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Nonsense Kitchen", 300_000)

	if _, err := f.svc.UpdateRestaurant(ctx, f.restID, f.owner, UpdateRestaurantRequest{
		PackagingFeeKobo: ptrInt64(-1),
	}); err == nil {
		t.Error("expected a negative packaging price to be rejected")
	}
	if _, err := f.svc.UpdateRestaurant(ctx, f.restID, f.owner, UpdateRestaurantRequest{
		PackagingFeeKobo: ptrInt64(maxPackagingFeePerPackKobo + 1),
	}); err == nil {
		t.Error("expected an absurd packaging price to be rejected")
	}
	// The ceiling itself is allowed.
	if _, err := f.svc.UpdateRestaurant(ctx, f.restID, f.owner, UpdateRestaurantRequest{
		PackagingFeeKobo: ptrInt64(maxPackagingFeePerPackKobo),
	}); err != nil {
		t.Errorf("the ceiling must be settable: %v", err)
	}
	// And zero — an owner who does not charge for packaging.
	if _, err := f.svc.UpdateRestaurant(ctx, f.restID, f.owner, UpdateRestaurantRequest{
		PackagingFeeKobo: ptrInt64(0),
	}); err != nil {
		t.Errorf("zero must be settable: %v", err)
	}
	var stored int64
	if err := pool.QueryRow(ctx, `SELECT packaging_fee_kobo FROM restaurants WHERE id=$1`, f.restID).Scan(&stored); err != nil {
		t.Fatalf("read stored price: %v", err)
	}
	if stored != 0 {
		t.Errorf("stored = %d, want 0 — zero must not be swallowed as 'unset'", stored)
	}
}

func ptrInt64(v int64) *int64 { return &v }
