package marketplace

import (
	"strings"
	"testing"
)

// Proximity search was the one thing the mobile marketplace screens asked for and
// the Postgres fallback could not answer: GET /search accepted lat/lng/radius_km
// and a sort, and the degraded path read none of them — so "Near you" listed
// whatever newest-first happened to return, and a category browse at 400 km away
// was presented as if it were down the road.

func num(v float64) *float64 { return &v }

func TestParseSearchFallback_ReadsCoordinates(t *testing.T) {
	got := parseSearchFallback(map[string]any{
		"lat": "6.5244", "lng": "3.3792", "radius_km": "25", "sort": "nearby",
	})
	if got.Lat == nil || *got.Lat != 6.5244 {
		t.Fatalf("Lat = %v, want 6.5244", got.Lat)
	}
	if got.Lng == nil || *got.Lng != 3.3792 {
		t.Fatalf("Lng = %v, want 3.3792", got.Lng)
	}
	if got.RadiusKm == nil || *got.RadiusKm != 25 {
		t.Fatalf("RadiusKm = %v, want 25", got.RadiusKm)
	}
	if got.Sort != "nearby" {
		t.Errorf("Sort = %q, want nearby", got.Sort)
	}
}

// One coordinate alone defines no position. Leaving it set would put the origin at
// (lat, 0) — the Gulf of Guinea — and return a confident list of distances to
// nowhere. Same for a value PostGIS would reject outright: ST_MakePoint raises for
// |lat| > 90, which surfaces as a 500 for what is a caller typo.
func TestParseSearchFallback_DropsIncompleteOrImpossibleCoordinates(t *testing.T) {
	for _, tc := range []struct {
		name string
		req  map[string]any
	}{
		{"lat without lng", map[string]any{"lat": "6.5"}},
		{"lng without lat", map[string]any{"lng": "3.3"}},
		{"latitude out of range", map[string]any{"lat": "520", "lng": "3.3"}},
		{"longitude out of range", map[string]any{"lat": "6.5", "lng": "-181"}},
		{"NaN", map[string]any{"lat": "NaN", "lng": "3.3"}},
		{"garbage", map[string]any{"lat": "abc", "lng": "3.3"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := parseSearchFallback(tc.req)
			if got.Lat != nil || got.Lng != nil {
				t.Errorf("Lat/Lng = %v/%v, want both nil — half a pair or an impossible "+
					"coordinate must not reach ST_MakePoint", got.Lat, got.Lng)
			}
		})
	}
}

// A zero or negative radius is "no radius", not "nothing matches": the client chips
// start at a real distance and the only way to send 0 is a stale bookmark.
func TestParseSearchFallback_IgnoresNonPositiveRadius(t *testing.T) {
	for _, raw := range []string{"0", "-5"} {
		got := parseSearchFallback(map[string]any{"lat": "6.5", "lng": "3.3", "radius_km": raw})
		if got.RadiusKm != nil {
			t.Errorf("radius_km=%s gave %v, want nil (no filter)", raw, *got.RadiusKm)
		}
	}
}

func TestSearchFallbackQuery_NoCoordinatesIsTheOldQuery(t *testing.T) {
	q, args := searchFallbackQuery(SearchFallbackFilter{MarketID: DefaultMarketID, Limit: 12})
	for _, want := range []string{"ST_SetSRID", "ST_DWithin", "ST_Distance", "ST_X", "ST_Y"} {
		if strings.Contains(q, want) {
			t.Errorf("query carries %s with no origin bound: %s", want, q)
		}
	}
	if !strings.Contains(q, "ORDER BY created_at DESC, id DESC") {
		t.Errorf("query lost its default ordering: %s", q)
	}
	// The 22 listingCols, then LIMIT — nothing else.
	if len(args) != 2 {
		t.Fatalf("args = %v, want [NG 12] — market and limit only", args)
	}
}

func TestSearchFallbackQuery_BindsOriginOnceAndReusesIt(t *testing.T) {
	radius := 25.0
	q, args := searchFallbackQuery(SearchFallbackFilter{
		MarketID: DefaultMarketID, Limit: 12,
		Lat: num(6.5244), Lng: num(3.3792), RadiusKm: &radius, Sort: "nearby",
	})
	// $1/$2 are the buyer's position, bound first and referenced wherever geo
	// appears — a second binding of the same numbers would double the args and
	// shift every filter after it onto the wrong value.
	const origin = "ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography"
	if n := strings.Count(q, origin); n != 3 {
		t.Errorf("origin bound %d times, want 3 (distance column, radius filter, ORDER BY): %s", n, q)
	}
	if args[0] != 3.3792 || args[1] != 6.5244 {
		t.Errorf("args[0:2] = %v, %v — ST_MakePoint takes (lng, lat), the reverse of the field order", args[0], args[1])
	}
	if !strings.Contains(q, "ST_DWithin(geo, "+origin+", $4)") {
		t.Errorf("radius filter missing or mis-numbered: %s", q)
	}
	if args[3] != 25000.0 {
		t.Errorf("radius arg = %v, want 25000 (geography distance is metres)", args[3])
	}
	if !strings.Contains(q, "ORDER BY ST_Distance(geo, "+origin+") ASC NULLS LAST, created_at DESC, id DESC") {
		t.Errorf("nearby ordering missing: %s", q)
	}
	// distance_km is in kilometres because the whole app labels it as such.
	if !strings.Contains(q, "ST_Distance(geo, "+origin+")/1000.0") {
		t.Errorf("distance column missing or not converted to km: %s", q)
	}
	// And the buyer's search must read a DISTANCE, not the seller's position: a
	// GPS point on a listing is, in practice, the seller's home address, while
	// the card and the seller's own consent copy both promise only "3.6 km away".
	for _, leak := range []string{"ST_X(", "ST_Y("} {
		if strings.Contains(q, leak) {
			t.Errorf("query returns the seller's raw coordinates via %s: %s", leak, q)
		}
	}
}

// Nearest-first with no distance to order by (a search without a radius) must send
// the locationless listings to the END of the result set, not drop them — the
// buyer asked for this search, they just cannot claim the "Near you" label.
func TestSearchFallbackQuery_NearbyWithoutRadiusKeepsLocationlessRows(t *testing.T) {
	q, _ := searchFallbackQuery(SearchFallbackFilter{
		MarketID: DefaultMarketID, Limit: 12, Lat: num(6.5), Lng: num(3.3), Sort: "nearby",
	})
	if strings.Contains(q, "ST_DWithin") {
		t.Errorf("a radius filter appeared without radius_km: %s", q)
	}
	if !strings.Contains(q, "NULLS LAST") {
		t.Errorf("locationless rows would be ordered arbitrarily (or excluded) without NULLS LAST: %s", q)
	}
}

// sort=nearby is a caller asking for proximity it cannot have without coordinates.
// It must not reorder anything — and must not emit an ORDER BY that references the
// $1/$2 that were never bound, which is a 500 at the wire.
func TestSearchFallbackQuery_NearbyWithoutCoordinatesIsIgnored(t *testing.T) {
	q, args := searchFallbackQuery(SearchFallbackFilter{MarketID: DefaultMarketID, Limit: 12, Sort: "nearby"})
	if strings.Contains(q, "ST_") {
		t.Errorf("geo SQL emitted with no origin: %s", q)
	}
	if len(args) != 2 {
		t.Errorf("args = %v, want the market and the limit only", args)
	}
}
