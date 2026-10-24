package search

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func f64(v float64) *float64 { return &v }

// TestBuildSort_NearbyDegradesWithoutCoordinates pins the ES half of
// sort=nearby: with a buyer position it must be a real geo-distance sort, and
// without one it must fall back to relevance instead of shipping a clause ES
// rejects (the old behaviour was an ignored token — a filter that silently does
// nothing is the defect this repo already agreed to stop shipping).
func TestBuildSort_NearbyDegradesWithoutCoordinates(t *testing.T) {
	if got := buildSort(SearchRequest{Sort: "nearby"}); got != nil {
		t.Errorf("nearby with no coords = %#v, want nil (fall back to _score)", got)
	}

	got := buildSort(SearchRequest{Sort: "nearby", Lat: f64(6.5244), Lng: f64(3.3792)})
	if len(got) != 1 {
		t.Fatalf("want one sort clause, got %#v", got)
	}
	geo, ok := got[0]["_geo_distance"].(map[string]any)
	if !ok {
		t.Fatalf("clause is not a _geo_distance sort: %#v", got[0])
	}
	if geo["unit"] != "km" {
		t.Errorf("unit = %v, want km (the client formats distance_km)", geo["unit"])
	}
	// A listing with no recorded position has no geo_point to sort on; ES must
	// order those last rather than fail the request (the SQL fallback does the
	// same with NULLS LAST).
	if geo["missing"] != "_last" {
		t.Errorf("missing = %v, want _last", geo["missing"])
	}
	// The point must be keyed the same way the filter and decay clauses key it,
	// and against the doc's geo_point field.
	pts, ok := geo["geo"].([]map[string]any)
	if !ok || len(pts) != 1 {
		t.Fatalf("geo = %#v, want one point", geo["geo"])
	}
	if pts[0]["lat"] != 6.5244 || pts[0]["lng"] != 3.3792 {
		t.Errorf("origin = %#v, want lat 6.5244 / lng 3.3792", pts[0])
	}
}

// TestBuildQuery_RadiusFilterNeedsBothHalves: a lat with no lng (or a radius
// with no position) must not narrow the result set at all. A position alone
// still gets the pre-existing proximity *boost*, which is not a filter.
func TestBuildQuery_RadiusFilterNeedsBothHalves(t *testing.T) {
	encode := func(req SearchRequest) string {
		b, err := json.Marshal(BuildQuery(req))
		if err != nil {
			t.Fatalf("marshal query: %v", err)
		}
		return string(b)
	}
	if got := encode(SearchRequest{Lat: f64(6.5), RadiusKm: f64(25)}); strings.Contains(got, "geo_distance") {
		t.Errorf("half a position still emitted a proximity filter:\n%s", got)
	}
	halfPair := encode(SearchRequest{Lat: f64(6.5)})
	if strings.Contains(halfPair, "gauss") {
		t.Errorf("lat-only request got a geo boost it cannot compute:\n%s", halfPair)
	}
	position := encode(SearchRequest{Lat: f64(6.5), Lng: f64(3.4)})
	if !strings.Contains(position, "gauss") {
		t.Errorf("a full position lost the proximity boost the builder has always applied:\n%s", position)
	}
	if strings.Contains(position, "geo_distance") {
		t.Errorf("no radius sent, yet the result set is filtered:\n%s", position)
	}
	withRadius := encode(SearchRequest{Lat: f64(6.5), Lng: f64(3.4), RadiusKm: f64(25)})
	if !strings.Contains(withRadius, "geo_distance") || !strings.Contains(withRadius, "25km") {
		t.Errorf("radius not bound into the filter:\n%s", withRadius)
	}
	// sort=nearby must actually reach ES as a geo-distance sort.
	nearby := encode(SearchRequest{Sort: "nearby", Lat: f64(6.5), Lng: f64(3.4)})
	if !strings.Contains(nearby, "_geo_distance") {
		t.Errorf("sort=nearby produced no sort clause:\n%s", nearby)
	}
}

// newProximityFakeES answers one _search with a fixed hit list, echoing whatever
// _source/sort/fields values the fixture carries.
func newProximityFakeES(t *testing.T, hits []map[string]any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"took": 1,
			"hits": map[string]any{"hits": hits},
			"aggs": map[string]any{},
		})
	}))
}

// TestClientSearch_DistanceFromScriptFields is the ES-path half of the promise
// the mobile cards make: with a buyer position every row arrives already
// measured, under whatever sort was asked for — and the seller's own coordinates
// never leave the server.
func TestClientSearch_DistanceFromScriptFields(t *testing.T) {
	source, _ := json.Marshal(map[string]any{"listing_id": "a", "title": "Phone", "geo": map[string]any{"lat": 6.5244, "lng": 3.3792}})
	noGeo, _ := json.Marshal(map[string]any{"listing_id": "b", "title": "Bike"})
	hits := []map[string]any{
		{"_source": json.RawMessage(source), "fields": map[string]any{"distance_km": []any{3.6479}}},
		// ES reports a missing geo_point as [null] from the guarded script.
		{"_source": json.RawMessage(noGeo), "fields": map[string]any{"distance_km": []any{nil}}},
	}

	srv := newProximityFakeES(t, hits)
	defer srv.Close()

	res, err := NewClient(srv.URL).Search(context.Background(),
		SearchRequest{Sort: "trusted_first", Lat: f64(6.5), Lng: f64(3.4)})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(res.Results) != 2 {
		t.Fatalf("results = %d, want 2", len(res.Results))
	}
	if d := res.Results[0].DistanceKm; d == nil || *d != 3.6479 {
		t.Errorf("distance_km = %v, want 3.6479", d)
	}
	if d := res.Results[1].DistanceKm; d != nil {
		t.Errorf("a locationless listing reported distance %v, want nil", *d)
	}
}

// TestClientSearch_NearbyFallsBackToTheSortValue: if the script field is absent
// (an index whose template predates it), the geo-distance sort still carries the
// distance in its leading value, so a nearby search is never distanceless.
func TestClientSearch_NearbyFallsBackToTheSortValue(t *testing.T) {
	source, _ := json.Marshal(map[string]any{"listing_id": "a", "title": "Phone"})
	srv := newProximityFakeES(t, []map[string]any{{"_source": json.RawMessage(source), "sort": []any{12.5}}})
	defer srv.Close()

	res, err := NewClient(srv.URL).Search(context.Background(),
		SearchRequest{Sort: "nearby", Lat: f64(6.5), Lng: f64(3.4)})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if d := res.Results[0].DistanceKm; d == nil || *d != 12.5 {
		t.Errorf("distance_km = %v, want 12.5 from the leading sort value", d)
	}
}

// TestClientSearch_NonDistanceSortValueIsNotADistance: under a price sort the
// leading sort value is a PRICE. Reporting it as a distance would print a number
// that happens to be wrong, so without the script field the row has none.
func TestClientSearch_NonDistanceSortValueIsNotADistance(t *testing.T) {
	source, _ := json.Marshal(map[string]any{"listing_id": "a", "title": "Phone", "geo": map[string]any{"lat": 6.5, "lng": 3.4}})
	srv := newProximityFakeES(t, []map[string]any{{"_source": json.RawMessage(source), "sort": []any{250000000, "newest-value"}}})
	defer srv.Close()

	res, err := NewClient(srv.URL).Search(context.Background(),
		SearchRequest{Sort: "price_asc", Lat: f64(6.5), Lng: f64(3.4)})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if d := res.Results[0].DistanceKm; d != nil {
		t.Errorf("distance_km = %v under a price sort with no script field, want nil", *d)
	}
}
