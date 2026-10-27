package app

import "testing"

// TestToSearchRequest_Proximity pins the ES half of the coordinate guard that
// marketplace.parseSearchFallback applies to the Postgres fallback: the two
// search backends must disagree about nothing, because the mobile client cannot
// tell which one answered and would otherwise see radius filters appear and
// vanish depending on ELASTICSEARCH_URL.
func TestToSearchRequest_Proximity(t *testing.T) {
	cases := []struct {
		name         string
		query        map[string]any
		wantCoords   bool
		wantRadiusKm float64
		hasRadius    bool
	}{
		{"full pair and radius", map[string]any{"lat": "6.5244", "lng": "3.3792", "radius_km": "25", "sort": "nearby"}, true, 25, true},
		{"lat only is dropped", map[string]any{"lat": "6.5244", "radius_km": "25"}, false, 25, true},
		{"lng only is dropped", map[string]any{"lng": "3.3792"}, false, 0, false},
		{"out of range is dropped", map[string]any{"lat": "91", "lng": "3.3"}, false, 0, false},
		{"nan is dropped", map[string]any{"lat": "NaN", "lng": "NaN"}, false, 0, false},
		{"garbage is dropped", map[string]any{"lat": "abc", "lng": "3.3"}, false, 0, false},
		{"non-positive radius is ignored", map[string]any{"lat": "6.5", "lng": "3.3", "radius_km": "0"}, true, 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			sr := toSearchRequest(c.query)
			if got := sr.Lat != nil && sr.Lng != nil; got != c.wantCoords {
				t.Errorf("coords present = %v (lat %v / lng %v), want %v", got, sr.Lat, sr.Lng, c.wantCoords)
			}
			if got := sr.RadiusKm != nil; got != c.hasRadius {
				t.Errorf("radius present = %v (%v), want %v", got, sr.RadiusKm, c.hasRadius)
			}
			if c.hasRadius && sr.RadiusKm != nil && *sr.RadiusKm != c.wantRadiusKm {
				t.Errorf("radius = %v, want %v", *sr.RadiusKm, c.wantRadiusKm)
			}
		})
	}
}
