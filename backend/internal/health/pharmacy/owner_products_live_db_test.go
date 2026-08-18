package healthpharmacy_test

// LIVE-DB tests for the pharmacy owner's own catalogue.
//
// The gap: UpsertProduct lets an owner WRITE products, but the only read was
// ListProducts — the CUSTOMER catalogue, filtered to
// `active = true AND nafdac_status = 'REGISTERED'`. So a pharmacist could not see
// their own deactivated lines, or anything still pending NAFDAC verification.
// They could edit inventory but never read it back: a product taken off sale
// vanished from their own view, with no way to price it, restock it or put it
// back.
//
// Managing stock requires seeing ALL of it, including what is not currently
// sellable — that is exactly the part a merchant needs to act on.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func seedProduct(t *testing.T, ctx context.Context, f inboxFixture, pharmacyID, name, nafdacStatus string, active bool, priceKobo int64, stock int) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := f.pool.Exec(ctx,
		// `category` is NOT NULL on this table with no default.
		`INSERT INTO pharmacy_products (id, pharmacy_provider_id, name, category, nafdac_ref, nafdac_status,
		     rx_required, is_controlled, price_kobo, stock_qty, active)
		 VALUES ($1,$2,$3,'pain',$4,$5,false,false,$6,$7,$8)`,
		id, pharmacyID, name, "NAF-"+id[:8], nafdacStatus, priceKobo, stock, active); err != nil {
		t.Fatalf("seed product: %v", err)
	}
	t.Cleanup(func() {
		f.pool.Exec(context.Background(), `DELETE FROM pharmacy_products WHERE id=$1`, id)
	})
	return id
}

func TestLiveDB_OwnerCatalogueIncludesWhatCustomersCannotSee(t *testing.T) {
	pool := ownerOrdersPool(t)
	// t.Cleanup runs AFTER the test function returns, so a `defer pool.Close()`
	// would shut the pool BEFORE the row cleanups fire — and since those Execs
	// ignore their errors, the failure is silent and the fixtures survive.
	// Registered first, so LIFO makes it run last.
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	onSale := seedProduct(t, ctx, f, f.pharmacy, "Paracetamol", "REGISTERED", true, 50_000, 12)
	// Taken off sale — invisible in the customer catalogue, and previously
	// invisible to its own owner, who could then never put it back.
	deactivated := seedProduct(t, ctx, f, f.pharmacy, "Amoxicillin", "REGISTERED", false, 120_000, 0)
	// Awaiting NAFDAC verification — the owner must see it to chase it.
	pending := seedProduct(t, ctx, f, f.pharmacy, "New Syrup", "PENDING", true, 80_000, 5)

	got, err := f.svc.ListProductsForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("ListProductsForOwner: %v", err)
	}

	seen := map[string]bool{}
	for _, p := range got {
		seen[p.ID] = true
	}
	for _, want := range []struct {
		id, why string
	}{
		{onSale, "an on-sale product"},
		{deactivated, "a deactivated product — the owner must be able to put it back"},
		{pending, "a product pending NAFDAC — the owner must be able to chase it"},
	} {
		if !seen[want.id] {
			t.Errorf("catalogue is missing %s", want.why)
		}
	}
}

func TestLiveDB_OwnerCatalogueIsScopedToTheOwner(t *testing.T) {
	pool := ownerOrdersPool(t)
	// t.Cleanup runs AFTER the test function returns, so a `defer pool.Close()`
	// would shut the pool BEFORE the row cleanups fire — and since those Execs
	// ignore their errors, the failure is silent and the fixtures survive.
	// Registered first, so LIFO makes it run last.
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	mine := seedProduct(t, ctx, f, f.pharmacy, "Mine", "REGISTERED", true, 50_000, 3)
	// A rival's stock levels and pricing are commercially sensitive.
	theirs := seedProduct(t, ctx, f, f.rival, "Theirs", "REGISTERED", true, 90_000, 7)

	got, err := f.svc.ListProductsForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("ListProductsForOwner: %v", err)
	}
	var sawMine bool
	for _, p := range got {
		if p.ID == theirs {
			t.Fatal("a rival pharmacy's product appeared — their pricing and stock levels leak")
		}
		if p.ID == mine {
			sawMine = true
		}
	}
	if !sawMine {
		t.Error("the owner's own product is missing")
	}

	// Someone who owns no pharmacy sees nothing, rather than the whole catalogue.
	none, err := f.svc.ListProductsForOwner(ctx, f.patient)
	if err != nil {
		t.Fatalf("ListProductsForOwner(non-owner): %v", err)
	}
	if len(none) != 0 {
		t.Errorf("a non-owner saw %d products, want 0", len(none))
	}
}

func TestLiveDB_OwnerCatalogueCarriesWhatIsNeededToManageIt(t *testing.T) {
	pool := ownerOrdersPool(t)
	// t.Cleanup runs AFTER the test function returns, so a `defer pool.Close()`
	// would shut the pool BEFORE the row cleanups fire — and since those Execs
	// ignore their errors, the failure is silent and the fixtures survive.
	// Registered first, so LIFO makes it run last.
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	id := seedProduct(t, ctx, f, f.pharmacy, "Vitamin C", "REGISTERED", true, 65_000, 9)

	got, err := f.svc.ListProductsForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("ListProductsForOwner: %v", err)
	}
	var p *struct {
		price int64
		stock int
		act   bool
	}
	for _, row := range got {
		if row.ID == id {
			p = &struct {
				price int64
				stock int
				act   bool
			}{row.PriceKobo, row.StockQty, row.Active}
		}
	}
	if p == nil {
		t.Fatal("product not returned")
	}
	// Editing requires the current values to edit FROM.
	if p.price != 65_000 {
		t.Errorf("price = %d, want 65000", p.price)
	}
	if p.stock != 9 {
		t.Errorf("stock = %d, want 9", p.stock)
	}
	if !p.act {
		t.Error("active flag lost — the owner toggles this to take a line off sale")
	}
}
