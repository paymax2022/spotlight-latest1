// Package maps is a provider-agnostic Maps abstraction ("MapService").
//
// The entire app calls map primitives through ONE interface (MapService). Which
// concrete provider serves each primitive is decided by config per
// environment/surface, so swapping a provider is a config change — not a code
// change.
//
// Hard rules enforced in this package (see guards.go, cache.go, usage.go):
//  1. License coherence — Google geocoding/Places results are NEVER persisted
//     and are NEVER rendered on the OpenStack/MapLibre basemap.
//  2. Single legitimate key per provider — no multi-key/account rotation.
//  3. Keys are server-side only — the client calls this backend, not providers.
//  4. Caching — only OpenStack (OSM-licensed) geocode/reverse results are cached.
package maps

import (
	"context"
	"errors"
)

// Source identifies which licensing stack a coordinate/result originated from.
// It travels with every GeoResult/Point so the cache writer and the renderer
// guard can enforce license coherence at runtime.
type Source string

const (
	// SourceOpenStack — OSM-licensed (Geoapify/Nominatim/OSRM/MapTiler).
	// Cacheable, and safe to render on the MapLibre/OpenStack basemap.
	SourceOpenStack Source = "openstack"
	// SourceGoogle — Google Geocoding/Places. NOT cacheable, and may ONLY be
	// shown on a Google basemap on the surface that produced it.
	SourceGoogle Source = "google"
	// SourceMapbox — optional Mapbox (static images / map-match fallback).
	SourceMapbox Source = "mapbox"
	// SourceOwn — derived from our own PostGIS records (always safe).
	SourceOwn Source = "own"
)

// Primitive is one of the MapService capabilities. The config map routes each
// primitive (optionally per surface) to a provider.
type Primitive string

const (
	PrimBasemap      Primitive = "basemap"
	PrimAutocomplete Primitive = "autocomplete"
	PrimGeocode      Primitive = "geocode"
	PrimReverse      Primitive = "reverse"
	PrimPlaces       Primitive = "places"
	PrimRoute        Primitive = "route"
	PrimMatrix       Primitive = "matrix"
	PrimMatchToRoad  Primitive = "matchToRoad"
	// findNearbyOwn and isInZone are intentionally NOT primitives: they run on
	// PostGIS only and are never routed to a maps provider.
)

// Point is a WGS84 geographic coordinate. Source tags where it came from.
type Point struct {
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
	Source Source  `json:"source,omitempty"`
}

// GeoResult is the normalized output of geocode / reverseGeocode.
type GeoResult struct {
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Address  string  `json:"address"`
	PlusCode string  `json:"plus_code"`
	Provider string  `json:"provider"`
	Source   Source  `json:"source"`
	// Cacheable is false for Google-sourced results. The cache writer refuses
	// to persist any result where Cacheable is false (license coherence).
	Cacheable bool `json:"cacheable"`
}

// Point returns the coordinate carried by a GeoResult, tagged with its source.
func (g GeoResult) Point() Point { return Point{Lat: g.Lat, Lng: g.Lng, Source: g.Source} }

// Suggestion is one address autocomplete candidate.
type Suggestion struct {
	Label       string  `json:"label"`
	PlaceID     string  `json:"place_id,omitempty"`
	Lat         float64 `json:"lat,omitempty"`
	Lng         float64 `json:"lng,omitempty"`
	Provider    string  `json:"provider"`
	Source      Source  `json:"source"`
	// HasCoords is true when the suggestion already carries a usable pin.
	HasCoords bool `json:"has_coords"`
}

// Place is one external (world) POI from a third-party place search.
type Place struct {
	Name     string  `json:"name"`
	Address  string  `json:"address,omitempty"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Category string  `json:"category,omitempty"`
	PlaceID  string  `json:"place_id,omitempty"`
	Provider string  `json:"provider"`
	Source   Source  `json:"source"`
}

// Route is geometry + ETA for an origin→destination request.
type Route struct {
	DistanceM int     `json:"distance_m"`
	DurationS int     `json:"duration_s"`
	Polyline  string  `json:"polyline"` // encoded polyline (geometry)
	Provider  string  `json:"provider"`
	Source    Source  `json:"source"`
	Degraded  bool    `json:"degraded,omitempty"` // true if served by a fallback provider
}

// MatrixCell is one origin→destination pairing in a distance matrix.
type MatrixCell struct {
	DistanceM int `json:"distance_m"`
	DurationS int `json:"duration_s"`
}

// Matrix is a many-to-many ETA/distance grid for dispatch.
type Matrix struct {
	Rows     [][]MatrixCell `json:"rows"` // Rows[i][j] = origins[i] → dests[j]
	Provider string         `json:"provider"`
	Source   Source         `json:"source"`
}

// Polyline is a snapped (map-matched) trace for live tracking.
type Polyline struct {
	Points   []Point `json:"points"`
	Encoded  string  `json:"encoded,omitempty"`
	Provider string  `json:"provider"`
	Source   Source  `json:"source"`
}

// StyleConfig is what the client needs to render a basemap with MapLibre GL.
type StyleConfig struct {
	StyleURL    string `json:"style_url"`
	Attribution string `json:"attribution"`
	Provider    string `json:"provider"`
	Source      Source `json:"source"`
}

// OwnEntity is one of OUR records returned by findNearbyOwn (PostGIS).
type OwnEntity struct {
	EntityID   string  `json:"entity_id"`
	EntityType string  `json:"entity_type"`
	Lat        float64 `json:"lat"`
	Lng        float64 `json:"lng"`
	PlusCode   string  `json:"plus_code,omitempty"`
	DistanceM  float64 `json:"distance_m"`
}

// RouteOptions tunes a routing request.
type RouteOptions struct {
	Profile string `json:"profile,omitempty"` // driving|cycling|walking; default driving
}

// PlusCodec encodes/decodes Open Location Codes (Plus Codes).
type PlusCodec interface {
	Encode(lat, lng float64) string
	Decode(code string) (Point, error)
}

// Errors surfaced by the service/adapters.
var (
	ErrEmptyQuery        = errors.New("maps: empty query")
	ErrNoProvider        = errors.New("maps: no provider configured for primitive")
	ErrLicenseCoherence  = errors.New("maps: license coherence violation — google-sourced point cannot be rendered on the OpenStack basemap")
	ErrNotCacheable      = errors.New("maps: refusing to cache a non-OpenStack (non-OSM) result")
	ErrCapExceeded       = errors.New("maps: provider soft cap reached")
)

// MapService is the single interface the whole app depends on. Each method is
// routed to a provider by config; findNearbyOwn / isInZone run on PostGIS.
type MapService interface {
	GetBasemapConfig(ctx context.Context, surface string) (StyleConfig, error)
	AutocompleteAddress(ctx context.Context, query, sessionToken, surface string, near *Point) ([]Suggestion, error)
	Geocode(ctx context.Context, address, surface string) (GeoResult, error)
	ReverseGeocode(ctx context.Context, lat, lng float64, surface string) (GeoResult, error)
	SearchExternalPlaces(ctx context.Context, query string, near *Point) ([]Place, error)
	FindNearbyOwn(ctx context.Context, entityType string, p Point, radiusM float64, limit int) ([]OwnEntity, error)
	GetRoute(ctx context.Context, origin, dest Point, opts RouteOptions) (Route, error)
	GetDistanceMatrix(ctx context.Context, origins, dests []Point) (Matrix, error)
	MatchToRoad(ctx context.Context, gpsTrace []Point) (Polyline, error)
	IsInZone(ctx context.Context, p Point, zoneID string) (bool, error)
	PlusCode() PlusCodec
}
