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

// sourceCache is the optional extension a cache may implement to persist results
// with a per-source TTL and the v2 spatial columns (CacheV2 does). When the wired
// cache satisfies it, the orchestrator's write-through uses PutWithSource so the
// config_v2 per-source TTLs (cache_v2.go) actually take effect; otherwise it falls
// back to the fixed-TTL Put. A ttl<=0 means "use the per-source default".
type sourceCache interface {
	PutWithSource(ctx context.Context, normalized string, r GeoResult, ttl time.Duration) error
}

// cachePut writes a result through the cache, preferring per-source TTL when the
// cache supports it (CacheV2). Both paths enforce the SAME license guard, so
// behavior cannot diverge on what is or isn't cacheable — only the TTL differs.
func (s *Service) cachePut(ctx context.Context, normalized string, r GeoResult) error {
	if sc, ok := s.cache.(sourceCache); ok {
		return sc.PutWithSource(ctx, normalized, r, 0) // 0 → per-source default TTL
	}
	return s.cache.Put(ctx, normalized, r)
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

	// --- MapService v2 (gated by v2Enabled; all nil-safe) ---
	v2Enabled bool
	v2cfg     V2Config
	gaz       GazetteerStore
	coverage  CoverageIndex
	predictor Predictor
	recorder  ResolutionRecorder
	guard     ProviderGuard

	// routeCache is a short-TTL, in-process result cache for route/matrix (cost
	// control). Always non-nil after NewService; a miss is always safe.
	routeCache *routeCache
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

	// --- MapService v2 (optional; when V2Enabled, the orchestrator runs) ---
	V2Enabled bool
	V2Config  *V2Config
	Gazetteer GazetteerStore
	Coverage  CoverageIndex
	Predictor Predictor
	Recorder  ResolutionRecorder
	Guard     ProviderGuard
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
	s := &Service{
		cfg: d.Config, reg: d.Registry, cache: cache, repo: d.Repo,
		usage: usage, redis: d.Redis, codec: NewPlusCodec(), defaultSurface: surface,
	}
	// --- v2 wiring (nil-safe defaults so the orchestrator runs standalone) ---
	s.v2Enabled = d.V2Enabled
	if d.V2Config != nil {
		s.v2cfg = *d.V2Config
	} else {
		s.v2cfg = DefaultV2Config()
	}
	s.gaz = d.Gazetteer
	if s.gaz == nil {
		s.gaz = nopGazetteer{}
	}
	s.coverage = d.Coverage
	if s.coverage == nil {
		s.coverage = nopCoverage{}
	}
	s.predictor = d.Predictor
	if s.predictor == nil {
		s.predictor = nopPredictor{}
	}
	s.recorder = d.Recorder
	if s.recorder == nil {
		s.recorder = nopRecorder{}
	}
	s.guard = d.Guard
	if s.guard == nil {
		s.guard = allowGuard{}
	}
	// Short-TTL route/matrix result cache (cost control). Always present.
	s.routeCache = newRouteCache(routeCacheTTL)
	return s
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
	// v2: the coverage-aware resolution chain (gazetteer → cache → predict →
	// coverage-ordered providers → NEEDS_PIN). Gated; legacy path below when off.
	if s.v2Enabled {
		return s.forwardV2(ctx, address, surface, "geocode", nil)
	}
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

// ReverseGeocode resolves a coordinate to an address.
//
// Reverse deliberately does NOT use the geocode text cache: the cache table
// stores no address text, so Cache.Get returns the normalized KEY as the
// address — which for reverse is the coordinate string ("6.50950 3.40650"),
// i.e. a useless label served forever once a row exists. (Observed in dev:
// coordinate-string rows shadowed real Google reverse results.) Google reverse
// is non-cacheable by license anyway; a future OSM reverse cache needs an
// address column first.
func (s *Service) ReverseGeocode(ctx context.Context, lat, lng float64, surface string) (GeoResult, error) {
	surface = s.surfaceOr(surface)
	if s.v2Enabled {
		return s.reverseV2(ctx, lat, lng, surface, "reverse")
	}
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
	return res, nil
}

// AutocompleteAddress returns suggestions, degrading paid providers at soft cap.
//
// Cost control (MS-6/§10): the ProviderGuard budget + circuit breaker gate the
// primary autocomplete provider (the same guard the geocode chain uses). When the
// primary is over budget or its breaker is open we pre-emptively degrade to the
// OpenStack fallback. No result cache here: autocomplete is session-token keyed and
// keystroke-driven, so cross-request caching would be low-value and risky.
func (s *Service) AutocompleteAddress(ctx context.Context, query, sessionToken, surface string, near *Point) ([]Suggestion, error) {
	if query == "" {
		return nil, ErrEmptyQuery
	}
	surface = s.surfaceOr(surface)
	provider, degraded, err := s.resolve(ctx, PrimAutocomplete, surface)
	if err != nil {
		return nil, err
	}
	// Budget/circuit guard: pre-emptively degrade when the primary is denied.
	if !s.guard.Allow(ctx, provider, PrimAutocomplete) {
		if fb, ok := s.cfg.fallbackFor(PrimAutocomplete); ok && fb != provider && s.guard.Allow(ctx, fb, PrimAutocomplete) {
			provider, degraded = fb, true
		}
	}
	ac, ok := s.reg.Autocompleters[provider]
	if !ok {
		return nil, fmt.Errorf("%w: autocomplete/%s", ErrNoProvider, provider)
	}
	s.usage.Record(ctx, provider, PrimAutocomplete)
	start := time.Now()
	out, err := ac.Autocomplete(ctx, query, sessionToken, near)
	s.guard.Observe(ctx, provider, err == nil, time.Since(start).Milliseconds())
	if err != nil && !degraded {
		// Provider error → degrade to OpenStack autocomplete (never hard-fail).
		if fb, ok := s.cfg.fallbackFor(PrimAutocomplete); ok && fb != provider {
			if ac2, ok := s.reg.Autocompleters[fb]; ok {
				log.Printf("[maps] autocomplete %s failed (%v) — degrading to %s", provider, err, fb)
				s.usage.Record(ctx, fb, PrimAutocomplete)
				fbStart := time.Now()
				out2, err2 := ac2.Autocomplete(ctx, query, sessionToken, near)
				s.guard.Observe(ctx, fb, err2 == nil, time.Since(fbStart).Milliseconds())
				return out2, err2
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
//
// Cost controls (MS-6/§10): (1) a short-TTL, cell-keyed result cache dedupes
// near-identical requests before any paid call; (2) the ProviderGuard budget +
// circuit breaker gate the primary provider — same guard used in the geocode
// chain (orchestrator.go). When the guard denies the primary, we degrade to the
// configured OpenStack fallback rather than hard-failing.
func (s *Service) GetRoute(ctx context.Context, origin, dest Point, opts RouteOptions) (Route, error) {
	// 1. Short-TTL cache — a hit skips the provider (and its cost) entirely.
	ckey := routeCacheKey(origin, dest, opts.Profile)
	if v, ok := s.routeCache.get(ckey); ok {
		if r, ok := v.(Route); ok {
			mx.cacheHitInc()
			return r, nil
		}
	}
	mx.cacheMissInc()

	provider, degraded, err := s.resolve(ctx, PrimRoute, s.defaultSurface)
	if err != nil {
		return Route{}, err
	}
	// 2. Budget/circuit guard. When the (soft-cap-resolved) provider is over its
	// daily budget or its breaker is open, pre-emptively degrade to the configured
	// OpenStack fallback — the same guard the geocode chain applies (MS-6). Only
	// switch when a distinct fallback exists and it is not already denied.
	if !s.guard.Allow(ctx, provider, PrimRoute) {
		if fb, ok := s.cfg.fallbackFor(PrimRoute); ok && fb != provider && s.guard.Allow(ctx, fb, PrimRoute) {
			provider, degraded = fb, true
		}
	}
	rt, ok := s.reg.Routers[provider]
	if !ok {
		return Route{}, fmt.Errorf("%w: route/%s", ErrNoProvider, provider)
	}
	s.usage.Record(ctx, provider, PrimRoute)
	start := time.Now()
	out, err := rt.Route(ctx, origin, dest, opts)
	s.guard.Observe(ctx, provider, err == nil, time.Since(start).Milliseconds())
	if err != nil && !degraded {
		if fb, ok := s.cfg.fallbackFor(PrimRoute); ok && fb != provider {
			if rt2, ok := s.reg.Routers[fb]; ok {
				s.usage.Record(ctx, fb, PrimRoute)
				fbStart := time.Now()
				out, err = rt2.Route(ctx, origin, dest, opts)
				s.guard.Observe(ctx, fb, err == nil, time.Since(fbStart).Milliseconds())
				out.Degraded = true
			}
		}
	}
	out.Degraded = out.Degraded || degraded
	// 3. Cache the successful result for the short TTL (cost control).
	if err == nil {
		s.routeCache.put(ckey, out)
	}
	return out, err
}

// GetDistanceMatrix computes a many-to-many ETA/distance grid for dispatch.
//
// Cost controls (MS-6/§10): short-TTL cell-keyed result cache + ProviderGuard
// budget/circuit breaker on the (distance-matrix-heavy, paid) provider — matrix is
// the most expensive primitive per call, so guarding it matters most.
//
// NOTE: the local variable `mx` below shadows the package-level metrics singleton
// `mx`; cache metric increments therefore use the exported helpers BEFORE `mx` is
// reassigned to the matrixer. (Matches the pre-existing shadowing in this method.)
func (s *Service) GetDistanceMatrix(ctx context.Context, origins, dests []Point) (Matrix, error) {
	if len(origins) == 0 || len(dests) == 0 {
		return Matrix{}, fmt.Errorf("maps: matrix needs origins and destinations")
	}
	// 1. Short-TTL cache (cost control). These metric calls resolve to the
	// package-level `mx` singleton because the local `mx` matrixer is not declared
	// until below (Go scoping) — so no shadowing conflict at this point.
	ckey := matrixCacheKey(origins, dests)
	if v, ok := s.routeCache.get(ckey); ok {
		if m, ok := v.(Matrix); ok {
			mx.cacheHitInc()
			return m, nil
		}
	}
	mx.cacheMissInc()

	provider, degraded, err := s.resolve(ctx, PrimMatrix, s.defaultSurface)
	if err != nil {
		return Matrix{}, err
	}
	// 2. Budget/circuit guard — pre-emptively degrade to the OSM fallback when the
	// primary is over budget or its breaker is open (same guard as geocode chain).
	if !s.guard.Allow(ctx, provider, PrimMatrix) {
		if fb, ok := s.cfg.fallbackFor(PrimMatrix); ok && fb != provider && s.guard.Allow(ctx, fb, PrimMatrix) {
			provider, degraded = fb, true
		}
	}
	mx, ok := s.reg.Matrixers[provider]
	if !ok {
		return Matrix{}, fmt.Errorf("%w: matrix/%s", ErrNoProvider, provider)
	}
	s.usage.Record(ctx, provider, PrimMatrix)
	start := time.Now()
	out, err := mx.Matrix(ctx, origins, dests)
	s.guard.Observe(ctx, provider, err == nil, time.Since(start).Milliseconds())
	if err != nil && !degraded {
		if fb, ok := s.cfg.fallbackFor(PrimMatrix); ok && fb != provider {
			if mx2, ok := s.reg.Matrixers[fb]; ok {
				s.usage.Record(ctx, fb, PrimMatrix)
				fbStart := time.Now()
				out, err = mx2.Matrix(ctx, origins, dests)
				s.guard.Observe(ctx, fb, err == nil, time.Since(fbStart).Milliseconds())
			}
		}
	}
	// 3. Cache the successful result for the short TTL (cost control).
	if err == nil {
		s.routeCache.put(ckey, out)
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
