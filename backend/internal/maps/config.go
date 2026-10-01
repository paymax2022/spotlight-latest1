package maps

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"strings"
	"time"
)

// ProviderMap is the {primitive -> provider} routing table for one surface.
// Example: {"basemap":"maptiler","geocode":"geoapify","autocomplete":"google"}.
type ProviderMap map[Primitive]string

// SurfaceConfig is the whole config-driven provider selection. Swapping a
// provider for a primitive on a surface is an edit here — not a code change.
type SurfaceConfig struct {
	// Default routing applied to every surface unless overridden.
	Default ProviderMap `json:"default"`
	// Surfaces overlays per-surface routing (e.g. "checkout" uses Google
	// autocomplete + places; everything else stays OpenStack).
	Surfaces map[string]ProviderMap `json:"surfaces"`
	// Fallback is the provider to degrade to per primitive when the primary
	// hits a soft cap or errors. Defaults wire paid primitives back to OpenStack.
	Fallback ProviderMap `json:"fallback"`
	// Caps are monthly soft caps keyed "<provider>.<primitive>". Reaching a cap
	// triggers graceful degradation to Fallback (never a hard failure, never a
	// key/account switch).
	Caps map[string]int64 `json:"caps"`
}

// DefaultSurfaceConfig is the acceptance-criteria default:
//   - Google for all address lookup: geocode/reverse/autocomplete/places/matrix
//     (standardized server-side per docs/ENV.md; Google results are non-cacheable
//     and degrade to the OpenStack stack via Fallback on error/soft-cap)
//   - OpenStack for the display/tracking layer: maptiler basemap, osrm route + match
//
// Provider names here match adapter Name() values.
func DefaultSurfaceConfig() SurfaceConfig {
	return SurfaceConfig{
		Default: ProviderMap{
			PrimBasemap:      "maptiler", // basemap tiles stay MapLibre/OSM (display layer)
			PrimGeocode:      "google",   // Google for all address lookup/geocoding
			PrimReverse:      "google",
			PrimAutocomplete: "google",
			PrimPlaces:       "google",
			PrimRoute:        "osrm",   // single-route polyline (live tracking) stays OSRM
			PrimMatrix:       "google", // Google Distance Matrix → delivery-fee driving distance/ETA
			PrimMatchToRoad:  "osrm",
		},
		// Consumer checkout/delivery surfaces: Google autocomplete + POI, shown
		// on a Google map ONLY on that surface (renderer guard enforces this).
		Surfaces: map[string]ProviderMap{
			"checkout": {
				PrimAutocomplete: "google",
				PrimPlaces:       "google",
			},
			"delivery": {
				PrimAutocomplete: "google",
				PrimPlaces:       "google",
			},
		},
		// Degrade paid/Google primitives back to the OpenStack stack.
		Fallback: ProviderMap{
			PrimAutocomplete: "geoapify",
			PrimPlaces:       "geoapify", // OSM POI search as a degraded substitute
			PrimRoute:        "osrm",
			PrimMatrix:       "osrm",
			PrimMatchToRoad:  "osrm",
			PrimBasemap:      "maptiler",
		},
		Caps: map[string]int64{
			"google.autocomplete": 40000,
			"google.places":       20000,
		},
	}
}

// LoadSurfaceConfig reads an optional JSON override file and merges it onto the
// defaults. An empty path returns the defaults. This keeps provider selection
// config-driven per environment without code changes.
func LoadSurfaceConfig(path string) (SurfaceConfig, error) {
	cfg := DefaultSurfaceConfig()
	if strings.TrimSpace(path) == "" {
		return cfg, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return cfg, fmt.Errorf("maps: read config %q: %w", path, err)
	}
	var override SurfaceConfig
	if err := json.Unmarshal(raw, &override); err != nil {
		return cfg, fmt.Errorf("maps: parse config %q: %w", path, err)
	}
	mergeProviderMap(cfg.Default, override.Default)
	mergeProviderMap(cfg.Fallback, override.Fallback)
	for surface, pm := range override.Surfaces {
		if cfg.Surfaces[surface] == nil {
			cfg.Surfaces[surface] = ProviderMap{}
		}
		mergeProviderMap(cfg.Surfaces[surface], pm)
	}
	for k, v := range override.Caps {
		cfg.Caps[k] = v
	}
	return cfg, nil
}

func mergeProviderMap(dst, src ProviderMap) {
	for k, v := range src {
		if v != "" {
			dst[k] = v
		}
	}
}

// providerFor resolves the configured provider for a primitive on a surface,
// applying the per-surface overlay on top of Default.
func (s SurfaceConfig) providerFor(primitive Primitive, surface string) (string, bool) {
	if surface != "" {
		if pm, ok := s.Surfaces[surface]; ok {
			if p, ok := pm[primitive]; ok && p != "" {
				return p, true
			}
		}
	}
	p, ok := s.Default[primitive]
	return p, ok && p != ""
}

// fallbackFor returns the degradation target for a primitive (if any).
func (s SurfaceConfig) fallbackFor(primitive Primitive) (string, bool) {
	p, ok := s.Fallback[primitive]
	return p, ok && p != ""
}

// capKey builds the "<provider>.<primitive>" key used in Caps and map_usage.
func capKey(provider string, primitive Primitive) string {
	return provider + "." + string(primitive)
}

// hot-reloadable config for the v2 orchestration layer
// (MAPSERVICE.md §9). Additive: legacy SurfaceConfig is untouched.

// Thresholds tune escalation + the NEEDS_PIN floor (per request type via overrides).
type Thresholds struct {
	Escalate Confidence `json:"escalate"`  // τ — stop escalating once a result meets this
	PinFloor Confidence `json:"pin_floor"` // τ_floor — below this → NEEDS_PIN
}

// V2Config is the coverage-aware orchestration config.
type V2Config struct {
	Thresholds Thresholds `json:"thresholds"`
	// ProviderOrder is the per-tier geocoding provider chain (names match adapter Name()).
	ProviderOrder map[CoverageTier][]string `json:"provider_order"`
	// Routing selects batch vs live-traffic routers.
	Routing struct {
		Batch       string `json:"batch"`        // osrm/valhalla
		LiveTraffic string `json:"live_traffic"` // google/here
	} `json:"routing"`
	// Budgets are per-provider daily caps; exceeding → circuit-break to OSM + NEEDS_PIN.
	Budgets map[string]int64 `json:"budgets"`
	// CacheTTL is the write-through TTL per source ("gazetteer" → 0 = never expire).
	CacheTTL map[string]Duration `json:"cache_ttl"`
	// PerRequestThresholds overrides Thresholds per request type (e.g. vet_home_visit).
	PerRequestThresholds map[string]Thresholds `json:"per_request_thresholds"`
}

// Duration is a JSON-friendly time.Duration ("30d","90d","720h"; "never"/"0" = 0).
type Duration time.Duration

func (d *Duration) UnmarshalJSON(b []byte) error {
	s := strings.Trim(strings.TrimSpace(string(b)), `"`)
	if s == "" || s == "never" || s == "0" {
		*d = 0
		return nil
	}
	if strings.HasSuffix(s, "d") { // days
		var days int
		if _, err := fmt.Sscanf(s, "%dd", &days); err != nil {
			return err
		}
		*d = Duration(time.Duration(days) * 24 * time.Hour)
		return nil
	}
	dur, err := time.ParseDuration(s)
	if err != nil {
		return err
	}
	*d = Duration(dur)
	return nil
}

// DefaultV2Config mirrors the MAPSERVICE.md §9 example.
func DefaultV2Config() V2Config {
	c := V2Config{
		Thresholds: Thresholds{Escalate: 0.70, PinFloor: 0.45},
		ProviderOrder: map[CoverageTier][]string{
			// Google-first across all tiers: address lookup/geocoding standardized on
			// Google; geoapify/here remain as degraded fallbacks if Google errors.
			TierGood: {"google", "geoapify", "here"},
			TierFair: {"google", "geoapify", "here"},
			TierLow:  {"google", "here", "geoapify"},
		},
		Budgets: map[string]int64{}, // populated from env/JSON; empty = no daily cap
		CacheTTL: map[string]Duration{
			"google":    Duration(30 * 24 * time.Hour),
			"here":      Duration(30 * 24 * time.Hour),
			"openstack": Duration(90 * 24 * time.Hour),
			"gazetteer": 0, // never expires
		},
	}
	c.Routing.Batch = "osrm"
	c.Routing.LiveTraffic = "google"
	return c
}

// Thresholds for a request type, falling back to the global thresholds.
func (c V2Config) thresholdsFor(requestType string) Thresholds {
	if t, ok := c.PerRequestThresholds[requestType]; ok {
		return t
	}
	return c.Thresholds
}

// orderFor returns the provider chain for a coverage tier (FAIR as fallback).
func (c V2Config) orderFor(tier CoverageTier) []string {
	if o, ok := c.ProviderOrder[tier]; ok && len(o) > 0 {
		return o
	}
	if o, ok := c.ProviderOrder[TierFair]; ok {
		return o
	}
	return nil
}

// LoadV2Config reads an optional JSON override and merges onto defaults.
func LoadV2Config(path string) (V2Config, error) {
	cfg := DefaultV2Config()
	if strings.TrimSpace(path) == "" {
		return cfg, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return cfg, fmt.Errorf("maps: read v2 config %q: %w", path, err)
	}
	var override V2Config
	if err := json.Unmarshal(raw, &override); err != nil {
		return cfg, fmt.Errorf("maps: parse v2 config %q: %w", path, err)
	}
	if override.Thresholds.Escalate > 0 {
		cfg.Thresholds.Escalate = override.Thresholds.Escalate
	}
	if override.Thresholds.PinFloor > 0 {
		cfg.Thresholds.PinFloor = override.Thresholds.PinFloor
	}
	for tier, order := range override.ProviderOrder {
		if len(order) > 0 {
			cfg.ProviderOrder[tier] = order
		}
	}
	if override.Routing.Batch != "" {
		cfg.Routing.Batch = override.Routing.Batch
	}
	if override.Routing.LiveTraffic != "" {
		cfg.Routing.LiveTraffic = override.Routing.LiveTraffic
	}
	maps.Copy(cfg.Budgets, override.Budgets)
	maps.Copy(cfg.CacheTTL, override.CacheTTL)
	if override.PerRequestThresholds != nil {
		cfg.PerRequestThresholds = override.PerRequestThresholds
	}
	return cfg, nil
}
