package healthpharmacy_test

// ---------------------------------------------------------------------------
// LIVE-DB regression: a catalog product with no owning pharmacy must not take
// the whole catalog down.
//
// pharmacy_products.pharmacy_provider_id is a NULLABLE uuid while
// Product.PharmacyProviderID is a plain string, so pgx failed the scan with
// "cannot scan NULL into *string" — and because the failure happens per-row
// inside the loop, ONE unowned product returned 500 for the entire list rather
// than omitting itself. All six products in the local database were unowned, so
// the pharmacy catalog was completely unreachable.
//
// Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

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
		_, _ = pool.Exec(context.Background(), `DELETE FROM pharmacy_products WHERE id=$1::uuid`, id)
	})

	products, err := svc.ListProducts(ctx, "", "")
	if err != nil {
		t.Fatalf("ListProducts must not fail because a product has no pharmacy: %v", err)
	}

	var found *healthpharmacy.Product
	for i := range products {
		if products[i].ID == id {
			found = &products[i]
			break
		}
	}
	if found == nil {
		t.Fatal("the unowned product is missing from the catalog — it should be listed, not dropped")
	}
	if found.PharmacyProviderID != "" {
		t.Errorf("PharmacyProviderID = %q, want empty string for an unowned product", found.PharmacyProviderID)
	}
	// The display name beside it has always coalesced to "" for this case; the id
	// now matches, so "unowned" is signalled the same way in both fields.
	if found.PharmacyName != "" {
		t.Errorf("PharmacyName = %q, want empty string", found.PharmacyName)
	}

	// The detail endpoint shares the query shape and had the identical bug.
	one, err := svc.GetProduct(ctx, id)
	if err != nil {
		t.Fatalf("GetProduct must not fail on an unowned product: %v", err)
	}
	if one.PharmacyProviderID != "" {
		t.Errorf("GetProduct PharmacyProviderID = %q, want empty string", one.PharmacyProviderID)
	}
}
