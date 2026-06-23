package transport

import (
	"context"
	"fmt"
	"math"
)

// LatLng is a geographic coordinate.
type LatLng struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// RouteResult is the outcome of a routing query.
type RouteResult struct {
	DistanceM int    `json:"distance_m"`
	DurationS int    `json:"duration_s"`
	Polyline  string `json:"polyline"`
}

// MapsAdapter abstracts the geo/routing provider. Business logic depends only on
// this interface; the concrete provider (mock now, Google/Mapbox later) is injected.
type MapsAdapter interface {
	Geocode(ctx context.Context, address string) (LatLng, error)
	Route(ctx context.Context, from, to LatLng) (RouteResult, error)
	ETA(ctx context.Context, from, to LatLng) (int, error) // seconds
	DistanceMatrix(ctx context.Context, origins, destinations []LatLng) ([][]RouteResult, error)
}

// MockMaps is a deterministic adapter: haversine distance + fixed average speed.
// It never makes network calls, so it is safe for dev, CI, and unit tests.
type MockMaps struct {
	// AvgSpeedMPS is the assumed average speed in metres/second (default ~30 km/h).
	AvgSpeedMPS float64
}

// NewMockMaps returns a MockMaps with sane defaults.
func NewMockMaps() *MockMaps {
	return &MockMaps{AvgSpeedMPS: 8.33} // ~30 km/h
}

const earthRadiusM = 6371000.0

// haversineM returns the great-circle distance between two points in metres.
func haversineM(a, b LatLng) float64 {
	lat1 := a.Lat * math.Pi / 180
	lat2 := b.Lat * math.Pi / 180
	dLat := (b.Lat - a.Lat) * math.Pi / 180
	dLng := (b.Lng - a.Lng) * math.Pi / 180
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusM * math.Asin(math.Min(1, math.Sqrt(h)))
}

// Geocode returns a deterministic pseudo-coordinate derived from the address string.
// Real adapters call a geocoding API; the mock just needs stable, distinct output.
func (m *MockMaps) Geocode(_ context.Context, address string) (LatLng, error) {
	if address == "" {
		return LatLng{}, fmt.Errorf("transport: empty address")
	}
	var sum int
	for _, r := range address {
		sum += int(r)
	}
	// Centre roughly on Lagos and spread deterministically.
	lat := 6.45 + float64(sum%1000)/10000.0
	lng := 3.39 + float64((sum*7)%1000)/10000.0
	return LatLng{Lat: lat, Lng: lng}, nil
}

// Route returns haversine distance, derived duration, and a trivial polyline.
func (m *MockMaps) Route(_ context.Context, from, to LatLng) (RouteResult, error) {
	dist := haversineM(from, to)
	// Apply a 1.3 road-factor so straight-line distance approximates a real route.
	roadDist := dist * 1.3
	speed := m.AvgSpeedMPS
	if speed <= 0 {
		speed = 8.33
	}
	dur := roadDist / speed
	return RouteResult{
		DistanceM: int(math.Round(roadDist)),
		DurationS: int(math.Round(dur)),
		Polyline:  fmt.Sprintf("mock:%.5f,%.5f;%.5f,%.5f", from.Lat, from.Lng, to.Lat, to.Lng),
	}, nil
}

// ETA returns the duration component of a route, in seconds.
func (m *MockMaps) ETA(ctx context.Context, from, to LatLng) (int, error) {
	r, err := m.Route(ctx, from, to)
	if err != nil {
		return 0, err
	}
	return r.DurationS, nil
}

// DistanceMatrix routes every origin against every destination.
func (m *MockMaps) DistanceMatrix(ctx context.Context, origins, destinations []LatLng) ([][]RouteResult, error) {
	out := make([][]RouteResult, len(origins))
	for i, o := range origins {
		row := make([]RouteResult, len(destinations))
		for j, d := range destinations {
			r, err := m.Route(ctx, o, d)
			if err != nil {
				return nil, err
			}
			row[j] = r
		}
		out[i] = row
	}
	return out, nil
}
