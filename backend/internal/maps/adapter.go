package maps

import "context"

// The provider interfaces below are intentionally small and per-primitive: a
// provider implements ONLY the capabilities it actually serves. The config map
// ({primitive -> provider}) decides which provider's method the router calls.
//
// This is what makes the layer provider-agnostic: feature code calls MapService;
// MapService dispatches to one of these by config; swapping a provider for a
// primitive is a config edit, never a code change.

// Named is implemented by every adapter so usage/metrics + logs can identify it.
type Named interface {
	// Name returns a stable provider id, e.g. "geoapify", "osrm", "google".
	Name() string
}

// TileProvider serves a MapLibre GL style + attribution for the basemap.
type TileProvider interface {
	Named
	BasemapConfig(ctx context.Context, surface string) (StyleConfig, error)
}

// Geocoder resolves an address to a coordinate and the reverse.
type Geocoder interface {
	Named
	Geocode(ctx context.Context, address string) (GeoResult, error)
	ReverseGeocode(ctx context.Context, lat, lng float64) (GeoResult, error)
}

// Autocompleter returns address suggestions for a partial query.
type Autocompleter interface {
	Named
	Autocomplete(ctx context.Context, query, sessionToken string, near *Point) ([]Suggestion, error)
}

// PlaceSearcher searches world POIs (third-party data).
type PlaceSearcher interface {
	Named
	SearchPlaces(ctx context.Context, query string, near *Point) ([]Place, error)
}

// Router computes a single origin→destination route.
type Router interface {
	Named
	Route(ctx context.Context, origin, dest Point, opts RouteOptions) (Route, error)
}

// Matrixer computes a many-to-many distance/ETA matrix.
type Matrixer interface {
	Named
	Matrix(ctx context.Context, origins, dests []Point) (Matrix, error)
}

// MapMatcher snaps a raw GPS trace to the road network.
type MapMatcher interface {
	Named
	MatchToRoad(ctx context.Context, trace []Point) (Polyline, error)
}

// Registry holds the concrete adapters available in this process. A provider may
// appear under several roles (e.g. an OpenStack adapter is both Router and
// Matrixer). The config map references providers by Name().
type Registry struct {
	Tiles         map[string]TileProvider
	Geocoders     map[string]Geocoder
	Autocompleters map[string]Autocompleter
	PlaceSearchers map[string]PlaceSearcher
	Routers       map[string]Router
	Matrixers     map[string]Matrixer
	MapMatchers   map[string]MapMatcher
}

// NewRegistry returns an empty registry with initialized maps.
func NewRegistry() *Registry {
	return &Registry{
		Tiles:          map[string]TileProvider{},
		Geocoders:      map[string]Geocoder{},
		Autocompleters: map[string]Autocompleter{},
		PlaceSearchers: map[string]PlaceSearcher{},
		Routers:        map[string]Router{},
		Matrixers:      map[string]Matrixer{},
		MapMatchers:    map[string]MapMatcher{},
	}
}

// AddTiles registers a basemap/tile provider.
func (r *Registry) AddTiles(p TileProvider) { r.Tiles[p.Name()] = p }

// AddGeocoder registers a geocoder.
func (r *Registry) AddGeocoder(p Geocoder) { r.Geocoders[p.Name()] = p }

// AddAutocompleter registers an autocompleter.
func (r *Registry) AddAutocompleter(p Autocompleter) { r.Autocompleters[p.Name()] = p }

// AddPlaceSearcher registers a place searcher.
func (r *Registry) AddPlaceSearcher(p PlaceSearcher) { r.PlaceSearchers[p.Name()] = p }

// AddRouter registers a router.
func (r *Registry) AddRouter(p Router) { r.Routers[p.Name()] = p }

// AddMatrixer registers a matrixer.
func (r *Registry) AddMatrixer(p Matrixer) { r.Matrixers[p.Name()] = p }

// AddMapMatcher registers a map-matcher.
func (r *Registry) AddMapMatcher(p MapMatcher) { r.MapMatchers[p.Name()] = p }
