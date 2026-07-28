package maps

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// cache_v2.go — the H3-keyed, TTL-by-source AddressCache (MAPSERVICE.md §6).
//
// CacheV2 wraps the existing geocode_cache write path and adds the v2 spatial +
// scoring columns (h3, source, confidence) and a per-source TTL. It still enforces
// the SAME hard license guard as Cache: ONLY OSM-licensed (SourceOpenStack / our
// own) results are ever persisted — Google and HERE results are REFUSED with
// ErrNotCacheable and never touch the table (guards.go: guardCacheWrite).
//
// The legacy Cache (cache.go) and the GeocodeCache interface keep working
// unchanged; CacheV2 is additive and embeds *Cache so Get/Put still behave as
// before. New callers use PutWithSource for the source-aware TTL + H3 key.
//
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
	if c == nil || c.Cache == nil || c.Cache.pool == nil {
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
	_, err := c.Cache.pool.Exec(ctx, q,
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
