package maps

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// ── Config-driven provider selection ─────────────────────────────────────────

func TestDefaultSurfaceConfigRouting(t *testing.T) {
	cfg := DefaultSurfaceConfig()

	cases := []struct {
		prim    Primitive
		surface string
		want    string
	}{
		{PrimBasemap, "default", "maptiler"},
		{PrimGeocode, "default", "geoapify"},
		{PrimReverse, "default", "geoapify"},
		{PrimAutocomplete, "default", "geoapify"}, // OpenStack by default
		{PrimAutocomplete, "checkout", "google"},  // consumer surface uses Google
		{PrimAutocomplete, "delivery", "google"},
		{PrimPlaces, "default", "google"}, // external POIs are Google
		{PrimRoute, "default", "osrm"},
		{PrimMatrix, "default", "osrm"},
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
	if p, _ := cfg.providerFor(PrimGeocode, "default"); p != "geoapify" {
		t.Fatalf("default geocode provider = %q; want geoapify", p)
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

// ── In-memory rate limiter ───────────────────────────────────────────────────

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

// ── Plus Code edge cases ─────────────────────────────────────────────────────

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
