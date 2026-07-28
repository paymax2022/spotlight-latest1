package maps

import (
	"context"
	"errors"
	"testing"
	"time"
)

// nilCacheV2 builds a CacheV2 with no pool. The license guard in PutWithSource runs
// BEFORE any DB access, so refusal/acceptance is observable without a database:
//   - refused sources return ErrNotCacheable,
//   - accepted (OSM) sources reach the nil-pool short-circuit and return nil.
func nilCacheV2() *CacheV2 { return NewCacheV2(nil, 0) }

func TestCacheV2_RefusesGoogle(t *testing.T) {
	c := nilCacheV2()
	g := GeoResult{Lat: 6.5, Lng: 3.4, Provider: "google", Source: SourceGoogle, Cacheable: false}
	if err := c.PutWithSource(context.Background(), "ikeja city mall", g, time.Hour); !errors.Is(err, ErrNotCacheable) {
		t.Fatalf("google result must be refused with ErrNotCacheable, got %v", err)
	}
}

func TestCacheV2_RefusesHere(t *testing.T) {
	c := nilCacheV2()
	// HERE is treated like Google for license coherence — never cached on the OSM cache.
	h := GeoResult{Lat: 6.5, Lng: 3.4, Provider: "here", Source: SourceHere, Cacheable: false}
	if err := c.PutWithSource(context.Background(), "lekki phase 1", h, time.Hour); !errors.Is(err, ErrNotCacheable) {
		t.Fatalf("HERE result must be refused with ErrNotCacheable, got %v", err)
	}
	// Even a HERE result mislabeled Cacheable=true must be refused: the source is non-OSM.
	h.Cacheable = true
	if err := c.PutWithSource(context.Background(), "lekki phase 1", h, time.Hour); !errors.Is(err, ErrNotCacheable) {
		t.Fatalf("HERE result with cacheable=true must still be refused (non-OSM source), got %v", err)
	}
}

func TestCacheV2_AcceptsOSM(t *testing.T) {
	c := nilCacheV2()
	o := GeoResult{Lat: 6.45, Lng: 3.39, Provider: "geoapify", Source: SourceOpenStack, Cacheable: true}
	// nil pool → no write, but the guard must NOT reject an OSM result.
	if err := c.PutWithSource(context.Background(), "10 awolowo road ikoyi", o, time.Hour); err != nil {
		t.Fatalf("OSM result must be accepted by the cache guard, got %v", err)
	}
}

func TestCacheV2_AcceptsOwn(t *testing.T) {
	c := nilCacheV2()
	own := GeoResult{Lat: 6.45, Lng: 3.39, Provider: "postgis", Source: SourceOwn, Cacheable: true}
	if err := c.PutWithSource(context.Background(), "our merchant", own, 0); err != nil {
		t.Fatalf("own-sourced result must be cacheable, got %v", err)
	}
}

func TestTTLForSource(t *testing.T) {
	if got := TTLForSource(SourceOpenStack); got != ttlOpenStack {
		t.Fatalf("openstack ttl: want %v got %v", ttlOpenStack, got)
	}
	if got := TTLForSource(SourceOwn); got != ttlOwn {
		t.Fatalf("own ttl: want %v got %v", ttlOwn, got)
	}
	// Unknown/non-OSM sources fall to the conservative default (they are refused
	// before TTL matters, but the function must be total).
	for _, s := range []Source{SourceGoogle, SourceHere, SourceMapbox, SourceCache} {
		if got := TTLForSource(s); got != ttlCacheDefault {
			t.Fatalf("source %s ttl: want default %v got %v", s, ttlCacheDefault, got)
		}
	}
}

func TestCacheV2_IsGeocodeCache(t *testing.T) {
	// Drop-in compatibility: CacheV2 must satisfy the legacy GeocodeCache interface.
	var _ GeocodeCache = nilCacheV2()
	// Embedded legacy Put still enforces the same guard.
	c := nilCacheV2()
	g := GeoResult{Provider: "google", Source: SourceGoogle, Cacheable: false}
	if err := c.Put(context.Background(), "x", g); !errors.Is(err, ErrNotCacheable) {
		t.Fatalf("embedded legacy Put must also refuse google, got %v", err)
	}
}
