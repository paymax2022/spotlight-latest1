package maps

import "context"

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

// Geocode returns the resolved lat/lng + Plus Code for an address (OpenStack).
func (g *LocationGeocoder) Geocode(ctx context.Context, address string) (lat, lng float64, plusCode string, err error) {
	r, e := g.svc.Geocode(ctx, address, g.surface)
	if e != nil {
		return 0, 0, "", e
	}
	return r.Lat, r.Lng, r.PlusCode, nil
}
