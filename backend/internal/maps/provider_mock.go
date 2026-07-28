package maps

import (
	"context"
	"fmt"
	"math"
)

const earthRadiusM = 6371000.0

// haversineM is the great-circle distance between two points in metres.
func haversineM(a, b Point) float64 {
	lat1 := a.Lat * math.Pi / 180
	lat2 := b.Lat * math.Pi / 180
	dLat := (b.Lat - a.Lat) * math.Pi / 180
	dLng := (b.Lng - a.Lng) * math.Pi / 180
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusM * math.Asin(math.Min(1, math.Sqrt(h)))
}

// MockProvider is a deterministic, network-free implementation of every adapter
// role. It stands in for a real provider when no key is configured, so dev/CI
// stay fully functional and tests are deterministic. It is registered under the
// REAL provider's name (e.g. "geoapify", "osrm", "maptiler") and carries that
// provider's Source so license/coherence behaviour matches production.
type MockProvider struct {
	name        string
	source      Source
	avgSpeedMPS float64
	codec       PlusCodec
}

// NewMockProvider builds a mock that reports the given name + source.
func NewMockProvider(name string, source Source) *MockProvider {
	return &MockProvider{name: name, source: source, avgSpeedMPS: 8.33, codec: NewPlusCodec()}
}

func (m *MockProvider) Name() string { return m.name }

// BasemapConfig returns a deterministic style URL (no key leaked).
func (m *MockProvider) BasemapConfig(_ context.Context, surface string) (StyleConfig, error) {
	return StyleConfig{
		StyleURL:    "mock://style/" + m.name + "?surface=" + surface,
		Attribution: "© OpenStreetMap contributors (mock)",
		Provider:    m.name,
		Source:      m.source,
	}, nil
}

// pseudoPoint derives a stable Lagos-area coordinate from a string.
func pseudoPoint(s string) (float64, float64) {
	var sum int
	for _, r := range s {
		sum += int(r)
	}
	lat := 6.45 + float64(sum%1000)/10000.0
	lng := 3.39 + float64((sum*7)%1000)/10000.0
	return lat, lng
}

func (m *MockProvider) Geocode(_ context.Context, address string) (GeoResult, error) {
	if address == "" {
		return GeoResult{}, ErrEmptyQuery
	}
	lat, lng := pseudoPoint(address)
	// Cacheable is ALWAYS false for mock results: synthetic answers must never
	// enter geocode_cache, where they would keep shadowing a real provider after
	// keys are configured (observed: mock-era rows served instead of Google).
	return GeoResult{
		Lat: lat, Lng: lng, Address: address, PlusCode: m.codec.Encode(lat, lng),
		Provider: m.name, Source: m.source, Cacheable: false,
		Confidence: 0.9, H3Cell: PointCellKey(lat, lng),
	}, nil
}

func (m *MockProvider) ReverseGeocode(_ context.Context, lat, lng float64) (GeoResult, error) {
	return GeoResult{
		Lat: lat, Lng: lng,
		Address:  fmt.Sprintf("%.5f, %.5f (mock)", lat, lng),
		PlusCode: m.codec.Encode(lat, lng),
		Provider: m.name, Source: m.source, Cacheable: false, // never cache synthetic results
		Confidence: 0.9, H3Cell: PointCellKey(lat, lng),
	}, nil
}

func (m *MockProvider) Autocomplete(_ context.Context, query, _ string, _ *Point) ([]Suggestion, error) {
	if query == "" {
		return nil, ErrEmptyQuery
	}
	lat, lng := pseudoPoint(query)
	return []Suggestion{
		{Label: query + ", Lagos, Nigeria (mock)", Lat: lat, Lng: lng, HasCoords: true, Provider: m.name, Source: m.source, Confidence: 0.9},
		{Label: query + " Extension, Lagos, Nigeria (mock)", Provider: m.name, Source: m.source, Confidence: 0.7},
	}, nil
}

func (m *MockProvider) SearchPlaces(_ context.Context, query string, near *Point) ([]Place, error) {
	if query == "" {
		return nil, ErrEmptyQuery
	}
	lat, lng := pseudoPoint(query)
	if near != nil {
		lat, lng = near.Lat+0.001, near.Lng+0.001
	}
	return []Place{
		{Name: query + " (mock POI)", Lat: lat, Lng: lng, Category: "point_of_interest", Provider: m.name, Source: m.source},
	}, nil
}

func (m *MockProvider) Route(_ context.Context, origin, dest Point, _ RouteOptions) (Route, error) {
	road := haversineM(origin, dest) * 1.3
	dur := road / m.avgSpeedMPS
	return Route{
		DistanceM: int(math.Round(road)),
		DurationS: int(math.Round(dur)),
		Polyline:  fmt.Sprintf("mock:%.5f,%.5f;%.5f,%.5f", origin.Lat, origin.Lng, dest.Lat, dest.Lng),
		Provider:  m.name, Source: m.source,
	}, nil
}

func (m *MockProvider) Matrix(ctx context.Context, origins, dests []Point) (Matrix, error) {
	rows := make([][]MatrixCell, len(origins))
	for i, o := range origins {
		row := make([]MatrixCell, len(dests))
		for j, d := range dests {
			r, _ := m.Route(ctx, o, d, RouteOptions{})
			row[j] = MatrixCell{DistanceM: r.DistanceM, DurationS: r.DurationS}
		}
		rows[i] = row
	}
	return Matrix{Rows: rows, Provider: m.name, Source: m.source}, nil
}

func (m *MockProvider) MatchToRoad(_ context.Context, trace []Point) (Polyline, error) {
	snapped := make([]Point, len(trace))
	for i, p := range trace {
		snapped[i] = Point{Lat: p.Lat, Lng: p.Lng, Source: m.source}
	}
	return Polyline{Points: snapped, Provider: m.name, Source: m.source}, nil
}

// Ensure MockProvider satisfies every adapter role.
var (
	_ TileProvider   = (*MockProvider)(nil)
	_ Geocoder       = (*MockProvider)(nil)
	_ Autocompleter  = (*MockProvider)(nil)
	_ PlaceSearcher  = (*MockProvider)(nil)
	_ Router         = (*MockProvider)(nil)
	_ Matrixer       = (*MockProvider)(nil)
	_ MapMatcher     = (*MockProvider)(nil)
)
