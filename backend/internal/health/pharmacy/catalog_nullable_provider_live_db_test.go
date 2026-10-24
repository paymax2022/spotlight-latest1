package healthpharmacy_test

// LIVE-DB regression: a catalog product with no owning pharmacy must not take
// the whole catalog down.
// pharmacy_products.pharmacy_provider_id is a NULLABLE uuid while
// Product.PharmacyProviderID is a plain string, so pgx failed the scan with
// "cannot scan NULL into *string" — and because the failure happens per-row
// inside the loop, ONE unowned product returned 500 for the entire list rather
// than omitting itself. All six products in the local database were unowned, so
// the pharmacy catalog was completely unreachable.
//
// The read survives that row today by EXCLUDING it: an unowned product cannot be
// ordered from any pharmacy (priceAndValidateLines matches lines on
// pharmacy_provider_id, and HL-2 needs an approved supplier), so listing it only
// lets a patient build a cart that must fail at pay time. The scan-shape fix
// stands as defence in depth — the COALESCEs still hold for the JOIN'd columns.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/google/uuid"

	healthpharmacy "spotlight/backend/internal/health/pharmacy"
)

func TestLiveDB_ListProducts_ToleratesAProductWithNoPharmacy(t *testing.T) {
	pool := ownerOrdersPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := healthpharmacy.NewService(pool, nil, nil, nil, nil, nil, nil, nil)

	// An unowned product: exactly the shape every row in the local catalog has.
	id := uuid.New().String()
	name := "Nullprovider Test " + id[:8]
	if _, err := pool.Exec(ctx,
		`INSERT INTO pharmacy_products (id, pharmacy_provider_id, name, category, nafdac_ref, nafdac_status,
			rx_required, is_controlled, price_kobo, stock_qty, active)
		 VALUES ($1::uuid, NULL, $2, 'otc', 'NAF-NULLPROV', 'REGISTERED', false, false, 150000, 5, true)`,
		id, name); err != nil {
		t.Fatalf("seed unowned product: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM pharmacy_products WHERE id=$1::uuid`, id)
	})

	products, err := svc.ListProducts(ctx, "", "")
	if err != nil {
		t.Fatalf("ListProducts must not fail because a product has no pharmacy: %v", err)
	}

	for i := range products {
		if products[i].ID == id {
			t.Fatal("an unowned product is in the sellable catalog — no pharmacy can ever order it")
		}
	}

	// The detail endpoint shares the same exclusion, so a stale link reads as
	// absent rather than as a product the patient can add to a cart.
	if _, err := svc.GetProduct(ctx, id); err == nil {
		t.Fatal("GetProduct returned an unowned product, which cannot be ordered")
	}
}
