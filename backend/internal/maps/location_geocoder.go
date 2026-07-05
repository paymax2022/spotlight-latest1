package maps

import (
	"context"
	"fmt"
)

// LocationGeocoder adapts the full MapService down to a minimal "address → pin"
// helper for modules (restaurant, estate, …) that just need to populate a
// coordinate from a typed address on write. Geocoding goes through MapService, so
// it is cache-first (PostGIS, OSM-licensed) and provider-swappable by config.
//
// Modules depend on their own tiny one-method interface and accept this adapter,
// so they never import provider details — only the maps package's seam.
type LocationGeocoder struct {
	svc     MapService
	surface string
}

// NewLocationGeocoder wraps a MapService for simple address→pin geocoding.
func NewLocationGeocoder(svc MapService) *LocationGeocoder {
	return &LocationGeocoder{svc: svc, surface: "default"}
}

// Geocode returns the resolved lat/lng + Plus Code for an address.
func (g *LocationGeocoder) Geocode(ctx context.Context, address string) (lat, lng float64, plusCode string, err error) {
	r, e := g.svc.Geocode(ctx, address, g.surface)
	if e != nil {
		return 0, 0, "", e
	}
	return r.Lat, r.Lng, r.PlusCode, nil
}

// RouteDistanceKmEta returns real driving distance (km) + ETA (minutes) between
// two pins via the configured matrix provider (Google Distance Matrix when
// configured). Used by delivery-fee pricing. Returns an error when no route is
// available so the caller can fall back to straight-line haversine.
func (g *LocationGeocoder) RouteDistanceKmEta(ctx context.Context, oLat, oLng, dLat, dLng float64) (km, etaMin float64, err error) {
	m, e := g.svc.GetDistanceMatrix(ctx,
		[]Point{{Lat: oLat, Lng: oLng}},
		[]Point{{Lat: dLat, Lng: dLng}},
	)
	if e != nil {
		return 0, 0, e
	}
	if len(m.Rows) == 0 || len(m.Rows[0]) == 0 {
		return 0, 0, fmt.Errorf("maps: empty distance matrix")
	}
	cell := m.Rows[0][0]
	if cell.DistanceM <= 0 {
		return 0, 0, fmt.Errorf("maps: no route between points")
	}
	return float64(cell.DistanceM) / 1000.0, float64(cell.DurationS) / 60.0, nil
}
