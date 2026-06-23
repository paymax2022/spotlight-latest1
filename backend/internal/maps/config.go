package maps

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
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
//   - OpenStack for display/geocode/reverse/route/matrix/tracking/geofence
//   - Google ONLY for autocomplete (consumer surfaces) + external POIs
//
// Provider names here match adapter Name() values.
func DefaultSurfaceConfig() SurfaceConfig {
	return SurfaceConfig{
		Default: ProviderMap{
			PrimBasemap:      "maptiler",
			PrimGeocode:      "geoapify",
			PrimReverse:      "geoapify",
			PrimAutocomplete: "geoapify", // OpenStack by default; Google only on consumer surfaces
			PrimPlaces:       "google",   // external world POIs are Google-only
			PrimRoute:        "osrm",
			PrimMatrix:       "osrm",
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
