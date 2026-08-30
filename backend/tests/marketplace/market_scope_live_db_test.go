package marketplace_test

// ---------------------------------------------------------------------------
// LIVE-DB tests for the listing/category market boundary.
//
// Market is this module's tenancy boundary: GET /categories is scoped to one
// market and so is search. Nothing enforced that a listing's category lived in
// the listing's market, so a listing could be reachable from one half of a
// market's UI and invisible to the other. 210 of 229 rows in the local database
// were in exactly that state, seeded by remoderation_live_db_test.go's fixture.
//
// Two layers, tested separately because they fail for different reasons:
//   - the service guard, so the caller gets a field error naming category_id
//   - the composite FK (20270119000000), so nothing reaches the table by any
//     other path — a direct INSERT included
//
// SKIPPED without MARKETPLACE_TEST_DATABASE_URL / TEST_DATABASE_URL:
//   export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/marketplace/... -run MarketScope -v
// ---------------------------------------------------------------------------

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	mkt "spotlight/backend/internal/marketplace"
)

// seedCategoryInMarket inserts an active category in an explicit market and removes
// it afterwards. Registered with t.Cleanup rather than defer: the pool is closed by
// its own Cleanup, and cleanups run last-in-first-out, so a deferred close would
// shut the pool before this delete could run and the row would leak.
func seedCategoryInMarket(t *testing.T, ctx context.Context, pool *pgxpool.Pool, market string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO public.mkt_categories (id, market_id, slug, name, attribute_schema, risk_tier, commission_bps, is_active)
		 VALUES ($1::uuid,$2,'mkt-scope-'||$1::text,'Market Scope Test Cat','{}'::jsonb,0,0,true)`,
		id, market); err != nil {
		t.Fatalf("seed %s category: %v", market, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.mkt_categories WHERE id=$1`, id)
	})
	return id
}

// A category from another market is refused with a field error, not a raw FK
// violation — the caller is told which field is wrong.
func TestMarketScope_CreateListingRejectsForeignMarketCategory(t *testing.T) {
	svc, pool := liveConnectService(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	foreign := seedCategoryInMarket(t, ctx, pool, "KE")

	_, err := svc.CreateListing(ctx, uuid.NewString(), mkt.CreateListingInput{
		CategoryID:  foreign,
		Title:       "A perfectly valid listing title",
		Description: "This description is comfortably longer than the eight word minimum.",
		PriceKobo:   500000,
		State:       "Lagos",
	})
	if err == nil {
		t.Fatal("CreateListing accepted a category from market KE for an NG listing")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "market") {
		t.Errorf("error = %q, want it to explain the market mismatch", err.Error())
	}
}

// The same category still works when it is in the listing's own market — proving
// the guard rejects the mismatch and not merely every seeded category.
func TestMarketScope_CreateListingAcceptsSameMarketCategory(t *testing.T) {
	svc, pool := liveConnectService(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	home := seedCategoryInMarket(t, ctx, pool, "NG")

	l, err := svc.CreateListing(ctx, uuid.NewString(), mkt.CreateListingInput{
		CategoryID:  home,
		Title:       "A perfectly valid listing title",
		Description: "This description is comfortably longer than the eight word minimum.",
		PriceKobo:   500000,
		State:       "Lagos",
	})
	if err != nil {
		t.Fatalf("CreateListing rejected a same-market category: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.mkt_listings WHERE id=$1`, l.ID)
	})
	if l.MarketID != "NG" {
		t.Errorf("listing market = %q, want NG", l.MarketID)
	}
}

// The database refuses the pair regardless of which code path writes it. Without
// this, the rule would hold only for callers that happen to go through the service.
func TestMarketScope_DatabaseRejectsCrossMarketInsert(t *testing.T) {
	_, pool := liveConnectService(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	foreign := seedCategoryInMarket(t, ctx, pool, "KE")

	_, err := pool.Exec(ctx, `
		INSERT INTO public.mkt_listings (id, market_id, seller_id, category_id, title, description, price_kobo, state, status)
		VALUES ($1,'NG',$2,$3,'Direct insert bypassing the service',
		        'This description is comfortably longer than the eight word minimum.',500000,'Lagos','draft')`,
		uuid.NewString(), uuid.NewString(), foreign)
	if err == nil {
		t.Fatal("database accepted an NG listing under a KE category — the composite FK is missing")
	}
	if !strings.Contains(err.Error(), "mkt_listings_category_market_fk") {
		t.Errorf("rejected by %v, want mkt_listings_category_market_fk", err)
	}
}
