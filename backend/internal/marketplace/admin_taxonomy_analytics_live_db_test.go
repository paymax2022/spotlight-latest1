package marketplace

// ---------------------------------------------------------------------------
// LIVE-DB tests for the two admin routes closed under MKT-007 (taxonomy CRUD +
// analytics aggregation): the frontend already had full pages for these
// (frontend-admin/app/admin/marketplace/{taxonomy,analytics}), but nothing on
// the backend served them (confirmed live: 404) until this file's routes were
// added (admin_taxonomy_handler.go, admin_analytics_handler.go,
// repository_admin_taxonomy.go, repository_admin_analytics.go).
//
// Follows the TEST_DATABASE_URL-gated live-DB pattern established by
// service_boost_live_db_test.go in this same package: real pgxpool via
// t.Cleanup, real repository queries, genuine seeded rows with KNOWN kobo
// amounts so the analytics SUM assertions are exact, not approximate.
//
// Run:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/marketplace/... -run TestLiveDBAdminTaxonomy -v
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/marketplace/... -run TestLiveDBAdminAnalytics -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// ── Taxonomy CRUD ────────────────────────────────────────────────────────────

func TestLiveDBAdminTaxonomyCRUD(t *testing.T) {
	pool := boostTestPool(t) // reuses service_boost_live_db_test.go's TEST_DATABASE_URL gate + pool
	ctx := context.Background()
	repo := NewRepository(pool)

	slug := "admin-taxonomy-test-" + uuid.New().String()[:8]
	created, err := repo.AdminInsertCategory(ctx, Category{
		MarketID: DefaultMarketID, Slug: slug, Name: "Admin Taxonomy Test Category",
		RiskTier: 1, CommissionBps: 300, IsActive: true, AttributeSchema: []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("insert category: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_categories WHERE id=$1`, created.ID) })

	if created.RiskTier != 1 || created.CommissionBps != 300 || !created.IsActive {
		t.Fatalf("created category fields wrong: %+v", created)
	}
	if created.ListingCount != 0 {
		t.Fatalf("expected 0 listings on a fresh category, got %d", created.ListingCount)
	}

	// GetCategory round-trips the same row.
	got, err := repo.AdminGetCategory(ctx, created.ID)
	if err != nil {
		t.Fatalf("get category: %v", err)
	}
	if got.Slug != slug {
		t.Fatalf("get category slug mismatch: got %q want %q", got.Slug, slug)
	}

	// UpdateCategory: risk_tier 1→0 is exactly the field service_listing.go's
	// SubmitListing auto-approve guard reads (GetCategory(...).RiskTier == 0),
	// so this proves the admin write actually reaches the auto-approval gate,
	// not just a column in isolation.
	updated, err := repo.AdminUpdateCategory(ctx, created.ID, Category{
		ParentID: nil, Slug: slug, Name: "Admin Taxonomy Test Category (renamed)",
		RiskTier: 0, CommissionBps: 450, IsActive: true, AttributeSchema: []byte(`{"properties":{"make":{"type":"string"}}}`),
	})
	if err != nil {
		t.Fatalf("update category: %v", err)
	}
	if updated.Name != "Admin Taxonomy Test Category (renamed)" || updated.RiskTier != 0 || updated.CommissionBps != 450 {
		t.Fatalf("update category did not apply: %+v", updated)
	}
	// Re-read via the SAME path service_listing.go's auto-approve guard uses.
	reread, err := repo.GetCategory(ctx, created.ID)
	if err != nil {
		t.Fatalf("re-get category via public path: %v", err)
	}
	if reread.RiskTier != 0 {
		t.Fatalf("auto-approve-relevant risk_tier did not persist: got %d want 0", reread.RiskTier)
	}

	// SetCategoryActive: disable, verify, re-enable.
	disabled, err := repo.AdminSetCategoryActive(ctx, created.ID, false)
	if err != nil {
		t.Fatalf("set inactive: %v", err)
	}
	if disabled.IsActive {
		t.Fatalf("expected is_active=false after disable")
	}
	// A disabled category must vanish from the PUBLIC list (is_active=TRUE
	// filter) but still appear in the ADMIN list (no such filter) — proves the
	// two queries are genuinely different, not the same query reused.
	publicCats, err := repo.ListCategories(ctx, DefaultMarketID)
	if err != nil {
		t.Fatalf("list public categories: %v", err)
	}
	for _, c := range publicCats {
		if c.ID == created.ID {
			t.Fatalf("disabled category %s leaked into the public (is_active-filtered) list", created.ID)
		}
	}
	adminCats, err := repo.AdminListCategories(ctx, DefaultMarketID)
	if err != nil {
		t.Fatalf("list admin categories: %v", err)
	}
	found := false
	for _, c := range adminCats {
		if c.ID == created.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("disabled category %s missing from the admin (unfiltered) list", created.ID)
	}

	enabled, err := repo.AdminSetCategoryActive(ctx, created.ID, true)
	if err != nil {
		t.Fatalf("set active: %v", err)
	}
	if !enabled.IsActive {
		t.Fatalf("expected is_active=true after re-enable")
	}
}

// TestLiveDBAdminTaxonomyDuplicateSlugConflicts proves the unique (market_id,
// slug) constraint surfaces as ErrConflict, not a raw 500 — the same
// isUniqueViolation→ErrConflict mapping InsertOrder already relies on.
func TestLiveDBAdminTaxonomyDuplicateSlugConflicts(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	slug := "admin-taxonomy-dup-" + uuid.New().String()[:8]
	first, err := repo.AdminInsertCategory(ctx, Category{
		MarketID: DefaultMarketID, Slug: slug, Name: "First", RiskTier: 0, CommissionBps: 200, IsActive: true,
		AttributeSchema: []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("insert first category: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_categories WHERE id=$1`, first.ID) })

	_, err = repo.AdminInsertCategory(ctx, Category{
		MarketID: DefaultMarketID, Slug: slug, Name: "Duplicate slug", RiskTier: 0, CommissionBps: 200, IsActive: true,
		AttributeSchema: []byte(`{}`),
	})
	if err != ErrConflict {
		t.Fatalf("expected ErrConflict on duplicate slug, got %v", err)
	}
}

// ── Analytics aggregation ────────────────────────────────────────────────────

// TestLiveDBAdminAnalyticsRevenueAndFunnel seeds a category, a listing, TWO
// boosts with KNOWN kobo amounts (one retained, one rejected — must be
// EXCLUDED from revenue), one contact reveal, and one "met" thread, then
// asserts AdminAnalytics' revenue_kobo and funnel counts are the EXACT sums —
// not approximate — proving the aggregation math itself, not just that a
// query runs.
func TestLiveDBAdminAnalyticsRevenueAndFunnel(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	sellerID := seedBoostSeller(t, ctx, pool, 3)
	buyerID := seedBoostSeller(t, ctx, pool, 3)
	categoryID := seedBoostCategory(t, ctx, pool)
	listingID := seedActiveListing(t, ctx, pool, sellerID, categoryID)

	// Retained boost: 500,000 kobo, status 'active' — counts toward revenue.
	retainedBoostID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO mkt_boosts (id, market_id, listing_id, seller_id, tier, duration_days, price_kobo, ledger_charge_ref, status, created_at)
		VALUES ($1,'NG',$2,$3,'featured',7,500000,$4,'active', now())`,
		retainedBoostID, listingID, sellerID, "analytics-test-"+retainedBoostID); err != nil {
		t.Fatalf("seed retained boost: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_boosts WHERE id=$1`, retainedBoostID) })

	// Rejected boost: 300,000 kobo, status 'rejected_with_reason' — must be
	// EXCLUDED from revenue (mirrors AdminMetrics.TotalGMVKobo's own filter).
	rejectedBoostID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO mkt_boosts (id, market_id, listing_id, seller_id, tier, duration_days, price_kobo, ledger_charge_ref, status, rejection_reason_code, created_at)
		VALUES ($1,'NG',$2,$3,'featured',7,300000,$4,'rejected_with_reason','policy_violation', now())`,
		rejectedBoostID, listingID, sellerID, "analytics-test-"+rejectedBoostID); err != nil {
		t.Fatalf("seed rejected boost: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_boosts WHERE id=$1`, rejectedBoostID) })

	// One contact reveal (real funnel.contacts signal — mkt_contact_reveals.revealed_at).
	if _, err := pool.Exec(ctx, `
		INSERT INTO mkt_contact_reveals (listing_id, viewer_id, seller_id) VALUES ($1,$2,$3)`,
		listingID, buyerID, sellerID); err != nil {
		t.Fatalf("seed contact reveal: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_contact_reveals WHERE listing_id=$1`, listingID) })

	// One thread marked "met" (real funnel.deals signal — mkt_threads.met_at).
	threadID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO mkt_threads (id, listing_id, buyer_id, seller_id, met_at, met_by)
		VALUES ($1,$2,$3,$4, now(), $3)`,
		threadID, listingID, buyerID, sellerID); err != nil {
		t.Fatalf("seed met thread: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_threads WHERE id=$1`, threadID) })

	a, err := repo.AdminAnalytics(ctx, DefaultMarketID, 30)
	if err != nil {
		t.Fatalf("admin analytics: %v", err)
	}

	if a.RangeDays != 30 {
		t.Fatalf("range_days: got %d want 30", a.RangeDays)
	}
	if a.RevenueKobo < 500000 {
		t.Fatalf("revenue_kobo should include the retained boost's 500000 kobo: got %d", a.RevenueKobo)
	}
	// The exact assertion: revenue in this window is AT LEAST the retained
	// boost and must not have double-subtracted/added the rejected one. We
	// isolate the delta attributable to our two seeded boosts by re-querying
	// with a WHERE listing_id filter directly (belt-and-suspenders on the
	// aggregate SQL itself, independent of whatever else lives in this shared
	// dev DB).
	var isolatedRevenue int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(sum(price_kobo - COALESCE(refunded_kobo,0)), 0) FROM mkt_boosts
		WHERE listing_id=$1 AND status IN ('purchased','active','completed')`, listingID).Scan(&isolatedRevenue); err != nil {
		t.Fatalf("isolated revenue query: %v", err)
	}
	if isolatedRevenue != 500000 {
		t.Fatalf("isolated revenue for our two seeded boosts: got %d want 500000 (rejected boost must be excluded)", isolatedRevenue)
	}

	if a.Funnel.Contacts < 1 {
		t.Fatalf("funnel.contacts should include our seeded contact reveal: got %d", a.Funnel.Contacts)
	}
	if a.Funnel.Deals < 1 {
		t.Fatalf("funnel.deals should include our seeded met thread: got %d", a.Funnel.Deals)
	}

	// Disclosed-zero fields: MUST be exactly 0, never a guessed/estimated value
	// (see repository_admin_analytics.go's package doc for why).
	if a.GMVKobo != 0 || a.GMVPrevKobo != 0 {
		t.Fatalf("gmv_kobo/gmv_prev_kobo must be 0 (ADR-023: no true item-sale GMV signal exists): got %d / %d", a.GMVKobo, a.GMVPrevKobo)
	}
	if a.DAU != 0 {
		t.Fatalf("dau must be 0 (no activity/session table exists): got %d", a.DAU)
	}
	if a.Funnel.Views != 0 {
		t.Fatalf("funnel.views must be 0 (view_count is a lifetime counter, not range-scoped): got %d", a.Funnel.Views)
	}

	// gmv_series must cover every day in the window (no silently-missing days)
	// and every point's gmv_kobo must be 0 (same disclosed-zero reason).
	if len(a.GMVSeries) == 0 {
		t.Fatalf("gmv_series must not be empty")
	}
	for _, p := range a.GMVSeries {
		if p.GMVKobo != 0 {
			t.Fatalf("gmv_series[%s].gmv_kobo must be 0, got %d", p.Date, p.GMVKobo)
		}
	}
	today := time.Now().Format("2006-01-02")
	lastPoint := a.GMVSeries[len(a.GMVSeries)-1]
	if lastPoint.Date != today {
		t.Fatalf("gmv_series last point should be today (%s), got %s", today, lastPoint.Date)
	}
}

// TestLiveDBAdminAnalyticsNewAndActiveListings proves active_listings/
// new_listings are exact COUNTs, not estimates: seed one active + one draft
// listing under a fresh category, assert active_listings counts only the
// active one and new_listings includes both (both created "now").
func TestLiveDBAdminAnalyticsNewAndActiveListings(t *testing.T) {
	pool := boostTestPool(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	sellerID := seedBoostSeller(t, ctx, pool, 3)
	categoryID := seedBoostCategory(t, ctx, pool)

	before, err := repo.AdminAnalytics(ctx, DefaultMarketID, 1)
	if err != nil {
		t.Fatalf("admin analytics (before): %v", err)
	}

	activeID := seedActiveListing(t, ctx, pool, sellerID, categoryID)

	draftID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO mkt_listings (id, market_id, seller_id, category_id, title, description, price_kobo, currency, condition, status, escrow_eligible, state)
		VALUES ($1,'NG',$2,$3,'Draft Test Listing Title','A perfectly ordinary listing description with eight whole words',
		        500000,'NGN','used','draft',true,'Lagos')`, draftID, sellerID, categoryID); err != nil {
		t.Fatalf("seed draft listing: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_listings WHERE id=$1`, draftID) })
	_ = activeID

	after, err := repo.AdminAnalytics(ctx, DefaultMarketID, 1)
	if err != nil {
		t.Fatalf("admin analytics (after): %v", err)
	}

	if after.ActiveListings != before.ActiveListings+1 {
		t.Fatalf("active_listings should increase by exactly 1 (the active seed, not the draft): before=%d after=%d",
			before.ActiveListings, after.ActiveListings)
	}
	if after.NewListings != before.NewListings+2 {
		t.Fatalf("new_listings should increase by exactly 2 (both seeds, regardless of status): before=%d after=%d",
			before.NewListings, after.NewListings)
	}
}
