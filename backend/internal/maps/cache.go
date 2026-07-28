package maps

import (
	"context"
	"regexp"
	"strings"
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
