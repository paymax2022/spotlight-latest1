package maps

import (
	"fmt"
	"sync"
	"time"
)

// routecache.go — a small, short-TTL, in-process result cache for the routing and
// distance-matrix primitives (cost control, MS-6/§10).
//
// Why a separate cache from the PostGIS GeocodeCache: GeocodeCache stores a single
// GeoResult keyed by a normalized address string and is license-guarded to
// OSM-only rows. Route/matrix responses are a different shape (Route / Matrix) and
// are not address-keyed, so they need their own tiny cache. This one is:
//   - in-process and best-effort (a cache miss is always safe — we just call the
//     provider), so it never becomes a correctness dependency;
//   - keyed by ROUNDED origin/dest cells (~150 m point cells) so near-identical
//     dispatch queries collide and dedupe the paid provider call;
//   - short-TTL (default 90s) so ETAs stay fresh — routing results go stale fast.
//
// It is deliberately license-safe: only route/matrix geometry+ETA is stored, never
// a geocoded address, so no OSM/Google license-coherence concern applies here.
//
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
