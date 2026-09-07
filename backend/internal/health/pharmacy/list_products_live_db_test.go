package healthpharmacy_test

// LIVE-DB regressions: pharmacy_products has TWO nullable columns
// (pharmacy_provider_id, nafdac_ref) that were scanned into plain (non-pointer)
// Go strings in both ListProducts (GET /pharmacy/products, the CUSTOMER
// catalogue) and ListProductsForOwner (the owner's own shelf). pgx aborts the
// WHOLE result set on the first bad row, so ONE such row 500ed the catalogue
// for every customer/owner, not just that product. Reproduced live:
//   "can't scan into dest[1] (col: pharmacy_provider_id): cannot scan NULL into *string"
//   "can't scan into dest[4] (col: nafdac_ref): cannot scan NULL into *string"
// (the second only surfaced after fixing the first — pgx stops at the first
// bad column per row, so a single crashing query can hide a second bug behind it).
//
// The query already COALESCEs the adjacent LEFT JOINed hp.display_name for
// exactly this reason; the other two nullable columns were missed. Fixed by
// COALESCE(...,'') to match — pharmacy_provider_id needs an explicit ::text
// cast first (COALESCE(uuid_col, '') makes Postgres try to cast '' TO uuid to
// unify the branch types, which throws "invalid input syntax for type uuid").
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestLiveDB_ListProducts_ToleratesNullPharmacyProviderID(t *testing.T) {
	pool := ownerOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()

	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		// pharmacy_provider_id intentionally omitted/NULL — the exact shape that
		// crashed the live query.
		`INSERT INTO pharmacy_products (id, pharmacy_provider_id, name, category, nafdac_ref, nafdac_status,
		     rx_required, is_controlled, price_kobo, stock_qty, active)
		 VALUES ($1,NULL,'Orphaned Catalogue Item','pain',$2,'REGISTERED',false,false,50000,10,true)`,
		id, "NAF-"+id[:8]); err != nil {
		t.Fatalf("seed product with NULL pharmacy_provider_id: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM pharmacy_products WHERE id=$1`, id)
	})

	svc := newInboxFixture(t, ctx, pool).svc

	got, err := svc.ListProducts(ctx, "", "Orphaned Catalogue Item")
	if err != nil {
		t.Fatalf("ListProducts must not error on a NULL pharmacy_provider_id row: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d products, want 1", len(got))
	}
	if got[0].PharmacyProviderID != "" {
		t.Errorf("PharmacyProviderID = %q, want empty string for a NULL DB value", got[0].PharmacyProviderID)
	}
	if got[0].ID != id {
		t.Errorf("returned product id = %q, want %q", got[0].ID, id)
	}
}

func TestLiveDB_ListProducts_ToleratesNullNAFDACRef(t *testing.T) {
	pool := ownerOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		// nafdac_ref intentionally NULL, even though nafdac_status is REGISTERED —
		// the query's own WHERE clause does not guarantee this column is set, and
		// the DB schema has no NOT NULL constraint on it either.
		`INSERT INTO pharmacy_products (id, pharmacy_provider_id, name, category, nafdac_ref, nafdac_status,
		     rx_required, is_controlled, price_kobo, stock_qty, active)
		 VALUES ($1,$2,'No NAFDAC Ref Yet','pain',NULL,'REGISTERED',false,false,50000,10,true)`,
		id, f.pharmacy); err != nil {
		t.Fatalf("seed product with NULL nafdac_ref: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM pharmacy_products WHERE id=$1`, id)
	})

	got, err := f.svc.ListProducts(ctx, "", "No NAFDAC Ref Yet")
	if err != nil {
		t.Fatalf("ListProducts must not error on a NULL nafdac_ref row: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d products, want 1", len(got))
	}
	if got[0].NAFDACRef != "" {
		t.Errorf("NAFDACRef = %q, want empty string for a NULL DB value", got[0].NAFDACRef)
	}
}

// The owner's own shelf must show what is not yet sellable too (see
// TestLiveDB_OwnerCatalogueIncludesWhatCustomersCannotSee) — a product still
// awaiting NAFDAC verification, which very plausibly has no nafdac_ref yet,
// must not crash that read either.
func TestLiveDB_ListProductsForOwner_ToleratesNullNAFDACRef(t *testing.T) {
	pool := ownerOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO pharmacy_products (id, pharmacy_provider_id, name, category, nafdac_ref, nafdac_status,
		     rx_required, is_controlled, price_kobo, stock_qty, active)
		 VALUES ($1,$2,'Awaiting Verification','pain',NULL,'PENDING',false,false,50000,10,true)`,
		id, f.pharmacy); err != nil {
		t.Fatalf("seed product with NULL nafdac_ref: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM pharmacy_products WHERE id=$1`, id)
	})

	got, err := f.svc.ListProductsForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("ListProductsForOwner must not error on a NULL nafdac_ref row: %v", err)
	}
	found := false
	for _, p := range got {
		if p.ID == id {
			found = true
			if p.NAFDACRef != "" {
				t.Errorf("NAFDACRef = %q, want empty string for a NULL DB value", p.NAFDACRef)
			}
		}
	}
	if !found {
		t.Fatalf("seeded product %s not found in owner's catalogue", id)
	}
}
