package marketplace

// LIVE-DB tests for RecategorizeListing: a reviewer moving a listing that is
// awaiting approval into the category/sub-category it belongs in.
// Gated on TEST_DATABASE_URL via boostTestPool (service_boost_live_db_test.go).
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/marketplace/... -run TestLiveDBRecategorize -v
//
// mkt_admin_audit_log is append-only, so the audit rows these tests produce are
// permanent residue by design; every other row is cleaned up.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func seedRecatCategory(t *testing.T, pool *pgxpool.Pool, parentID *string, name string, active bool, schema string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO mkt_categories (id, market_id, parent_id, slug, name, is_active, attribute_schema)
		 VALUES ($1,'NG',$2,$3,$4,$5,$6::jsonb)`,
		id, parentID, "recat-"+id, name, active, schema); err != nil {
		t.Fatalf("seed category %q: %v", name, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM mkt_categories WHERE id=$1`, id)
	})
	return id
}

func seedRecatListing(t *testing.T, pool *pgxpool.Pool, sellerID, categoryID, status, condition string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO mkt_listings
			(id, market_id, seller_id, category_id, title, description, price_kobo, currency,
			 condition, status, escrow_eligible, state, attrs)
		VALUES ($1,'NG',$2,$3,'Recategorize Test Listing','A perfectly ordinary listing description with eight whole words',
		        1000000,'NGN',$5,$4::listing_status,true,'Lagos','{}'::jsonb)`,
		id, sellerID, categoryID, status, condition); err != nil {
		t.Fatalf("seed listing: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM mkt_listings WHERE id=$1`, id)
	})
	return id
}

func recatCategoryOf(t *testing.T, pool *pgxpool.Pool, listingID string) string {
	t.Helper()
	var cid string
	if err := pool.QueryRow(context.Background(), `SELECT category_id FROM mkt_listings WHERE id=$1`, listingID).Scan(&cid); err != nil {
		t.Fatalf("read listing category: %v", err)
	}
	return cid
}

func recatAuditCount(t *testing.T, pool *pgxpool.Pool, listingID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM mkt_admin_audit_log WHERE target_id=$1 AND action='mkt.listing.recategorize'`, listingID).Scan(&n); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	return n
}

func wantFieldErr(t *testing.T, err error, field string) {
	t.Helper()
	var ce *CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("want a coded error for %q, got %v", field, err)
	}
	if ce.Status != http.StatusUnprocessableEntity && ce.Status != http.StatusBadRequest {
		t.Fatalf("want a 4xx validation error for %q, got status %d (%v)", field, ce.Status, err)
	}
}

func TestLiveDBRecategorizeMovesPendingListingAndAudits(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, _ := newBoostTestService(pool)
	seller := seedBoostSeller(t, ctx, pool, 3)
	admin := seedBoostSeller(t, ctx, pool, 3)

	mainA := seedRecatCategory(t, pool, nil, "Recat Main A", true, `{}`)
	subA := seedRecatCategory(t, pool, &mainA, "Recat Sub A", true, `{}`)
	mainB := seedRecatCategory(t, pool, nil, "Recat Main B", true, `{}`)
	subB := seedRecatCategory(t, pool, &mainB, "Recat Sub B", true, `{}`)
	listing := seedRecatListing(t, pool, seller, subA, "pending_review", "used")

	got, err := svc.RecategorizeListing(ctx, admin, listing, subB, "wrong_category")
	if err != nil {
		t.Fatalf("recategorize: %v", err)
	}
	if got.CategoryID != subB {
		t.Fatalf("returned listing category = %s, want %s", got.CategoryID, subB)
	}
	if now := recatCategoryOf(t, pool, listing); now != subB {
		t.Fatalf("persisted category = %s, want %s", now, subB)
	}
	var status string
	_ = pool.QueryRow(ctx, `SELECT status::text FROM mkt_listings WHERE id=$1`, listing).Scan(&status)
	if status != "pending_review" {
		t.Fatalf("a re-categorise must not change status; got %s", status)
	}

	// The audit row carries the real before/after, with the Main › Sub path.
	var before, after []byte
	var reason string
	if err := pool.QueryRow(ctx,
		`SELECT reason_code, before_state, after_state FROM mkt_admin_audit_log
		 WHERE target_id=$1 AND action='mkt.listing.recategorize'`, listing).Scan(&reason, &before, &after); err != nil {
		t.Fatalf("read audit row: %v", err)
	}
	var b, a map[string]any
	_ = json.Unmarshal(before, &b)
	_ = json.Unmarshal(after, &a)
	if reason != "wrong_category" || b["category_id"] != subA || a["category_id"] != subB ||
		b["category_path"] != "Recat Main A › Recat Sub A" || a["category_path"] != "Recat Main B › Recat Sub B" {
		t.Fatalf("audit row wrong: reason=%q before=%v after=%v", reason, b, a)
	}

	// Same category again is a no-op: unchanged, and no second audit row.
	if _, err := svc.RecategorizeListing(ctx, admin, listing, subB, ""); err != nil {
		t.Fatalf("no-op recategorize: %v", err)
	}
	if n := recatAuditCount(t, pool, listing); n != 1 {
		t.Fatalf("audit rows = %d, want exactly 1 (no-op must not audit)", n)
	}
}

func TestLiveDBRecategorizeRefusals(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, _ := newBoostTestService(pool)
	seller := seedBoostSeller(t, ctx, pool, 3)
	admin := seedBoostSeller(t, ctx, pool, 3)

	home := seedRecatCategory(t, pool, nil, "Recat Home", true, `{}`)
	inactive := seedRecatCategory(t, pool, nil, "Recat Inactive", false, `{}`)
	// The vehicle rule keys on the real 'vehicles' root slug, so the Tokunbo cases use
	// the seeded NG Vehicles category rather than a lookalike.
	var vehicles string
	if err := pool.QueryRow(ctx, `SELECT id FROM mkt_categories WHERE market_id='NG' AND slug='vehicles' AND parent_id IS NULL`).Scan(&vehicles); err != nil {
		t.Skipf("seeded NG Vehicles root category not present: %v", err)
	}
	vehicleSub := seedRecatCategory(t, pool, &vehicles, "Recat Vehicle Sub", true, `{}`)

	assertUnmoved := func(listing string) {
		t.Helper()
		if now := recatCategoryOf(t, pool, listing); now != home {
			t.Fatalf("a refused move must leave the category alone; now %s, want %s", now, home)
		}
		if n := recatAuditCount(t, pool, listing); n != 0 {
			t.Fatalf("a refused move must not write an audit row; got %d", n)
		}
	}

	pending := seedRecatListing(t, pool, seller, home, "pending_review", "used")

	if _, err := svc.RecategorizeListing(ctx, admin, pending, inactive, ""); err == nil {
		t.Fatal("moving into an inactive category must be refused")
	} else {
		wantFieldErr(t, err, "category_id")
	}
	assertUnmoved(pending)

	if _, err := svc.RecategorizeListing(ctx, admin, pending, uuid.New().String(), ""); err == nil {
		t.Fatal("moving into an unknown category must be refused")
	} else {
		wantFieldErr(t, err, "category_id")
	}
	assertUnmoved(pending)

	if _, err := svc.RecategorizeListing(ctx, admin, pending, "", ""); err == nil {
		t.Fatal("a blank category_id must be refused")
	}
	assertUnmoved(pending)

	// A Tokunbo listing may not leave the Vehicles tree.
	tokunbo := seedRecatListing(t, pool, seller, vehicles, "pending_review", "foreign_used")
	if _, err := svc.RecategorizeListing(ctx, admin, tokunbo, home, ""); err == nil {
		t.Fatal("a foreign_used listing must not be moved out of Vehicles into a non-vehicle category")
	} else {
		wantFieldErr(t, err, "condition")
	}
	if now := recatCategoryOf(t, pool, tokunbo); now != vehicles {
		t.Fatalf("refused vehicle move changed the category to %s", now)
	}

	// ...but moving within the Vehicles tree is fine.
	if got, err := svc.RecategorizeListing(ctx, admin, tokunbo, vehicleSub, ""); err != nil {
		t.Fatalf("a foreign_used listing moved inside Vehicles must be allowed: %v", err)
	} else if got.CategoryID != vehicleSub {
		t.Fatalf("category = %s, want %s", got.CategoryID, vehicleSub)
	}

	// Only listings awaiting review can be moved.
	for _, st := range []string{"active", "removed_policy", "draft"} {
		other := seedRecatCategory(t, pool, nil, "Recat Other "+st, true, `{}`)
		l := seedRecatListing(t, pool, seller, home, st, "used")
		_, err := svc.RecategorizeListing(ctx, admin, l, other, "")
		var ce *CodedError
		if !errors.As(err, &ce) || ce.Status != http.StatusConflict {
			t.Fatalf("a %s listing must be refused with 409, got %v", st, err)
		}
		if now := recatCategoryOf(t, pool, l); now != home {
			t.Fatalf("a %s listing was re-filed to %s", st, now)
		}
	}
}

// A mis-filed listing carries the wrong category's attributes. The move must not be
// blocked by them: it keeps what the new schema accepts, drops what it would reject,
// and the audit row records the dropped keys and the required ones still missing.
func TestLiveDBRecategorizeReconcilesAttrsInsteadOfBlocking(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	svc, _ := newBoostTestService(pool)
	seller := seedBoostSeller(t, ctx, pool, 3)
	admin := seedBoostSeller(t, ctx, pool, 3)

	// Closed schema: `brand` (string, required) and `size` (number). Anything else is rejected.
	target := seedRecatCategory(t, pool, nil, "Recat Closed Schema", true,
		`{"required":["brand"],"additionalProperties":false,"properties":{"brand":{"type":"string"},"size":{"type":"number"}}}`)
	src := seedRecatCategory(t, pool, nil, "Recat Attr Source", true, `{}`)
	listing := seedRecatListing(t, pool, seller, src, "pending_review", "used")
	// Carries: body_type (undeclared -> dropped), size="big" (wrong type -> dropped).
	if _, err := pool.Exec(ctx, `UPDATE mkt_listings SET attrs=$2::jsonb WHERE id=$1`, listing,
		`{"body_type":"suv","size":"big","extra":null}`); err != nil {
		t.Fatalf("seed attrs: %v", err)
	}

	got, err := svc.RecategorizeListing(ctx, admin, listing, target, "")
	if err != nil {
		t.Fatalf("a move whose attrs do not fit must still succeed: %v", err)
	}
	if got.CategoryID != target {
		t.Fatalf("category = %s, want %s", got.CategoryID, target)
	}

	var attrsRaw, afterRaw []byte
	if err := pool.QueryRow(ctx, `SELECT attrs FROM mkt_listings WHERE id=$1`, listing).Scan(&attrsRaw); err != nil {
		t.Fatalf("read attrs: %v", err)
	}
	var attrs map[string]any
	_ = json.Unmarshal(attrsRaw, &attrs)
	if len(attrs) != 0 {
		t.Fatalf("persisted attrs = %v, want {} (both seller attrs were incompatible)", attrs)
	}

	if err := pool.QueryRow(ctx,
		`SELECT after_state FROM mkt_admin_audit_log WHERE target_id=$1 AND action='mkt.listing.recategorize'`, listing).Scan(&afterRaw); err != nil {
		t.Fatalf("read audit: %v", err)
	}
	var after struct {
		Dropped []string `json:"dropped_attrs"`
		Missing []string `json:"missing_required"`
	}
	_ = json.Unmarshal(afterRaw, &after)
	if len(after.Dropped) != 2 || after.Dropped[0] != "body_type" || after.Dropped[1] != "size" {
		t.Fatalf("audit dropped_attrs = %v, want [body_type size]", after.Dropped)
	}
	if len(after.Missing) != 1 || after.Missing[0] != "brand" {
		t.Fatalf("audit missing_required = %v, want [brand]", after.Missing)
	}
}
