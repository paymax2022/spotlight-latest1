package maps

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

// config_v2.go — hot-reloadable config for the v2 orchestration layer
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
	for k, v := range override.Budgets {
		cfg.Budgets[k] = v
	}
	for k, v := range override.CacheTTL {
		cfg.CacheTTL[k] = v
	}
	if override.PerRequestThresholds != nil {
		cfg.PerRequestThresholds = override.PerRequestThresholds
	}
	return cfg, nil
}
