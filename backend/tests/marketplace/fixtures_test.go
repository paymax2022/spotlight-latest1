package marketplace_test

// ---------------------------------------------------------------------------
// Shared fixture teardown for the live-DB marketplace suites.
//
// WHY THIS EXISTS. These suites seed real mkt_categories rows ('remod-…',
// 'schema-…', 'test-cat-…') and file listings under them. Nothing removed them,
// so every run left a handful behind — and because GET /categories returns every
// active category, they rendered in the mobile app as REAL top-level marketplace
// tiles next to Vehicles and Property. A developer browsing the marketplace after
// running `go test ./...` saw 19 top-level categories instead of 12, most of them
// named "Remod Test Cat".
//
// connect_flow_live_db_test.go had already written the right teardown and it
// still never ran: the test held `defer pool.Close()`, and a deferred close fires
// when the function RETURNS, which is before any t.Cleanup callback. Every delete
// then executed against a closed pool, and because the results were discarded
// with `_, _ =` the failure was silent. That is the trap this file removes: the
// pool close is now registered by the constructors as a Cleanup, so it is always
// the FIRST thing registered and therefore the LAST thing to run.
//
// Rule for anything added here later: seed through a helper that registers its
// own teardown, and never write `defer pool.Close()` in a test.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// fixtureCategorySlugs are the slug prefixes this package owns. Kept in one place
// so the start-of-run sweep and any future fixture agree on what is disposable.
var fixtureCategorySlugs = []string{"remod-%", "schema-%", "test-cat-%", "mkt-scope-%"}

// deleteCategoryTree removes a seeded category and everything filed under it, in
// FK order. mkt_listings → mkt_categories is NO ACTION rather than CASCADE, so
// the category cannot go until its listings do, and a listing cannot go until its
// threads/offers/orders/boosts do.
//
// Errors are deliberately ignored: teardown runs after a test may already have
// failed, and a noisy cascade of secondary errors would bury the real failure.
// The start-of-run sweep is the backstop for anything this misses.
func deleteCategoryTree(ctx context.Context, pool *pgxpool.Pool, categoryID string) {
	const listings = `SELECT id FROM public.mkt_listings WHERE category_id=$1`
	const threads = `SELECT id FROM public.mkt_threads WHERE listing_id IN (` + listings + `)`
	const orders = `SELECT id FROM public.mkt_orders WHERE listing_id IN (` + listings + `)`

	for _, q := range []string{
		`DELETE FROM public.mkt_deal_reviews WHERE thread_id IN (` + threads + `)`,
		`DELETE FROM public.mkt_messages     WHERE thread_id IN (` + threads + `)`,
		`DELETE FROM public.mkt_threads      WHERE listing_id IN (` + listings + `)`,
		`DELETE FROM public.mkt_disputes     WHERE order_id IN (` + orders + `)`,
		`DELETE FROM public.mkt_reviews      WHERE order_id IN (` + orders + `)`,
		// Orders reference offers, so they must go first.
		`DELETE FROM public.mkt_orders          WHERE listing_id IN (` + listings + `)`,
		`DELETE FROM public.mkt_offers          WHERE listing_id IN (` + listings + `)`,
		`DELETE FROM public.mkt_boosts          WHERE listing_id IN (` + listings + `)`,
		`DELETE FROM public.mkt_listings_outbox WHERE listing_id IN (` + listings + `)`,
		// media + saved_items cascade from the listing.
		`DELETE FROM public.mkt_listings     WHERE category_id=$1`,
		`DELETE FROM public.mkt_price_bands  WHERE category_id=$1`,
		`DELETE FROM public.mkt_categories   WHERE id=$1`,
	} {
		_, _ = pool.Exec(ctx, q, categoryID)
	}
}

// cleanupCategory registers deleteCategoryTree for a seeded category.
//
// Registered as a Cleanup, never a defer, and always AFTER the pool's own close
// cleanup — so it runs BEFORE the pool shuts (cleanups are last-in-first-out).
// A fresh context is used because the test's context may already be cancelled by
// the time teardown runs.
func cleanupCategory(t *testing.T, pool *pgxpool.Pool, categoryID string) {
	t.Helper()
	t.Cleanup(func() { deleteCategoryTree(context.Background(), pool, categoryID) })
}

// TestMain sweeps fixture categories left by an EARLIER run before this one
// starts. Per-test teardown covers the normal path; this covers the paths it
// cannot — a killed run, a panic, or a fixture seeded before teardown existed.
//
// Sweeping at the START rather than the end is deliberate: at the end it would
// race a concurrently running package that had seeded its own rows.
func TestMain(m *testing.M) {
	dsn := os.Getenv("MARKETPLACE_TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("TEST_DATABASE_URL")
	}
	if dsn != "" {
		ctx := context.Background()
		if pool, err := pgxpool.New(ctx, dsn); err == nil {
			for _, pattern := range fixtureCategorySlugs {
				rows, err := pool.Query(ctx, `SELECT id::text FROM public.mkt_categories WHERE slug LIKE $1`, pattern)
				if err != nil {
					continue
				}
				var ids []string
				for rows.Next() {
					var id string
					if rows.Scan(&id) == nil {
						ids = append(ids, id)
					}
				}
				rows.Close()
				for _, id := range ids {
					deleteCategoryTree(ctx, pool, id)
				}
			}
			pool.Close()
		}
	}
	os.Exit(m.Run())
}
