package maps

import (
	"context"
	"math"
	"testing"
)

// almostEqual compares two confidences with a small tolerance (float math).
func almostEqual(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

// ─────────────────────────────────────────────────────────────────────────────
// Google: location_type + partial_match → Confidence (MAPSERVICE.md §3)
// ─────────────────────────────────────────────────────────────────────────────

func TestGoogleConfidence(t *testing.T) {
	cases := []struct {
		name     string
		locType  string
		partial  bool
		want     Confidence
	}{
		{"rooftop", "ROOFTOP", false, 1.0},
		{"range_interpolated", "RANGE_INTERPOLATED", false, 0.8},
		{"geometric_center", "GEOMETRIC_CENTER", false, 0.6},
		{"approximate", "APPROXIMATE", false, 0.4},
		{"unknown_defaults_low", "SOMETHING_ELSE", false, 0.4},
		{"rooftop_partial", "ROOFTOP", true, 0.7},                 // 1.0 * 0.7
		{"geometric_center_partial", "GEOMETRIC_CENTER", true, 0.42}, // 0.6 * 0.7
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := googleConfidence(c.locType, c.partial)
			if !almostEqual(got, c.want) {
				t.Fatalf("googleConfidence(%q, %v) = %v, want %v", c.locType, c.partial, got, c.want)
			}
		})
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// HERE: scoring.queryScore + fieldScore avg → Confidence (MAPSERVICE.md §3/§10)
// ─────────────────────────────────────────────────────────────────────────────

func TestHereConfidence(t *testing.T) {
	t.Run("query_score_only", func(t *testing.T) {
		it := hereItem{}
		it.Scoring.QueryScore = 0.92
		if got := hereConfidence(it); !almostEqual(got, 0.92) {
			t.Fatalf("queryScore-only = %v, want 0.92", got)
		}
	})
	t.Run("blends_field_scores", func(t *testing.T) {
		it := hereItem{}
		it.Scoring.QueryScore = 1.0
		it.Scoring.FieldScore = map[string]float64{"streets": 0.5, "houseNumber": 0.5}
		// 0.7*1.0 + 0.3*0.5 = 0.85
		if got := hereConfidence(it); !almostEqual(got, 0.85) {
			t.Fatalf("blended = %v, want 0.85", got)
		}
	})
	t.Run("clamps_query_score", func(t *testing.T) {
		it := hereItem{}
		it.Scoring.QueryScore = 1.5
		if got := hereConfidence(it); !almostEqual(got, 1.0) {
			t.Fatalf("clamp high = %v, want 1.0", got)
		}
		it.Scoring.QueryScore = -0.2
		if got := hereConfidence(it); !almostEqual(got, 0.0) {
			t.Fatalf("clamp low = %v, want 0.0", got)
		}
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// Geoapify/Nominatim: rank.confidence / rank.importance → Confidence
// ─────────────────────────────────────────────────────────────────────────────

func TestGeoapifyConfidence(t *testing.T) {
	cases := []struct {
		name       string
		confidence float64
		importance float64
		want       Confidence
	}{
		{"prefers_confidence", 0.77, 0.4, 0.77},
		{"falls_back_to_importance", 0, 0.55, 0.55},
		{"clamps_high", 1.4, 0, 1.0},
		{"both_zero", 0, 0, 0.0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := geoapifyConfidence(c.confidence, c.importance)
			if !almostEqual(got, c.want) {
				t.Fatalf("geoapifyConfidence(%v,%v) = %v, want %v", c.confidence, c.importance, got, c.want)
			}
		})
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock: deterministic confidence + H3 cell so the v2 chain behaves
// ─────────────────────────────────────────────────────────────────────────────

func TestMockGeocodeConfidenceAndCell(t *testing.T) {
	m := NewMockProvider("geoapify", SourceOpenStack)
	res, err := m.Geocode(context.Background(), "12 Marina, Lagos")
	if err != nil {
		t.Fatal(err)
	}
	if !almostEqual(res.Confidence, 0.9) {
		t.Fatalf("mock geocode confidence = %v, want 0.9", res.Confidence)
	}
	if res.H3Cell == "" {
		t.Fatal("mock geocode should set H3Cell")
	}
	if res.H3Cell != PointCellKey(res.Lat, res.Lng) {
		t.Fatalf("H3Cell mismatch: %q vs %q", res.H3Cell, PointCellKey(res.Lat, res.Lng))
	}

	rev, err := m.ReverseGeocode(context.Background(), 6.45, 3.39)
	if err != nil {
		t.Fatal(err)
	}
	if !almostEqual(rev.Confidence, 0.9) {
		t.Fatalf("mock reverse confidence = %v, want 0.9", rev.Confidence)
	}
	if rev.H3Cell == "" {
		t.Fatal("mock reverse should set H3Cell")
	}

	sugg, err := m.Autocomplete(context.Background(), "marina", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(sugg) == 0 || sugg[0].Confidence <= 0 {
		t.Fatalf("mock autocomplete should carry confidence, got %+v", sugg)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// License coherence: HERE + Google are NEVER cacheable (MAPSERVICE.md §10)
// ─────────────────────────────────────────────────────────────────────────────

func TestHereGoogleNeverCacheable(t *testing.T) {
	if isCacheableSource(SourceHere) {
		t.Fatal("SourceHere must NOT be cacheable")
	}
	if isCacheableSource(SourceGoogle) {
		t.Fatal("SourceGoogle must NOT be cacheable")
	}
	// Sanity: the OSM-licensed source IS cacheable (so the test is meaningful).
	if !isCacheableSource(SourceOpenStack) {
		t.Fatal("SourceOpenStack should be cacheable")
	}
}

// Capabilities sanity: HERE advertises geocode/reverse/autocomplete/route + traffic.
func TestHereCapabilities(t *testing.T) {
	caps := NewHERE("k", "").Capabilities()
	if !caps.Geocode || !caps.Reverse || !caps.Autocomplete || !caps.Route || !caps.TrafficAware {
		t.Fatalf("unexpected HERE capabilities: %+v", caps)
	}
	if caps.Matrix {
		t.Fatal("HERE adapter does not implement Matrix")
	}
}
