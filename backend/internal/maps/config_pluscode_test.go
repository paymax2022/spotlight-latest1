package maps

import (
	"math"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestDefaultSurfaceConfigRouting(t *testing.T) {
	cfg := DefaultSurfaceConfig()

	cases := []struct {
		prim    Primitive
		surface string
		want    string
	}{
		{PrimBasemap, "default", "maptiler"},
		{PrimGeocode, "default", "google"}, // address lookup standardized on Google
		{PrimReverse, "default", "google"},
		{PrimAutocomplete, "default", "google"},  // Google across all surfaces
		{PrimAutocomplete, "checkout", "google"}, // consumer surface uses Google
		{PrimAutocomplete, "delivery", "google"},
		{PrimPlaces, "default", "google"}, // external POIs are Google
		{PrimRoute, "default", "osrm"},    // single-route polyline stays OSRM
		{PrimMatrix, "default", "google"}, // Google Distance Matrix for delivery-fee distance/ETA
		{PrimMatchToRoad, "default", "osrm"},
	}
	for _, c := range cases {
		got, ok := cfg.providerFor(c.prim, c.surface)
		if !ok || got != c.want {
			t.Fatalf("providerFor(%s,%s) = %q,%v; want %q", c.prim, c.surface, got, ok, c.want)
		}
	}

	// Fallbacks degrade paid/Google primitives back to OpenStack.
	if fb, ok := cfg.fallbackFor(PrimAutocomplete); !ok || fb != "geoapify" {
		t.Fatalf("autocomplete fallback = %q,%v; want geoapify", fb, ok)
	}
	if fb, ok := cfg.fallbackFor(PrimPlaces); !ok || fb != "geoapify" {
		t.Fatalf("places fallback = %q,%v; want geoapify", fb, ok)
	}

	// Caps exist for the Google SKUs the cost guard watches.
	if cfg.Caps["google.autocomplete"] == 0 || cfg.Caps["google.places"] == 0 {
		t.Fatalf("expected google caps, got %+v", cfg.Caps)
	}
}

func TestLoadSurfaceConfigEmptyPathReturnsDefaults(t *testing.T) {
	cfg, err := LoadSurfaceConfig("")
	if err != nil {
		t.Fatalf("empty path should not error: %v", err)
	}
	if p, _ := cfg.providerFor(PrimGeocode, "default"); p != "google" {
		t.Fatalf("default geocode provider = %q; want google", p)
	}
}

func TestLoadSurfaceConfigOverlayMerge(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "maps.json")
	overlay := `{
		"default": { "geocode": "google" },
		"surfaces": { "checkout": { "autocomplete": "geoapify" } },
		"caps": { "google.places": 99 }
	}`
	if err := os.WriteFile(path, []byte(overlay), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadSurfaceConfig(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	// Overridden.
	if p, _ := cfg.providerFor(PrimGeocode, "default"); p != "google" {
		t.Fatalf("overridden geocode = %q; want google", p)
	}
	if p, _ := cfg.providerFor(PrimAutocomplete, "checkout"); p != "geoapify" {
		t.Fatalf("checkout autocomplete overridden = %q; want geoapify", p)
	}
	if cfg.Caps["google.places"] != 99 {
		t.Fatalf("cap overridden = %d; want 99", cfg.Caps["google.places"])
	}
	// Untouched defaults preserved.
	if p, _ := cfg.providerFor(PrimBasemap, "default"); p != "maptiler" {
		t.Fatalf("basemap default lost: %q", p)
	}
	if cfg.Caps["google.autocomplete"] == 0 {
		t.Fatal("untouched cap lost")
	}
}

func TestCapKey(t *testing.T) {
	if k := capKey("google", PrimPlaces); k != "google.places" {
		t.Fatalf("capKey = %q; want google.places", k)
	}
}

func TestMemLimiterFixedWindow(t *testing.T) {
	l := &memLimiter{store: map[string]*memBucket{}, limit: 2, window: time.Minute}
	if _, ok := l.allow("u1"); !ok {
		t.Fatal("1st call should pass")
	}
	if _, ok := l.allow("u1"); !ok {
		t.Fatal("2nd call should pass")
	}
	if _, ok := l.allow("u1"); ok {
		t.Fatal("3rd call should be limited")
	}
	// Different user has its own bucket.
	if _, ok := l.allow("u2"); !ok {
		t.Fatal("other user should pass")
	}
	// Window reset.
	l.store["u1"].windowStart = time.Now().Add(-2 * time.Minute)
	if _, ok := l.allow("u1"); !ok {
		t.Fatal("after window reset the call should pass again")
	}
}

// Stale buckets must be swept — one-shot users previously accumulated in the
// fallback store forever.
func TestMemLimiterSweepsStaleBuckets(t *testing.T) {
	l := &memLimiter{store: map[string]*memBucket{}, limit: 2, window: time.Minute}
	l.store["stale"] = &memBucket{count: 1, windowStart: time.Now().Add(-2 * time.Minute)}

	if _, ok := l.allow("fresh"); !ok {
		t.Fatal("new key should pass")
	}
	if got := len(l.store); got != 1 {
		t.Fatalf("stale bucket survived the sweep: size = %d, want 1", got)
	}
}

// Distinct keys beyond the cap must not grow the store without bound.
func TestMemLimiterBoundedUnderKeyFlood(t *testing.T) {
	l := &memLimiter{store: map[string]*memBucket{}, limit: 2, window: time.Minute, maxKeys: 10}
	for i := range 100 {
		l.allow("u" + strconv.Itoa(i))
	}
	if got := len(l.store); got > 10 {
		t.Fatalf("store exceeded the cap: %d entries, want <= 10", got)
	}
}

func TestPlusCodeEdgeCases(t *testing.T) {
	codec := NewPlusCodec()

	// Poles / extremes must not panic and must round-trip within a cell.
	for _, p := range []Point{{Lat: 90, Lng: 180}, {Lat: -90, Lng: -180}, {Lat: 0, Lng: 0}, {Lat: 6.4541, Lng: 3.3947}} {
		code := codec.Encode(p.Lat, p.Lng)
		if len(code) < 8 {
			t.Fatalf("short code %q for %+v", code, p)
		}
		if _, err := codec.Decode(code); err != nil {
			t.Fatalf("decode %q: %v", code, err)
		}
	}

	// Longitude normalization: +180 and -180 are the same meridian.
	if codec.Encode(0, 180) == "" || codec.Encode(0, -180) == "" {
		t.Fatal("antimeridian encode failed")
	}

	// Invalid input.
	if _, err := codec.Decode(""); err == nil {
		t.Fatal("empty code should error")
	}
	if _, err := codec.Decode("!!!"); err == nil {
		t.Fatal("garbage code should error")
	}
}

// AUD-BE-010: non-finite coordinates must degrade to "" — NaN produced a
// negative digit index (panic) and ±Inf lng would spin normalizeLongitude
// forever.
func TestPlusCodeNonFiniteInput(t *testing.T) {
	codec := NewPlusCodec()
	nan := math.NaN()
	inf := math.Inf(1)
	for _, p := range []Point{
		{Lat: nan, Lng: 3.39}, {Lat: 6.45, Lng: nan}, {Lat: nan, Lng: nan},
		{Lat: inf, Lng: 0}, {Lat: math.Inf(-1), Lng: 0},
		{Lat: 0, Lng: inf}, {Lat: 0, Lng: math.Inf(-1)},
	} {
		if code := codec.Encode(p.Lat, p.Lng); code != "" {
			t.Errorf("Encode(%v) = %q, want \"\"", p, code)
		}
	}
}
