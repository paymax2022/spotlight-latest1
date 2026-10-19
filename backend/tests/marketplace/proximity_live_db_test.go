package marketplace_test

// LIVE-DB tests for marketplace proximity. The whole feature rests on PostGIS
// reading mkt_listings.geo back against a buyer's own position, and that is
// exactly the part a query-builder unit test cannot prove: placeholder
// arithmetic, the (lng, lat) argument order, metres-vs-kilometres, and NULLS
// LAST for a listing that has no location. SKIPPED without a DSN:
//   export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/marketplace/... -run Proximity -v

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	mkt "spotlight/backend/internal/marketplace"
)

// seedGeedListing files an ACTIVE listing in the given market at (lat, lng), or
// with no location at all when either is nil.
func seedGeedListing(t *testing.T, ctx context.Context, pool *pgxpool.Pool, market, catID, title string, lat, lng *float64) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.mkt_listings
			(id, market_id, seller_id, category_id, title, description, price_kobo, state, status, geo)
		VALUES ($1,$2,$3,$4,$5,$6,500000,'Lagos','active',
			CASE WHEN $7::float8 IS NULL OR $8::float8 IS NULL THEN NULL
				ELSE ST_SetSRID(ST_MakePoint($8::float8, $7::float8), 4326)::geography END)`,
		id, market, uuid.NewString(), catID, title,
		"This is a valid listing description with more than eight words present.",
		lat, lng); err != nil {
		t.Fatalf("seed %s listing: %v", title, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM public.mkt_listings WHERE id=$1`, id)
	})
	return id
}

// searchResults runs the degraded Postgres search and returns its rows.
func searchResults(t *testing.T, svc *mkt.Service, params map[string]any) []mkt.Listing {
	t.Helper()
	got, err := svc.Search(context.Background(), params)
	if err != nil {
		t.Fatalf("Search(%v): %v", params, err)
	}
	env, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("search envelope is %T, want a map", got)
	}
	rows, ok := env["results"].([]mkt.Listing)
	if !ok {
		t.Fatalf("results is %T, want []marketplace.Listing", env["results"])
	}
	return rows
}

func byTitle(rows []mkt.Listing, title string) *mkt.Listing {
	for i := range rows {
		if rows[i].Title == title {
			return &rows[i]
		}
	}
	return nil
}

func f64(v float64) *float64 { return &v }

// TestProximity_SearchMeasuresRealDistances is the feature's claim: a buyer with
// a position sees how far each item actually is, the nearest is ordered first,
// and a listing with no location trails rather than leading or vanishing.
func TestProximity_SearchMeasuresRealDistances(t *testing.T) {
	svc, pool := liveConnectService(t)
	ctx := context.Background()
	cat := seedCategoryInMarket(t, ctx, pool, "NG")

	// Ikeja (Murtala Muhambiyi airport) ≈ 6.58, 3.32; Abuja ≈ 9.07, 7.49 —
	// roughly 700 km apart, so "nearest first" cannot pass by accident.
	seedGeedListing(t, ctx, pool, "NG", cat, "prox-near", f64(6.6018), f64(3.3515))
	seedGeedListing(t, ctx, pool, "NG", cat, "prox-far", f64(9.0700), f64(7.4247))
	seedGeedListing(t, ctx, pool, "NG", cat, "prox-no-geo", nil, nil)

	rows := searchResults(t, svc, map[string]any{
		"category_id": cat, "lat": "6.5800", "lng": "3.3200", "sort": "nearby", "limit": 10,
	})
	if len(rows) != 3 {
		t.Fatalf("results = %d (%v), want 3 — a listing with no location must still be searchable", len(rows), titles(rows))
	}
	if rows[0].Title != "prox-near" || rows[1].Title != "prox-far" {
		t.Errorf("order = %v, want prox-near then prox-far then prox-no-geo", titles(rows))
	}
	if rows[2].Title != "prox-no-geo" {
		t.Errorf("locationless listing did not trail: order = %v", titles(rows))
	}

	near := byTitle(rows, "prox-near")
	if near.DistanceKm == nil {
		t.Fatal("prox-near came back with no distance")
	}
	// Ikeja to the buyer's point is ~4 km; anything in 1–15 km proves the
	// (lng, lat) argument order and the metres→km division are both right. A
	// swapped pair would land ~300 km away, a missing /1000 would read 4000+.
	if *near.DistanceKm < 1 || *near.DistanceKm > 15 {
		t.Errorf("prox-near distance = %v km, want ~4 (outliers mean swapped coords or unconverted metres)", *near.DistanceKm)
	}
	if far := byTitle(rows, "prox-far"); far.DistanceKm == nil || *far.DistanceKm < 500 || *far.DistanceKm > 900 {
		t.Errorf("prox-far distance = %v, want ~700 km", far.DistanceKm)
	}
	if noGeo := byTitle(rows, "prox-no-geo"); noGeo.DistanceKm != nil {
		t.Errorf("a listing with no location reported distance %v km, want nil", *noGeo.DistanceKm)
	}

	// The seller's position must not travel to the buyer — the card promises a
	// distance, and the coordinates are, in practice, the seller's home.
	blob, _ := json.Marshal(rows)
	if s := string(blob); strings.Contains(s, "\"lat\"") || strings.Contains(s, "\"lng\"") {
		t.Errorf("search results carry raw seller coordinates:\n%s", s)
	}
}

// TestProximity_RadiusExcludesFarAndLocationless: a radius is the buyer saying
// "I will not travel further than this", so both a far listing and one with no
// position at all drop out.
func TestProximity_RadiusExcludesFarAndLocationless(t *testing.T) {
	svc, pool := liveConnectService(t)
	ctx := context.Background()
	cat := seedCategoryInMarket(t, ctx, pool, "NG")
	seedGeedListing(t, ctx, pool, "NG", cat, "prox-near", f64(6.6018), f64(3.3515))
	seedGeedListing(t, ctx, pool, "NG", cat, "prox-far", f64(9.0700), f64(7.4247))
	seedGeedListing(t, ctx, pool, "NG", cat, "prox-no-geo", nil, nil)

	rows := searchResults(t, svc, map[string]any{
		"category_id": cat, "lat": "6.5800", "lng": "3.3200", "radius_km": "10", "sort": "nearby", "limit": 10,
	})
	if len(rows) != 1 || rows[0].Title != "prox-near" {
		t.Fatalf("results = %v, want only prox-near within 10 km", titles(rows))
	}

	// An impossible coordinate is dropped, not an error at the wire: PostGIS
	// raises "Latitude 520 is out of range" inside ST_MakePoint, which would
	// surface as a 500 for what is really a caller mistake.
	naive := searchResults(t, svc, map[string]any{
		"category_id": cat, "lat": "520", "lng": "3.32", "sort": "nearby", "limit": 10,
	})
	if len(naive) != 3 {
		t.Errorf("out-of-range lat filtered the set (%v), want the un-sorted listing of all three", titles(naive))
	}
	for _, r := range naive {
		if r.DistanceKm != nil {
			t.Errorf("%s reported %v km with no usable buyer position", r.Title, *r.DistanceKm)
		}
	}
}

// TestProximity_ModerationQueueShowsLocation: the reviewer is the only person who
// can tell a seller to attach a location before the listing goes live, which
// needs the queue read to carry the difference between "posted near me" and
// "posted with nothing".
func TestProximity_ModerationQueueShowsLocation(t *testing.T) {
	svc, pool := liveConnectService(t)
	ctx := context.Background()
	cat := seedCategoryInMarket(t, ctx, pool, "NG")

	withGeo := seedGeedListing(t, ctx, pool, "NG", cat, "prox-pending-geo", f64(6.6018), f64(3.3515))
	if _, err := pool.Exec(ctx, `UPDATE public.mkt_listings SET status='pending_review' WHERE id=$1`, withGeo); err != nil {
		t.Fatalf("flip to pending_review: %v", err)
	}
	without := seedGeedListing(t, ctx, pool, "NG", cat, "prox-pending-none", nil, nil)
	if _, err := pool.Exec(ctx, `UPDATE public.mkt_listings SET status='pending_review' WHERE id=$1`, without); err != nil {
		t.Fatalf("flip to pending_review: %v", err)
	}

	rows, err := svc.ModerationQueue(ctx, 200, 0)
	if err != nil {
		t.Fatalf("ModerationQueue: %v", err)
	}
	got := byTitle(rows, "prox-pending-geo")
	if got == nil {
		t.Fatal("the pending listing with a location never reached the queue")
	}
	if got.Lat == nil || *got.Lat != 6.6018 || got.Lng == nil || *got.Lng != 3.3515 {
		t.Errorf("queue row lat/lng = %v/%v, want 6.6018/3.3515", got.Lat, got.Lng)
	}
	if none := byTitle(rows, "prox-pending-none"); none == nil || none.Lat != nil {
		t.Errorf("a locationless pending listing should reach the queue with no coordinates, got %+v", none)
	}
}

func titles(rows []mkt.Listing) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.Title
	}
	return out
}
