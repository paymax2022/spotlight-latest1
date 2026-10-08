package maps

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Cache persists OpenStack (OSM-licensed) geocode/reverse results in PostGIS so
// each normalized address is resolved once. It is the FIRST thing the geocode
// path consults and the LAST thing it writes — and it REFUSES non-OSM rows.
type Cache struct {
	pool *pgxpool.Pool
	ttl  time.Duration
}

// NewCache builds a PostGIS-backed geocode cache. ttl<=0 means entries never
// expire by age (still overwritten on refresh).
func NewCache(pool *pgxpool.Pool, ttl time.Duration) *Cache {
	if ttl <= 0 {
		ttl = 30 * 24 * time.Hour
	}
	return &Cache{pool: pool, ttl: ttl}
}

var wsCollapse = regexp.MustCompile(`\s+`)

// NormalizeQuery produces the stable cache key for an address. Lowercased,
// trimmed, internal whitespace collapsed, surrounding punctuation removed — so
// "  10, Awolowo Road,  Ikoyi " and "10 awolowo road ikoyi" collide.
func NormalizeQuery(q string) string {
	q = strings.ToLower(strings.TrimSpace(q))
	q = strings.ReplaceAll(q, ",", " ")
	q = wsCollapse.ReplaceAllString(q, " ")
	return strings.TrimSpace(q)
}

// Get returns a cached result for a normalized query, or ok=false on miss/expiry.
func (c *Cache) Get(ctx context.Context, normalized string) (GeoResult, bool) {
	if c == nil || c.pool == nil {
		return GeoResult{}, false
	}
	const q = `
		SELECT lat, lng, plus_code, provider, created_at, ttl_seconds
		FROM geocode_cache
		WHERE normalized_query = $1`
	var (
		lat, lng  float64
		plusCode  string
		provider  string
		createdAt time.Time
		ttlSecs   int64
	)
	err := c.pool.QueryRow(ctx, q, normalized).Scan(&lat, &lng, &plusCode, &provider, &createdAt, &ttlSecs)
	if err != nil {
		return GeoResult{}, false // miss (pgx.ErrNoRows) or transient error → treat as miss
	}
	if ttlSecs > 0 && time.Since(createdAt) > time.Duration(ttlSecs)*time.Second {
		return GeoResult{}, false // expired
	}
	return GeoResult{
		Lat: lat, Lng: lng, Address: normalized, PlusCode: plusCode,
		Provider: provider, Source: SourceOpenStack, Cacheable: true,
	}, true
}

// Put writes an OpenStack result to the cache. It is license-guarded: any result
// that is not OSM-licensed/cacheable is REFUSED with ErrNotCacheable and never
// touches the table.
func (c *Cache) Put(ctx context.Context, normalized string, r GeoResult) error {
	if err := guardCacheWrite(r); err != nil {
		return err // refuse Google/non-OSM rows — license coherence
	}
	if c == nil || c.pool == nil {
		return nil
	}
	const q = `
		INSERT INTO geocode_cache (normalized_query, lat, lng, plus_code, provider, created_at, ttl_seconds)
		VALUES ($1, $2, $3, $4, $5, NOW(), $6)
		ON CONFLICT (normalized_query)
		DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, plus_code = EXCLUDED.plus_code,
		              provider = EXCLUDED.provider, created_at = NOW(), ttl_seconds = EXCLUDED.ttl_seconds`
	_, err := c.pool.Exec(ctx, q, normalized, r.Lat, r.Lng, r.PlusCode, r.Provider, int64(c.ttl.Seconds()))
	return err
}

// compile-time assertion that pgx is wired (keeps the import meaningful if the
// helper below is unused in some build configurations).
var _ = pgx.ErrNoRows

// the H3-keyed, TTL-by-source AddressCache (MAPSERVICE.md §6).
// CacheV2 wraps the existing geocode_cache write path and adds the v2 spatial +
// scoring columns (h3, source, confidence) and a per-source TTL. It still enforces
// the SAME hard license guard as Cache: ONLY OSM-licensed (SourceOpenStack / our
// own) results are ever persisted — Google and HERE results are REFUSED with
// ErrNotCacheable and never touch the table ().
// The legacy Cache (above) and the GeocodeCache interface keep working
// unchanged; CacheV2 is additive and embeds *Cache so Get/Put still behave as
// before. New callers use PutWithSource for the source-aware TTL + H3 key.
// WIRING (as of the production-hardening pass): NewServiceFromDeps now wires
// NewCacheV2 (not the fixed-TTL NewCache), and the v2 orchestrator writes through
// Service.cachePut, which prefers PutWithSource when the cache implements the
// sourceCache seam (service_impl.go). So the per-source TTLs below are LIVE on the
// v2 resolution path. The legacy (v1) geocode path still calls Put (fixed TTL),
// which CacheV2 inherits unchanged — so v1 behavior is byte-for-byte identical.

// Per-source default TTLs. OSM-licensed sources are the only ones ever cached, so
// only those have meaningful entries; non-OSM sources are refused before TTL even
// matters. Tuned so high-confidence OSM geocodes live longer than write-throughs.
const (
	// ttlOpenStack — geocodes resolved by an OSM provider (Geoapify/Nominatim).
	ttlOpenStack = 30 * 24 * time.Hour
	// ttlOwn — derived from our own PostGIS records; effectively stable.
	ttlOwn = 90 * 24 * time.Hour
	// ttlCacheDefault — fallback when a source has no specific TTL configured.
	ttlCacheDefault = 7 * 24 * time.Hour
)

// CacheV2 is the H3-keyed, source-aware AddressCache. It embeds *Cache so it is a
// drop-in GeocodeCache (Get/Put) while adding PutWithSource.
type CacheV2 struct {
	*Cache
}

// NewCacheV2 builds the v2 cache over the same geocode_cache table. ttl is the
// legacy default used by the embedded Cache.Put; PutWithSource overrides per call.
func NewCacheV2(pool *pgxpool.Pool, ttl time.Duration) *CacheV2 {
	return &CacheV2{Cache: NewCache(pool, ttl)}
}

// compile-time assertion that CacheV2 still satisfies the GeocodeCache contract.
var _ GeocodeCache = (*CacheV2)(nil)

// TTLForSource returns the default cache TTL for a result source. Only OSM-licensed
// sources are ever cached (the guard refuses the rest), so non-OSM sources fall to
// the conservative default — they will be rejected by guardCacheWrite regardless.
func TTLForSource(s Source) time.Duration {
	switch s {
	case SourceOpenStack:
		return ttlOpenStack
	case SourceOwn:
		return ttlOwn
	default:
		return ttlCacheDefault
	}
}

// PutWithSource writes an OSM-licensed result to the cache with its H3 cell, source,
// confidence, and a per-source TTL. It is license-guarded FIRST: any non-OSM result
// (Google/HERE) is refused with ErrNotCacheable and never persisted. A ttl<=0 means
// "use the per-source default" (TTLForSource).
func (c *CacheV2) PutWithSource(ctx context.Context, normalized string, r GeoResult, ttl time.Duration) error {
	// License coherence: refuse google/here (and anything not OSM/own) BEFORE any DB
	// access — identical guard the legacy Put uses, so behavior cannot diverge.
	if err := guardCacheWrite(r); err != nil {
		return err
	}
	if c == nil || c.Cache == nil || c.pool == nil {
		return nil
	}

	if ttl <= 0 {
		ttl = TTLForSource(r.Source)
	}

	// Derive the spatial cell key when the result didn't carry one.
	h3 := r.H3Cell
	if h3 == "" {
		h3 = PointCellKey(r.Lat, r.Lng)
	}

	// Writes the additive v2 columns (h3, source, confidence) alongside the legacy
	// columns. Parameterized; ON CONFLICT refreshes by normalized key.
	const q = `
		INSERT INTO public.geocode_cache
			(normalized_query, lat, lng, plus_code, provider, created_at, ttl_seconds, h3, source, confidence)
		VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9)
		ON CONFLICT (normalized_query) DO UPDATE SET
			lat         = EXCLUDED.lat,
			lng         = EXCLUDED.lng,
			plus_code   = EXCLUDED.plus_code,
			provider    = EXCLUDED.provider,
			created_at  = NOW(),
			ttl_seconds = EXCLUDED.ttl_seconds,
			h3          = EXCLUDED.h3,
			source      = EXCLUDED.source,
			confidence  = EXCLUDED.confidence`
	_, err := c.pool.Exec(ctx, q,
		normalized,
		r.Lat, r.Lng,
		r.PlusCode,
		r.Provider,
		int64(ttl.Seconds()),
		h3,
		string(r.Source),
		r.Confidence,
	)
	return err
}

// a small, short-TTL, in-process result cache for the routing and
// distance-matrix primitives (cost control, MS-6/§10).
// Why a separate cache from the PostGIS GeocodeCache: GeocodeCache stores a single
// GeoResult keyed by a normalized address string and is license-guarded to
// OSM-only rows. Route/matrix responses are a different shape (Route / Matrix) and
// are not address-keyed, so they need their own tiny cache. This one is:
//   - in-process and best-effort (a cache miss is always safe — we just call the
//     provider), so it never becomes a correctness dependency;
//   - keyed by ROUNDED origin/dest cells (~150 m point cells) so near-identical
//     dispatch queries collide and dedupe the paid provider call;
//   - short-TTL (default 90s) so ETAs stay fresh — routing results go stale fast.
// It is deliberately license-safe: only route/matrix geometry+ETA is stored, never
// a geocoded address, so no OSM/Google license-coherence concern applies here.
// NOTE: this is a per-instance cache. Cross-instance dedupe would need Redis; that
// is a documented follow-up (see report). For a single node it already collapses
// bursts of identical dispatch queries, which is where the cost shows up.

// routeCacheTTL is the freshness window for cached route/matrix results. Short on
// purpose: driving ETAs decay quickly, so we trade a little staleness for a big
// reduction in duplicate paid calls during dispatch bursts.
const routeCacheTTL = 90 * time.Second

// routeCacheEntry is a value + its expiry.
type routeCacheEntry struct {
	val       any
	expiresAt time.Time
}

// routeCache is a tiny TTL map guarded by a mutex. Values are Route or Matrix
// (stored as any and type-asserted by the caller). Expired entries are dropped
// lazily on read and opportunistically on write.
type routeCache struct {
	mu  sync.Mutex
	ttl time.Duration
	m   map[string]routeCacheEntry
}

// newRouteCache builds a route/matrix cache with the given TTL (<=0 → default).
func newRouteCache(ttl time.Duration) *routeCache {
	if ttl <= 0 {
		ttl = routeCacheTTL
	}
	return &routeCache{ttl: ttl, m: map[string]routeCacheEntry{}}
}

// get returns a live cached value, or ok=false on miss/expiry.
func (rc *routeCache) get(key string) (any, bool) {
	if rc == nil {
		return nil, false
	}
	rc.mu.Lock()
	defer rc.mu.Unlock()
	e, ok := rc.m[key]
	if !ok {
		return nil, false
	}
	if time.Now().After(e.expiresAt) {
		delete(rc.m, key)
		return nil, false
	}
	return e.val, true
}

// put stores a value with the cache TTL. A simple size cap keeps the map bounded:
// when it grows past the cap we drop already-expired entries; if that is not
// enough we skip the write (never unbounded, never blocking).
func (rc *routeCache) put(key string, val any) {
	if rc == nil {
		return
	}
	rc.mu.Lock()
	defer rc.mu.Unlock()
	const maxEntries = 4096
	if len(rc.m) >= maxEntries {
		now := time.Now()
		for k, e := range rc.m {
			if now.After(e.expiresAt) {
				delete(rc.m, k)
			}
		}
		if len(rc.m) >= maxEntries {
			return // still full of live entries — skip; a miss is always safe
		}
	}
	rc.m[key] = routeCacheEntry{val: val, expiresAt: time.Now().Add(rc.ttl)}
}

// routeCacheKey keys a single route by rounded origin/dest point cells + profile.
// Rounding to a point cell (~150 m) makes near-identical requests collide.
func routeCacheKey(origin, dest Point, profile string) string {
	return fmt.Sprintf("route|%s|%s|%s", PointCellKey(origin.Lat, origin.Lng),
		PointCellKey(dest.Lat, dest.Lng), profile)
}

// matrixCacheKey keys a distance matrix by the rounded cells of every origin and
// dest, in order. Order matters (Rows[i][j] is origins[i]→dests[j]), so we keep it.
func matrixCacheKey(origins, dests []Point) string {
	b := make([]byte, 0, 8*(len(origins)+len(dests))+16)
	b = append(b, "matrix|o:"...)
	for _, p := range origins {
		b = append(b, PointCellKey(p.Lat, p.Lng)...)
		b = append(b, ',')
	}
	b = append(b, "|d:"...)
	for _, p := range dests {
		b = append(b, PointCellKey(p.Lat, p.Lng)...)
		b = append(b, ',')
	}
	return string(b)
}
