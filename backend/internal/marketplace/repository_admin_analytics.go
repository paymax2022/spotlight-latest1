package marketplace

import (
	"context"
	"time"
)

// repository_admin_analytics.go — GET /admin/analytics (MKT-007, ADM-005).
//
// ── What is REAL vs DISCLOSED-ZERO here (read before changing any of these) ──
//
// Real, computed from actual rows:
//   - active_listings / new_listings      : mkt_listings COUNT
//   - revenue_kobo                        : SUM(mkt_boosts.price_kobo - refunded_kobo)
//     for retained (purchased/active/completed) boosts in the window — the
//     SAME "sole live marketplace money path" semantics AdminMetrics already
//     documents (repository.go ~1640).
//   - funnel.contacts                     : COUNT(mkt_contact_reveals) in the window
//     (revealed_at is a real per-event timestamp).
//   - funnel.deals / gmv_series[].deals    : COUNT(mkt_threads WHERE met_at IS NOT
//     NULL) in the window — the ADR-023 "deal completed" signal (a thread either
//     participant marked met), independent of whether a review was ever left.
//   - top_categories[].active_listings    : mkt_listings COUNT per category.
//
// Deliberately NOT computed (returned as 0, never fabricated):
//   - gmv_kobo / gmv_prev_kobo / gmv_series[].gmv_kobo / top_categories[].gmv_kobo:
//     ADR-023 retired escrow/order tracking — the marketplace structurally has
//     no record of the actual item-sale price a deal closed at (parties
//     transact off-platform). There is no field anywhere this could be summed
//     from without inventing a number, so it is 0 (never estimated from
//     price_kobo asks, which are NOT sale prices).
//   - dau: no activity/session table exists in this module (mkt_listings/
//     mkt_offers/mkt_messages are per-ACTION tables, not a login/session log).
//     Averaging distinct actors across them would be a fabricated proxy
//     metric, not "daily active users" — left 0.
//   - funnel.views: mkt_listings.view_count (repository_account.go) IS real,
//     but it is a lifetime CUMULATIVE counter with no per-event timestamp —
//     there is no way to scope "views in the last N days" from it. Reporting
//     the lifetime total against a rolling window label would silently lie
//     every time range_days changes (7d and 90d would show the same number).
//     Left 0 rather than mislabel a lifetime count as a window count.
type AdminAnalytics struct {
	RangeDays      int                     `json:"range_days"`
	GMVKobo        int64                   `json:"gmv_kobo"`
	GMVPrevKobo    int64                   `json:"gmv_prev_kobo"`
	RevenueKobo    int64                   `json:"revenue_kobo"`
	DAU            int64                   `json:"dau"`
	ActiveListings int64                   `json:"active_listings"`
	NewListings    int64                   `json:"new_listings"`
	Funnel         AdminAnalyticsFunnel    `json:"funnel"`
	GMVSeries      []AdminAnalyticsPoint   `json:"gmv_series"`
	TopCategories  []AdminAnalyticsCatStat `json:"top_categories"`
}

type AdminAnalyticsFunnel struct {
	Views    int64 `json:"views"`
	Contacts int64 `json:"contacts"`
	Deals    int64 `json:"deals"`
}

type AdminAnalyticsPoint struct {
	Date    string `json:"date"`
	GMVKobo int64  `json:"gmv_kobo"`
	Deals   int64  `json:"deals"`
}

type AdminAnalyticsCatStat struct {
	CategoryID     string `json:"category_id"`
	Name           string `json:"name"`
	GMVKobo        int64  `json:"gmv_kobo"`
	ActiveListings int64  `json:"active_listings"`
}

// boostRevenueStatuses mirrors AdminMetrics' retained-boost filter exactly
// (repository.go ~1655) so admin dashboard vs admin analytics never disagree
// on "how much boost revenue was retained."
const boostRevenueStatusesSQL = `status IN ('purchased','active','completed')`

// AdminAnalytics computes the whole payload in a handful of round trips (no
// single giant CTE — easier to unit-test each figure and to see in an EXPLAIN
// which piece is slow later). windowStart is the caller's now()-range_days
// cutoff; prevStart..windowStart is the same-length preceding window used for
// gmv_prev_kobo's delta (currently always 0 — see the package doc above — but
// wired through so a real signal can be dropped in later without touching the
// handler).
func (r *Repository) AdminAnalytics(ctx context.Context, marketID string, rangeDays int) (*AdminAnalytics, error) {
	if rangeDays <= 0 {
		rangeDays = 30
	}
	a := &AdminAnalytics{RangeDays: rangeDays}
	windowStart := time.Now().AddDate(0, 0, -rangeDays)

	err := r.db.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM public.mkt_listings WHERE market_id=$1 AND status='active'),
			(SELECT count(*) FROM public.mkt_listings WHERE market_id=$1 AND created_at >= $2),
			(SELECT COALESCE(sum(price_kobo - COALESCE(refunded_kobo,0)), 0) FROM public.mkt_boosts
				WHERE market_id=$1 AND `+boostRevenueStatusesSQL+` AND created_at >= $2),
			(SELECT count(*) FROM public.mkt_contact_reveals cr
				JOIN public.mkt_listings l ON l.id = cr.listing_id
				WHERE l.market_id=$1 AND cr.revealed_at >= $2),
			(SELECT count(*) FROM public.mkt_threads t
				JOIN public.mkt_listings l ON l.id = t.listing_id
				WHERE l.market_id=$1 AND t.met_at IS NOT NULL AND t.met_at >= $2)
	`, marketID, windowStart).Scan(
		&a.ActiveListings, &a.NewListings, &a.RevenueKobo,
		&a.Funnel.Contacts, &a.Funnel.Deals,
	)
	if err != nil {
		return nil, wrapInternal("admin analytics summary", err)
	}

	series, err := r.adminAnalyticsSeries(ctx, marketID, rangeDays, windowStart)
	if err != nil {
		return nil, err
	}
	a.GMVSeries = series

	top, err := r.adminAnalyticsTopCategories(ctx, marketID)
	if err != nil {
		return nil, err
	}
	a.TopCategories = top

	return a, nil
}

// adminAnalyticsSeries returns one row per day in [windowStart, now], real
// deals-per-day (mkt_threads.met_at), gmv_kobo always 0 (see package doc).
// generate_series + a LEFT JOIN so days with zero deals still appear (a bar
// chart with silently missing days would misread as "no data returned" rather
// than "zero that day").
func (r *Repository) adminAnalyticsSeries(ctx context.Context, marketID string, rangeDays int, windowStart time.Time) ([]AdminAnalyticsPoint, error) {
	rows, err := r.db.Query(ctx, `
		WITH days AS (
			SELECT generate_series(date_trunc('day', $2::timestamptz), date_trunc('day', now()), interval '1 day')::date AS d
		)
		SELECT days.d,
		       COALESCE(count(t.id), 0) AS deals
		FROM days
		LEFT JOIN public.mkt_threads t
		       ON t.met_at IS NOT NULL
		      AND date_trunc('day', t.met_at) = days.d
		      AND t.listing_id IN (SELECT id FROM public.mkt_listings WHERE market_id=$1)
		GROUP BY days.d
		ORDER BY days.d`, marketID, windowStart)
	if err != nil {
		return nil, wrapInternal("admin analytics series", err)
	}
	defer rows.Close()
	out := make([]AdminAnalyticsPoint, 0, rangeDays+1)
	for rows.Next() {
		var d time.Time
		var deals int64
		if err := rows.Scan(&d, &deals); err != nil {
			return nil, err
		}
		out = append(out, AdminAnalyticsPoint{Date: d.Format("2006-01-02"), GMVKobo: 0, Deals: deals})
	}
	return out, rows.Err()
}

// adminAnalyticsTopCategories ranks categories by CURRENT active-listing count
// (real) — gmv_kobo is 0 per category for the same structural reason as the
// top-level figure. Top 5, active-only, ties broken by name for a stable order.
func (r *Repository) adminAnalyticsTopCategories(ctx context.Context, marketID string) ([]AdminAnalyticsCatStat, error) {
	rows, err := r.db.Query(ctx, `
		SELECT c.id, c.name, count(l.id) AS active_listings
		FROM public.mkt_categories c
		LEFT JOIN public.mkt_listings l ON l.category_id = c.id AND l.status = 'active'
		WHERE c.market_id = $1 AND c.is_active = TRUE
		GROUP BY c.id, c.name
		ORDER BY active_listings DESC, c.name ASC
		LIMIT 5`, marketID)
	if err != nil {
		return nil, wrapInternal("admin analytics top categories", err)
	}
	defer rows.Close()
	out := make([]AdminAnalyticsCatStat, 0, 5)
	for rows.Next() {
		var s AdminAnalyticsCatStat
		if err := rows.Scan(&s.CategoryID, &s.Name, &s.ActiveListings); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
