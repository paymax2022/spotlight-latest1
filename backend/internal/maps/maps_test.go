package maps

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// ── Test doubles ──────────────────────────────────────────────────────────────

// recordingCache is an in-memory GeocodeCache that mirrors the real cache's
// license guard: it REFUSES non-OSM rows via guardCacheWrite.
type recordingCache struct {
	store map[string]GeoResult
	puts  int
	gets  int
}

func newRecordingCache() *recordingCache { return &recordingCache{store: map[string]GeoResult{}} }

func (c *recordingCache) Get(_ context.Context, k string) (GeoResult, bool) {
	c.gets++
	r, ok := c.store[k]
	return r, ok
}
func (c *recordingCache) Put(_ context.Context, k string, r GeoResult) error {
	if err := guardCacheWrite(r); err != nil {
		return err
	}
	c.store[k] = r
	c.puts++
	return nil
}

// fakeUsage lets a test force a provider over its soft cap.
type fakeUsage struct {
	over    map[string]bool
	records []string
}

func newFakeUsage() *fakeUsage { return &fakeUsage{over: map[string]bool{}} }

func (f *fakeUsage) Record(_ context.Context, provider string, p Primitive) int64 {
	f.records = append(f.records, capKey(provider, p))
	return 0
}
func (f *fakeUsage) OverSoftCap(_ context.Context, provider string, p Primitive) bool {
	return f.over[capKey(provider, p)]
}
func (f *fakeUsage) Snapshot(context.Context) ([]UsageRow, error) { return []UsageRow{}, nil }

// fakeRepo backs findNearbyOwn / isInZone without PostGIS.
type fakeRepo struct {
	nearby []OwnEntity
	inzone bool
}

func (f fakeRepo) NearbyOwn(context.Context, string, Point, float64, int) ([]OwnEntity, error) {
	return f.nearby, nil
}
func (f fakeRepo) InZone(context.Context, Point, string) (bool, error) { return f.inzone, nil }
func (f fakeRepo) UpsertLocation(context.Context, OwnEntity, string, string) error { return nil }

// testService builds a Service whose registry is all deterministic mocks, with
// google carrying SourceGoogle so the license/no-cache guards behave as in prod.
func testService(cfg SurfaceConfig, cache GeocodeCache, usage CapGuard, repo GeoRepo) *Service {
	reg := NewRegistry()
	reg.AddTiles(NewMockProvider("maptiler", SourceOpenStack))

	gp := NewMockProvider("geoapify", SourceOpenStack)
	reg.AddGeocoder(gp)
	reg.AddAutocompleter(gp)
	reg.AddPlaceSearcher(gp)

	o := NewMockProvider("osrm", SourceOpenStack)
	reg.AddRouter(o)
	reg.AddMatrixer(o)
	reg.AddMapMatcher(o)

	g := NewMockProvider("google", SourceGoogle)
	reg.AddGeocoder(g) // only used when a test points geocode -> google
	reg.AddAutocompleter(g)
	reg.AddPlaceSearcher(g)

	return NewService(Deps{
		Config: cfg, Registry: reg, Cache: cache, Usage: usage, Repo: repo, DefaultSurface: "default",
	})
}

// ── Tests ─────────────────────────────────────────────────────────────────────

func TestGeocodeCacheMiss_ThenHit(t *testing.T) {
	cache := newRecordingCache()
	svc := testService(DefaultSurfaceConfig(), cache, newFakeUsage(), fakeRepo{})
	ctx := context.Background()

	// Miss: provider is called, OSM result is cached.
	r1, err := svc.Geocode(ctx, "10 Awolowo Road, Ikoyi", "")
	if err != nil {
		t.Fatalf("geocode: %v", err)
	}
	if r1.Provider != "geoapify" {
		t.Fatalf("want geoapify, got %s", r1.Provider)
	}
	if cache.puts != 1 {
		t.Fatalf("expected 1 cache put on miss, got %d", cache.puts)
	}

	// Hit: same normalized query resolves from cache, no second put.
	r2, err := svc.Geocode(ctx, "10  Awolowo Road,  Ikoyi", "") // different spacing → same key
	if err != nil {
		t.Fatalf("geocode hit: %v", err)
	}
	if cache.puts != 1 {
		t.Fatalf("cache hit should not write; puts=%d", cache.puts)
	}
	if r2.Lat != r1.Lat || r2.Lng != r1.Lng {
		t.Fatalf("cache hit returned different coords")
	}
}

func TestNoCacheGoogleGuard(t *testing.T) {
	// Direct guard: a Google result must be refused by the cache writer.
	g := GeoResult{Lat: 6.5, Lng: 3.4, Provider: "google", Source: SourceGoogle, Cacheable: false}
	if err := guardCacheWrite(g); !errors.Is(err, ErrNotCacheable) {
		t.Fatalf("expected ErrNotCacheable for google, got %v", err)
	}
	// OSM result is accepted.
	o := GeoResult{Lat: 6.5, Lng: 3.4, Provider: "geoapify", Source: SourceOpenStack, Cacheable: true}
	if err := guardCacheWrite(o); err != nil {
		t.Fatalf("OSM result should be cacheable, got %v", err)
	}

	// Service-level: when geocode is routed to Google, nothing is persisted.
	cfg := DefaultSurfaceConfig()
	cfg.Default[PrimGeocode] = "google"
	cache := newRecordingCache()
	svc := testService(cfg, cache, newFakeUsage(), fakeRepo{})

	res, err := svc.Geocode(context.Background(), "Ikeja City Mall", "")
	if err != nil {
		t.Fatalf("geocode: %v", err)
	}
	if res.Cacheable {
		t.Fatalf("google result must be cacheable=false")
	}
	if cache.puts != 0 {
		t.Fatalf("google geocode must NOT be cached; puts=%d", cache.puts)
	}
}

func TestLicenseCoherenceGuard(t *testing.T) {
	googlePt := Point{Lat: 6.5, Lng: 3.4, Source: SourceGoogle}
	osmPt := Point{Lat: 6.5, Lng: 3.4, Source: SourceOpenStack}

	// Google point on the OpenStack basemap → throws.
	if err := AssertRenderable(SourceOpenStack, googlePt); !errors.Is(err, ErrLicenseCoherence) {
		t.Fatalf("expected license-coherence violation, got %v", err)
	}
	// OSM point on the OpenStack basemap → allowed.
	if err := AssertRenderable(SourceOpenStack, osmPt); err != nil {
		t.Fatalf("OSM point should render on OSM basemap, got %v", err)
	}
	// Google point on a Google basemap → allowed (same stack).
	if err := AssertRenderable(SourceGoogle, googlePt); err != nil {
		t.Fatalf("google point on google basemap should be allowed, got %v", err)
	}
}

func TestFindNearbyOwn_PostGISShape(t *testing.T) {
	repo := fakeRepo{nearby: []OwnEntity{
		{EntityID: "m1", EntityType: "merchant", Lat: 6.45, Lng: 3.39, DistanceM: 120},
		{EntityID: "m2", EntityType: "merchant", Lat: 6.46, Lng: 3.40, DistanceM: 340},
	}}
	svc := testService(DefaultSurfaceConfig(), newRecordingCache(), newFakeUsage(), repo)

	out, err := svc.FindNearbyOwn(context.Background(), "merchant", Point{Lat: 6.45, Lng: 3.39}, 500, 10)
	if err != nil {
		t.Fatalf("nearby: %v", err)
	}
	if len(out) != 2 || out[0].EntityID != "m1" {
		t.Fatalf("unexpected nearby result: %+v", out)
	}

	inside, err := svc.IsInZone(context.Background(), Point{Lat: 6.45, Lng: 3.39}, "lagos-island")
	if err != nil || inside {
		t.Fatalf("expected not-in-zone, got inside=%v err=%v", inside, err)
	}
}

func TestDistanceMatrixRouting(t *testing.T) {
	svc := testService(DefaultSurfaceConfig(), newRecordingCache(), newFakeUsage(), fakeRepo{})
	origins := []Point{{Lat: 6.45, Lng: 3.39}, {Lat: 6.50, Lng: 3.37}}
	dests := []Point{{Lat: 6.60, Lng: 3.35}, {Lat: 6.43, Lng: 3.42}, {Lat: 6.55, Lng: 3.36}}

	m, err := svc.GetDistanceMatrix(context.Background(), origins, dests)
	if err != nil {
		t.Fatalf("matrix: %v", err)
	}
	if m.Provider != "osrm" || m.Source != SourceOpenStack {
		t.Fatalf("expected osrm/openstack, got %s/%s", m.Provider, m.Source)
	}
	if len(m.Rows) != 2 || len(m.Rows[0]) != 3 {
		t.Fatalf("expected 2x3 matrix, got %dx?", len(m.Rows))
	}
	if m.Rows[0][0].DurationS <= 0 {
		t.Fatalf("expected positive ETA")
	}
}

func TestCapToDegradationFallback(t *testing.T) {
	// Route autocomplete to Google by default, then force Google over its cap.
	cfg := DefaultSurfaceConfig()
	cfg.Default[PrimAutocomplete] = "google" // primary
	// Fallback already geoapify (OpenStack) in defaults.
	usage := newFakeUsage()
	usage.over[capKey("google", PrimAutocomplete)] = true

	svc := testService(cfg, newRecordingCache(), usage, fakeRepo{})
	out, err := svc.AutocompleteAddress(context.Background(), "Lekki Phase 1", "", "", nil)
	if err != nil {
		t.Fatalf("autocomplete: %v", err)
	}
	if len(out) == 0 || out[0].Provider != "geoapify" {
		t.Fatalf("expected graceful degradation to geoapify, got %+v", out)
	}
	if out[0].Source != SourceOpenStack {
		t.Fatalf("degraded suggestions must be OpenStack-sourced")
	}
}

func TestPlusCodeRoundTrip(t *testing.T) {
	codec := NewPlusCodec()
	// Lagos (approx). Encode then decode should land within one cell (~0.0002°).
	lat, lng := 6.4550, 3.3940
	code := codec.Encode(lat, lng)
	if len(code) < 8 {
		t.Fatalf("plus code too short: %q", code)
	}
	p, err := codec.Decode(code)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if d := absf(p.Lat - lat); d > 0.001 {
		t.Fatalf("lat drift too large: %f (code=%s decoded=%f)", d, code, p.Lat)
	}
	if d := absf(p.Lng - lng); d > 0.001 {
		t.Fatalf("lng drift too large: %f", d)
	}
}

func TestNormalizeQueryCollisions(t *testing.T) {
	a := NormalizeQuery("  10, Awolowo Road,  Ikoyi ")
	b := NormalizeQuery("10 awolowo road ikoyi")
	if a != b {
		t.Fatalf("normalized keys should collide: %q vs %q", a, b)
	}
}

func TestMetricsRender(t *testing.T) {
	mx.recordHTTP("/api/finance/maps/geocode", 200, 0.012)
	mx.recordHTTP("/api/finance/maps/autocomplete", 429, 0.001)
	mx.cacheHitInc()
	mx.cacheMissInc()
	mx.degradationInc("autocomplete")

	out := mx.render()
	for _, want := range []string{
		"# TYPE maps_http_requests_total counter",
		`maps_http_requests_total{path="/api/finance/maps/geocode",status="200"}`,
		`status="429"`,
		"maps_cache_hits_total ",
		"maps_cache_misses_total ",
		`maps_degradations_total{primitive="autocomplete"}`,
		"maps_http_request_duration_seconds_sum",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("metrics output missing %q\n---\n%s", want, out)
		}
	}
}

func absf(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}
