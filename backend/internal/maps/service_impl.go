package maps

import (
	"context"
	"fmt"
	"log"
	"time"

	platformRedis "spotlight/backend/internal/platform/redis"
)

// GeocodeCache is the cache seam the router depends on (PostGIS Cache in prod,
// a fake in tests). Only OSM-licensed results are ever written (guarded in Put).
type GeocodeCache interface {
	Get(ctx context.Context, normalized string) (GeoResult, bool)
	Put(ctx context.Context, normalized string, r GeoResult) error
}

// CapGuard is the cost-guard seam: record usage, decide soft-cap degradation,
// and expose metrics. UsageTracker implements it in prod; a fake in tests can
// force OverSoftCap to exercise graceful degradation deterministically.
type CapGuard interface {
	Record(ctx context.Context, provider string, primitive Primitive) int64
	OverSoftCap(ctx context.Context, provider string, primitive Primitive) bool
	Snapshot(ctx context.Context) ([]UsageRow, error)
}

// Service is the config-driven implementation of MapService. It is a ROUTER:
// every primitive is dispatched to the provider named by SurfaceConfig, with
// cache-first geocoding, cost-guard degradation, and license guards applied
// centrally. Feature code depends only on the MapService interface.
type Service struct {
	cfg            SurfaceConfig
	reg            *Registry
	cache          GeocodeCache
	repo           GeoRepo
	usage          CapGuard
	redis          *platformRedis.Client // optional; idempotency dedupe
	codec          PlusCodec
	defaultSurface string
}

// Deps groups the collaborators for NewService.
type Deps struct {
	Config         SurfaceConfig
	Registry       *Registry
	Cache          GeocodeCache
	Repo           GeoRepo
	Usage          CapGuard
	Redis          *platformRedis.Client
	DefaultSurface string
}

type nopCache struct{}

func (nopCache) Get(context.Context, string) (GeoResult, bool) { return GeoResult{}, false }
func (nopCache) Put(context.Context, string, GeoResult) error  { return nil }

type nopUsage struct{}

func (nopUsage) Record(context.Context, string, Primitive) int64     { return 0 }
func (nopUsage) OverSoftCap(context.Context, string, Primitive) bool { return false }
func (nopUsage) Snapshot(context.Context) ([]UsageRow, error)        { return []UsageRow{}, nil }

// NewService wires the router.
func NewService(d Deps) *Service {
	surface := d.DefaultSurface
	if surface == "" {
		surface = "default"
	}
	var cache GeocodeCache = d.Cache
	if d.Cache == nil {
		cache = nopCache{}
	}
	var usage CapGuard = d.Usage
	if d.Usage == nil {
		usage = nopUsage{}
	}
	return &Service{
		cfg: d.Config, reg: d.Registry, cache: cache, repo: d.Repo,
		usage: usage, redis: d.Redis, codec: NewPlusCodec(), defaultSurface: surface,
	}
}

// IdempotentFirst reports whether idemKey is being seen for the first time
// (best-effort, Redis-backed, 10-minute window). An empty key or no Redis returns
// true (proceed). Used by the /locations mutation to dedupe retries.
func (s *Service) IdempotentFirst(ctx context.Context, idemKey string) bool {
	if idemKey == "" || s.redis == nil {
		return true
	}
	ok, err := platformRedis.SetNX(ctx, s.redis, "maps:idem:"+idemKey, "1", 10*time.Minute)
	if err != nil {
		return true // fail-open — never block a write on cache errors
	}
	return ok
}

func (s *Service) surfaceOr(surface string) string {
	if surface == "" {
		return s.defaultSurface
	}
	return surface
}

func (s *Service) PlusCode() PlusCodec { return s.codec }

// resolve returns the provider to use for a primitive on a surface, degrading to
// the configured fallback when the primary has hit its monthly soft cap. This is
// the cost guard's graceful-degradation decision — it never switches keys.
func (s *Service) resolve(ctx context.Context, primitive Primitive, surface string) (string, bool, error) {
	primary, ok := s.cfg.providerFor(primitive, surface)
	if !ok {
		return "", false, fmt.Errorf("%w: %s", ErrNoProvider, primitive)
	}
	if s.usage.OverSoftCap(ctx, primary, primitive) {
		if fb, ok := s.cfg.fallbackFor(primitive); ok && fb != primary {
			log.Printf("[maps] %s at soft cap on %s — degrading to %s", primary, primitive, fb)
			mx.degradationInc(string(primitive))
			return fb, true, nil
		}
	}
	return primary, false, nil
}

// GetBasemapConfig returns the MapLibre style + attribution for a surface.
func (s *Service) GetBasemapConfig(ctx context.Context, surface string) (StyleConfig, error) {
	surface = s.surfaceOr(surface)
	provider, _, err := s.resolve(ctx, PrimBasemap, surface)
	if err != nil {
		return StyleConfig{}, err
	}
	tp, ok := s.reg.Tiles[provider]
	if !ok {
		return StyleConfig{}, fmt.Errorf("%w: tiles/%s", ErrNoProvider, provider)
	}
	s.usage.Record(ctx, provider, PrimBasemap)
	return tp.BasemapConfig(ctx, surface)
}

// Geocode resolves an address. Cache-first (OpenStack only): we consult PostGIS
// before calling any provider, and persist only cacheable (OSM) results.
func (s *Service) Geocode(ctx context.Context, address, surface string) (GeoResult, error) {
	if address == "" {
		return GeoResult{}, ErrEmptyQuery
	}
	surface = s.surfaceOr(surface)
	key := NormalizeQuery(address)

	if hit, ok := s.cache.Get(ctx, key); ok {
		mx.cacheHitInc()
		return hit, nil // cache hit — no provider call, no usage
	}
	mx.cacheMissInc()

	provider, _, err := s.resolve(ctx, PrimGeocode, surface)
	if err != nil {
		return GeoResult{}, err
	}
	gc, ok := s.reg.Geocoders[provider]
	if !ok {
		return GeoResult{}, fmt.Errorf("%w: geocoder/%s", ErrNoProvider, provider)
	}
	s.usage.Record(ctx, provider, PrimGeocode)
	res, err := gc.Geocode(ctx, address)
	if err != nil {
		return GeoResult{}, err
	}
	if res.PlusCode == "" {
		res.PlusCode = s.codec.Encode(res.Lat, res.Lng)
	}
	// Persist only OSM-licensed results; cache.Put refuses anything else.
	if res.Cacheable {
		if err := s.cache.Put(ctx, key, res); err != nil {
			log.Printf("[maps] cache put skipped: %v", err)
		}
	}
	return res, nil
}

// ReverseGeocode resolves a coordinate to an address (cache-first, OSM only).
func (s *Service) ReverseGeocode(ctx context.Context, lat, lng float64, surface string) (GeoResult, error) {
	surface = s.surfaceOr(surface)
	key := NormalizeQuery(fmt.Sprintf("%.5f,%.5f", lat, lng))

	if hit, ok := s.cache.Get(ctx, key); ok {
		mx.cacheHitInc()
		return hit, nil
	}
	mx.cacheMissInc()
	provider, _, err := s.resolve(ctx, PrimReverse, surface)
	if err != nil {
		return GeoResult{}, err
	}
	gc, ok := s.reg.Geocoders[provider]
	if !ok {
		return GeoResult{}, fmt.Errorf("%w: geocoder/%s", ErrNoProvider, provider)
	}
	s.usage.Record(ctx, provider, PrimReverse)
	res, err := gc.ReverseGeocode(ctx, lat, lng)
	if err != nil {
		return GeoResult{}, err
	}
	if res.PlusCode == "" {
		res.PlusCode = s.codec.Encode(res.Lat, res.Lng)
	}
	if res.Cacheable {
		if err := s.cache.Put(ctx, key, res); err != nil {
			log.Printf("[maps] cache put skipped: %v", err)
		}
	}
	return res, nil
}

// AutocompleteAddress returns suggestions, degrading paid providers at soft cap.
func (s *Service) AutocompleteAddress(ctx context.Context, query, sessionToken, surface string, near *Point) ([]Suggestion, error) {
	if query == "" {
		return nil, ErrEmptyQuery
	}
	surface = s.surfaceOr(surface)
	provider, degraded, err := s.resolve(ctx, PrimAutocomplete, surface)
	if err != nil {
		return nil, err
	}
	ac, ok := s.reg.Autocompleters[provider]
	if !ok {
		return nil, fmt.Errorf("%w: autocomplete/%s", ErrNoProvider, provider)
	}
	s.usage.Record(ctx, provider, PrimAutocomplete)
	out, err := ac.Autocomplete(ctx, query, sessionToken, near)
	if err != nil && !degraded {
		// Provider error → degrade to OpenStack autocomplete (never hard-fail).
		if fb, ok := s.cfg.fallbackFor(PrimAutocomplete); ok && fb != provider {
			if ac2, ok := s.reg.Autocompleters[fb]; ok {
				log.Printf("[maps] autocomplete %s failed (%v) — degrading to %s", provider, err, fb)
				s.usage.Record(ctx, fb, PrimAutocomplete)
				return ac2.Autocomplete(ctx, query, sessionToken, near)
			}
		}
	}
	return out, err
}

// SearchExternalPlaces returns world POIs, degrading at soft cap / on error.
func (s *Service) SearchExternalPlaces(ctx context.Context, query string, near *Point) ([]Place, error) {
	if query == "" {
		return nil, ErrEmptyQuery
	}
	provider, degraded, err := s.resolve(ctx, PrimPlaces, s.defaultSurface)
	if err != nil {
		return nil, err
	}
	ps, ok := s.reg.PlaceSearchers[provider]
	if !ok {
		return nil, fmt.Errorf("%w: places/%s", ErrNoProvider, provider)
	}
	s.usage.Record(ctx, provider, PrimPlaces)
	out, err := ps.SearchPlaces(ctx, query, near)
	if err != nil && !degraded {
		if fb, ok := s.cfg.fallbackFor(PrimPlaces); ok && fb != provider {
			if ps2, ok := s.reg.PlaceSearchers[fb]; ok {
				log.Printf("[maps] places %s failed (%v) — degrading to %s", provider, err, fb)
				s.usage.Record(ctx, fb, PrimPlaces)
				return ps2.SearchPlaces(ctx, query, near)
			}
		}
	}
	return out, err
}

// GetRoute computes a single route, degrading on cap/error.
func (s *Service) GetRoute(ctx context.Context, origin, dest Point, opts RouteOptions) (Route, error) {
	provider, degraded, err := s.resolve(ctx, PrimRoute, s.defaultSurface)
	if err != nil {
		return Route{}, err
	}
	rt, ok := s.reg.Routers[provider]
	if !ok {
		return Route{}, fmt.Errorf("%w: route/%s", ErrNoProvider, provider)
	}
	s.usage.Record(ctx, provider, PrimRoute)
	out, err := rt.Route(ctx, origin, dest, opts)
	if err != nil && !degraded {
		if fb, ok := s.cfg.fallbackFor(PrimRoute); ok && fb != provider {
			if rt2, ok := s.reg.Routers[fb]; ok {
				s.usage.Record(ctx, fb, PrimRoute)
				out, err = rt2.Route(ctx, origin, dest, opts)
				out.Degraded = true
			}
		}
	}
	out.Degraded = out.Degraded || degraded
	return out, err
}

// GetDistanceMatrix computes a many-to-many ETA/distance grid for dispatch.
func (s *Service) GetDistanceMatrix(ctx context.Context, origins, dests []Point) (Matrix, error) {
	if len(origins) == 0 || len(dests) == 0 {
		return Matrix{}, fmt.Errorf("maps: matrix needs origins and destinations")
	}
	provider, degraded, err := s.resolve(ctx, PrimMatrix, s.defaultSurface)
	if err != nil {
		return Matrix{}, err
	}
	mx, ok := s.reg.Matrixers[provider]
	if !ok {
		return Matrix{}, fmt.Errorf("%w: matrix/%s", ErrNoProvider, provider)
	}
	s.usage.Record(ctx, provider, PrimMatrix)
	out, err := mx.Matrix(ctx, origins, dests)
	if err != nil && !degraded {
		if fb, ok := s.cfg.fallbackFor(PrimMatrix); ok && fb != provider {
			if mx2, ok := s.reg.Matrixers[fb]; ok {
				s.usage.Record(ctx, fb, PrimMatrix)
				return mx2.Matrix(ctx, origins, dests)
			}
		}
	}
	return out, err
}

// MatchToRoad snaps a GPS trace to the road network (live tracking).
func (s *Service) MatchToRoad(ctx context.Context, gpsTrace []Point) (Polyline, error) {
	provider, degraded, err := s.resolve(ctx, PrimMatchToRoad, s.defaultSurface)
	if err != nil {
		return Polyline{}, err
	}
	mm, ok := s.reg.MapMatchers[provider]
	if !ok {
		return Polyline{}, fmt.Errorf("%w: match/%s", ErrNoProvider, provider)
	}
	s.usage.Record(ctx, provider, PrimMatchToRoad)
	out, err := mm.MatchToRoad(ctx, gpsTrace)
	if err != nil && !degraded {
		if fb, ok := s.cfg.fallbackFor(PrimMatchToRoad); ok && fb != provider {
			if mm2, ok := s.reg.MapMatchers[fb]; ok {
				s.usage.Record(ctx, fb, PrimMatchToRoad)
				return mm2.MatchToRoad(ctx, gpsTrace)
			}
		}
	}
	return out, err
}

// FindNearbyOwn returns OUR records near a point — PostGIS, never a maps API.
func (s *Service) FindNearbyOwn(ctx context.Context, entityType string, p Point, radiusM float64, limit int) ([]OwnEntity, error) {
	if s.repo == nil {
		return nil, fmt.Errorf("maps: no geo repo configured")
	}
	return s.repo.NearbyOwn(ctx, entityType, p, radiusM, limit)
}

// IsInZone reports whether a point is inside a service-area polygon — PostGIS.
func (s *Service) IsInZone(ctx context.Context, p Point, zoneID string) (bool, error) {
	if s.repo == nil {
		return false, fmt.Errorf("maps: no geo repo configured")
	}
	return s.repo.InZone(ctx, p, zoneID)
}

// UsageSnapshot exposes the current month's usage rows for the metrics endpoint.
func (s *Service) UsageSnapshot(ctx context.Context) ([]UsageRow, error) {
	return s.usage.Snapshot(ctx)
}

// Repo exposes the geo repo (used by the handler to persist confirmed pins).
func (s *Service) Repo() GeoRepo { return s.repo }

var _ MapService = (*Service)(nil)
