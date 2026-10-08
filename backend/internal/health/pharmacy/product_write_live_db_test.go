package healthpharmacy_test

// LIVE-DB regression for E2E-HLT-001: POST /products (Service.UpsertProduct)
// must populate pharmacy_products.category — the column is
// `TEXT NOT NULL CHECK (category IN ('pain','vitamins','first_aid','baby',
// 'skincare','devices','prescription','otc'))` with no default (created by
// 20260617000000_health_premium.sql, predating this module), so omitting it is
// a 23502 violation. It cannot be left NULL: the legacy pharmacy reader
// (internal/pharmacy/service.go) still SELECTs category into a non-nullable Go
// string. The write derives it from rx_required → 'prescription' | 'otc'.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	healthpharmacy "spotlight/backend/internal/health/pharmacy"
)

func TestLiveDB_UpsertProduct_WritesThroughTheRealInsertPath(t *testing.T) {
	pool := ownerOrdersPool(t)
	// Registered first: LIFO runs the pool close AFTER the fixture row cleanups.
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	// The real service write — no seed SQL. Before the fix this returned
	// `pharmacy: upsert product: ... null value in column "category"`.
	p, err := f.svc.UpsertProduct(ctx, f.owner, healthpharmacy.Product{
		PharmacyProviderID: f.pharmacy,
		Name:               "WritePath Paracetamol 500mg",
		NAFDACRef:          "NAF-WRITE-1",
		PriceKobo:          50_000,
		StockQty:           7,
		Active:             true,
	})
	if err != nil {
		t.Fatalf("UpsertProduct through the real INSERT: %v", err)
	}
	if p.ID == "" {
		t.Fatal("no product id returned")
	}

	// The legacy column must be populated with an enum-legal value — the legacy
	// reader scans it into a non-nullable string, so NULL would break THAT
	// module instead. A non-POM product is 'otc'.
	var cat string
	if err := pool.QueryRow(ctx, `SELECT category FROM pharmacy_products WHERE id=$1`, p.ID).Scan(&cat); err != nil {
		t.Fatalf("read category: %v", err)
	}
	if cat != "otc" {
		t.Errorf("category = %q, want 'otc' for a non-Rx product", cat)
	}

	// An Rx-required product maps to the legacy 'prescription' category.
	rx, err := f.svc.UpsertProduct(ctx, f.owner, healthpharmacy.Product{
		PharmacyProviderID: f.pharmacy,
		Name:               "WritePath Amoxicillin 250mg",
		NAFDACRef:          "NAF-WRITE-2",
		RxRequired:         true,
		PriceKobo:          80_000,
		StockQty:           3,
		Active:             true,
	})
	if err != nil {
		t.Fatalf("UpsertProduct (rx_required): %v", err)
	}
	var catRx string
	if err := pool.QueryRow(ctx, `SELECT category FROM pharmacy_products WHERE id=$1`, rx.ID).Scan(&catRx); err != nil {
		t.Fatalf("read rx category: %v", err)
	}
	if catRx != "prescription" {
		t.Errorf("category = %q, want 'prescription' for an Rx-required product", catRx)
	}

	// The ON CONFLICT update leg is the same INSERT — restock/edit must not
	// regress to a missing category either.
	if _, err := f.svc.UpsertProduct(ctx, f.owner, healthpharmacy.Product{
		ID:                 p.ID,
		PharmacyProviderID: f.pharmacy,
		Name:               "WritePath Paracetamol 750mg",
		NAFDACRef:          "NAF-WRITE-1",
		PriceKobo:          55_000,
		StockQty:           20,
		Active:             true,
	}); err != nil {
		t.Fatalf("UpsertProduct update leg: %v", err)
	}
	var name string
	var stock int
	if err := pool.QueryRow(ctx, `SELECT name, stock_qty FROM pharmacy_products WHERE id=$1`, p.ID).Scan(&name, &stock); err != nil {
		t.Fatalf("read after update: %v", err)
	}
	if name != "WritePath Paracetamol 750mg" || stock != 20 {
		t.Errorf("update leg did not apply: name=%q stock=%d", name, stock)
	}
}
