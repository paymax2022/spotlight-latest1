// Package maps is a provider-agnostic Maps abstraction ("MapService").
// The entire app calls map primitives through ONE interface (MapService). Which
// concrete provider serves each primitive is decided by config per
// environment/surface, so swapping a provider is a config change — not a code
// change.
// Hard rules enforced in this package (see ):
//  1. License coherence — Google geocoding/Places results are NEVER persisted
//     and are NEVER rendered on the OpenStack/MapLibre basemap.
//  2. Single legitimate key per provider — no multi-key/account rotation.
//  3. Keys are server-side only — the client calls this backend, not providers.
//  4. Caching — only OpenStack (OSM-licensed) geocode/reverse results are cached.
package maps

import (
	"context"
	"errors"
	"time"
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
	// SourceHere — HERE Technologies (accuracy fallback alongside Google).
	// NOT cacheable on the OSM cache; treated like Google for license coherence.
	SourceHere Source = "here"
	// SourceGazetteer — our verified PrivateGazetteer points (always safe, zero cost).
	SourceGazetteer Source = "gazetteer"
	// SourceCache — served from the AddressCache (OSM-licensed write-through).
	SourceCache Source = "cache"
	// SourcePrediction — predicted from the user's own history (zero external cost).
	SourcePrediction Source = "prediction"
)

// Confidence is a normalized 0..1 quality signal comparable across providers.
// Each adapter maps its native quality signal (Nominatim importance/place_rank,
// Google location_type/partial_match, HERE scoring.queryScore) into this range
// so the orchestrator can compare apples to apples (MAPSERVICE.md §3).
type Confidence = float64

// CoverageTier classifies how well-mapped an H3 area is. It decides whether the
// cheap OSM path or the accuracy (Google/HERE) path goes first (MAPSERVICE.md §5).
type CoverageTier string

const (
	TierGood CoverageTier = "GOOD" // well-mapped → OSM first
	TierFair CoverageTier = "FAIR" // mixed → OSM first, escalate readily
	TierLow  CoverageTier = "LOW"  // informal/low-coverage → accuracy (Google/HERE) first
)

// Capset declares which primitives a provider can serve, so the orchestrator can
// skip providers that cannot serve a request type (MAPSERVICE.md §3).
type Capset struct {
	Geocode      bool
	Reverse      bool
	Autocomplete bool
	Route        bool
	Matrix       bool
	TrafficAware bool // google/here yes; osrm no
}

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
	// Confidence is the normalized 0..1 quality signal (set by the adapter).
	Confidence Confidence `json:"confidence,omitempty"`
	// H3Cell is the spatial cell key for this coordinate (coverage/gazetteer/cache).
	H3Cell string `json:"h3_cell,omitempty"`
	// Partial is true when the provider reports an approximate / partial match.
	Partial bool `json:"partial,omitempty"`
}

// Point returns the coordinate carried by a GeoResult, tagged with its source.
func (g GeoResult) Point() Point { return Point{Lat: g.Lat, Lng: g.Lng, Source: g.Source} }

// Suggestion is one address autocomplete candidate.
type Suggestion struct {
	Label    string  `json:"label"`
	PlaceID  string  `json:"place_id,omitempty"`
	Lat      float64 `json:"lat,omitempty"`
	Lng      float64 `json:"lng,omitempty"`
	Provider string  `json:"provider"`
	Source   Source  `json:"source"`
	// HasCoords is true when the suggestion already carries a usable pin.
	HasCoords bool `json:"has_coords"`
	// Confidence is the normalized 0..1 quality signal (v2; additive).
	Confidence Confidence `json:"confidence,omitempty"`
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
	DistanceM int    `json:"distance_m"`
	DurationS int    `json:"duration_s"`
	Polyline  string `json:"polyline"` // encoded polyline (geometry)
	Provider  string `json:"provider"`
	Source    Source `json:"source"`
	Degraded  bool   `json:"degraded,omitempty"` // true if served by a fallback provider
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
	// TrafficAware (v2) requests a live, traffic-aware ETA. OSRM/Valhalla ignore
	// it (batch/planning); the orchestrator routes traffic-aware requests to
	// Google/HERE on active trips/deliveries (MAPSERVICE.md §4).
	TrafficAware bool `json:"traffic_aware,omitempty"`
}

// PlusCodec encodes/decodes Open Location Codes (Plus Codes).
type PlusCodec interface {
	Encode(lat, lng float64) string
	Decode(code string) (Point, error)
}

// Errors surfaced by the service/adapters.
var (
	ErrEmptyQuery       = errors.New("maps: empty query")
	ErrNoProvider       = errors.New("maps: no provider configured for primitive")
	ErrLicenseCoherence = errors.New("maps: license coherence violation — google-sourced point cannot be rendered on the OpenStack basemap")
	ErrNotCacheable     = errors.New("maps: refusing to cache a non-OpenStack (non-OSM) result")
	ErrCapExceeded      = errors.New("maps: provider soft cap reached")
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

// the Nigeria-tuned, cost-aware MapService v2 layer (MAPSERVICE.md).
// Everything here is ADDITIVE and gated by FeatureMapsV2Enabled: when the flag is
// off the legacy resolve() path runs unchanged. The orchestrator (orchestrator.go)
// ties these collaborators into the resolution chain (§4); concrete implementations
// are provided by the swarm and injected via Deps (all nil-safe).

// ErrNeedsPin signals the caller/courier should drop a precise pin — returned on
// low confidence or provider outage. Never a hard failure (MS-6, §2 principle 7).
var ErrNeedsPin = errors.New("maps: NEEDS_PIN — confidence below floor, drop a pin")

// ResolutionEvent is the deterministic, auditable record of one resolution
// (MAPSERVICE.md §9, MS-7). Logged for the cost/coverage dashboard.
type ResolutionEvent struct {
	ID           string       `json:"id"`
	RequestType  string       `json:"request_type"` // geocode | reverse | autocomplete | route ...
	Surface      string       `json:"surface"`
	H3Cell       string       `json:"h3_cell"`
	Tier         CoverageTier `json:"tier"`
	ChosenSource string       `json:"chosen_source"` // gazetteer | cache | prediction | osm | google | here
	Provider     string       `json:"provider"`
	Confidence   Confidence   `json:"confidence"`
	Escalated    bool         `json:"escalated"`   // true if we moved past the cheap path
	CostUnit     int          `json:"cost_unit"`   // 0 for deflected, 1 per paid call
	OutcomePin   bool         `json:"outcome_pin"` // true if it ended in NEEDS_PIN
	UserID       string       `json:"user_id"`
	TS           time.Time    `json:"ts"`
}

// GazetteerEntry is a verified internal point (MAPSERVICE.md §6/§9). PII-bearing;
// stays internal, encrypted, access-logged — NEVER uploaded to OSM (MS-4).
type GazetteerEntry struct {
	ID             string
	H3Cell         string
	Lat, Lng       float64
	NormalizedAddr string
	Components     string // JSON address components
	Source         string // courier_pin | user_saved | property | estate | agent
	VerifiedBy     string // user id
	VerifiedAt     time.Time
	PlusCode       string
}

// ContributionCandidate is a non-PII improvement queued for the OSM public
// pipeline (MAPSERVICE.md §7). PII must be stripped before it ever lands here.
type ContributionCandidate struct {
	ID          string    `json:"id"`
	H3Cell      string    `json:"h3_cell"`
	Geometry    string    `json:"geometry"` // GeoJSON, non-PII
	Type        string    `json:"type"`     // road | bus_stop | landmark | poi | building | area_name
	PIIStripped bool      `json:"pii_stripped"`
	Status      string    `json:"status"` // pending | approved | rejected | uploaded
	ReviewerID  string    `json:"reviewer_id"`
	CreatedAt   time.Time `json:"created_at"`
}

// GazetteerStore is the private, verified-points lookup checked FIRST (MS-2).
// All lookups/writes are access-logged; PII encrypted at rest (MS-4).
type GazetteerStore interface {
	// Lookup finds a verified point by normalized address within/near an H3 cell.
	Lookup(ctx context.Context, normalizedAddr, h3Cell string) (GeoResult, bool, error)
	// ReverseLookup finds a verified point near a coordinate's cell.
	ReverseLookup(ctx context.Context, h3Cell string, lat, lng float64) (GeoResult, bool, error)
	// Upsert records a confirmed location (courier pin, saved place, …).
	Upsert(ctx context.Context, e GazetteerEntry) error
}

// CoverageIndex decides provider order per area and self-improves from outcomes.
type CoverageIndex interface {
	// Tier returns the coverage tier for an H3 cell (default FAIR if unknown).
	Tier(ctx context.Context, h3Cell string) CoverageTier
	// Observe records a resolution outcome to evolve the tier over time
	// (escalations demote; confirmed pins / cheap successes promote).
	Observe(ctx context.Context, h3Cell, chosenSource string, escalated bool, conf Confidence) error
}

// Predictor deflects paid calls using the user's own history (MAPSERVICE.md §6).
type Predictor interface {
	Predict(ctx context.Context, userID, normalizedAddr string, near *Point) (GeoResult, bool, error)
}

// ResolutionRecorder persists ResolutionEvents for audit + the dashboard (MS-7).
type ResolutionRecorder interface {
	Record(ctx context.Context, e ResolutionEvent) error
}

// ProviderGuard enforces cost guardrails + circuit breaking (MS-6, §10).
type ProviderGuard interface {
	// Allow reports whether a provider may be called now (circuit closed + under budget).
	Allow(ctx context.Context, provider string, prim Primitive) bool
	// Observe records the outcome of a provider call (for breaker + health).
	Observe(ctx context.Context, provider string, ok bool, latencyMs int64)
}

type nopGazetteer struct{}

func (nopGazetteer) Lookup(context.Context, string, string) (GeoResult, bool, error) {
	return GeoResult{}, false, nil
}
func (nopGazetteer) ReverseLookup(context.Context, string, float64, float64) (GeoResult, bool, error) {
	return GeoResult{}, false, nil
}
func (nopGazetteer) Upsert(context.Context, GazetteerEntry) error { return nil }

type nopCoverage struct{}

func (nopCoverage) Tier(context.Context, string) CoverageTier { return TierFair }
func (nopCoverage) Observe(context.Context, string, string, bool, Confidence) error {
	return nil
}

type nopPredictor struct{}

func (nopPredictor) Predict(context.Context, string, string, *Point) (GeoResult, bool, error) {
	return GeoResult{}, false, nil
}

type nopRecorder struct{}

func (nopRecorder) Record(context.Context, ResolutionEvent) error { return nil }

type allowGuard struct{}

func (allowGuard) Allow(context.Context, string, Primitive) bool { return true }
func (allowGuard) Observe(context.Context, string, bool, int64)  {}
