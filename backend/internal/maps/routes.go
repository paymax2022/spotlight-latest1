package maps

import (
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	platformRedis "spotlight/backend/internal/platform/redis"
)

// RouteDeps carries everything needed to wire the maps module. Mirrors the
// invest/onboarding module pattern (Register gated on a feature flag).
type RouteDeps struct {
	DB      *pgxpool.Pool
	Enabled bool // FEATURE_MAPS_ENABLED

	// Config-driven provider selection. ConfigPath is an optional override file.
	ConfigPath     string
	DefaultSurface string

	// Server-side provider keys (never shipped to the client).
	GeoapifyKey  string
	MapTilerKey  string
	OSRMBaseURL  string
	TileStyleURL string
	GoogleKey    string
	MapboxToken  string

	// Generic HTTP provider (config-driven, documented JSON contract — see
	// provider_http.go). When Provider == "http" and BaseURL is set, ONE real
	// adapter serves geocode/reverse/route/matrix behind a gateway you point at
	// (Google Distance Matrix/Directions, Mapbox, or your own shim). It registers
	// under the OpenStack provider names the default surface config routes to
	// (geoapify for geocode/reverse, osrm for route/matrix), so selection is a
	// config change, not a code change. Any other value (default "mock"/"") keeps
	// the deterministic MockProvider — dev/CI stay offline-functional.
	Provider string // "mock" (default) | "http"
	BaseURL  string // gateway root, e.g. https://maps-gw.partner.example/v1
	APIKey   string // Bearer token (server-side only); optional

	// CacheTTL for the PostGIS geocode cache (OSM-only). Defaults to 30 days.
	CacheTTL time.Duration

	// Auth is the middleware that sets user_id (the proxy requires auth).
	Auth gin.HandlerFunc

	// Cost-guard infra (optional). Redis powers cross-instance rate limiting +
	// idempotency; AlertWebhook receives budget alerts; RateLimitPerMin caps
	// per-user requests/min (default 120).
	Redis           *platformRedis.Client
	AlertWebhook    string
	RateLimitPerMin int

	// --- MapService v2 (MAPSERVICE.md): coverage-aware resolution chain ---
	V2Enabled    bool             // FEATURE_MAPS_V2_ENABLED — turns on the orchestrator
	V2ConfigPath string           // optional JSON override for thresholds/order/budgets
	HereKey      string           // HERE API key (accuracy fallback); mock when empty
	GazetteerKey string           // 32-byte AES key for gazetteer PII (NDPA); Noop when empty
	DailyBudgets map[string]int64 // per-provider daily caps; circuit-break when exceeded
}

// buildRegistry constructs the adapter registry from config. When a real key is
// absent, the deterministic MockProvider is registered UNDER THE REAL PROVIDER'S
// NAME with the right Source, so config still resolves and dev/CI stay
// functional — exactly like the invest module's mock broker/market-data.
func buildRegistry(d RouteDeps) *Registry {
	reg := NewRegistry()

	// ── Generic HTTP provider selection (config-driven) ──
	// When MAPS_PROVIDER=http and a base URL is set, ONE real adapter serves
	// geocode/reverse (under "geoapify") and route/matrix (under "osrm") — the
	// names the default surface config routes to. It is built once and reused so
	// the router resolves to it without a config-file edit. NewHTTPProvider
	// returns nil if the base URL is blank, so we fall through to the existing
	// mock/real blocks below — keeping MockProvider the default.
	var httpGeo *HTTPProvider
	var httpRoute *HTTPProvider
	if strings.EqualFold(d.Provider, "http") {
		httpGeo = NewHTTPProvider(HTTPProviderConfig{Name: "geoapify", BaseURL: d.BaseURL, APIKey: d.APIKey, Source: SourceOpenStack})
		httpRoute = NewHTTPProvider(HTTPProviderConfig{Name: "osrm", BaseURL: d.BaseURL, APIKey: d.APIKey, Source: SourceOpenStack})
		if httpGeo != nil || httpRoute != nil {
			log.Printf("[maps] MAPS_PROVIDER=http — real HTTP provider serving geocode/reverse/route/matrix via %s", redact(d.BaseURL))
		}
	}

	// ── Basemap (MapTiler / OpenStack) ──
	if d.MapTilerKey != "" || d.TileStyleURL != "" {
		reg.AddTiles(NewMapTiler(d.MapTilerKey, d.TileStyleURL))
	} else {
		reg.AddTiles(NewMockProvider("maptiler", SourceOpenStack))
	}

	// ── Geocode/reverse/autocomplete (HTTP provider / Geoapify / OpenStack) ──
	switch {
	case httpGeo != nil:
		// Real HTTP geocoder. Autocomplete/places aren't part of the HTTP contract,
		// so a mock stands in under the same name for those secondary primitives.
		reg.AddGeocoder(httpGeo)
		acmp := NewMockProvider("geoapify", SourceOpenStack)
		reg.AddAutocompleter(acmp)
		reg.AddPlaceSearcher(acmp)
	case d.GeoapifyKey != "":
		gp := NewGeoapify(d.GeoapifyKey, "ng")
		reg.AddGeocoder(gp)
		reg.AddAutocompleter(gp)
		reg.AddPlaceSearcher(gp) // degraded POI fallback
	default:
		mp := NewMockProvider("geoapify", SourceOpenStack)
		reg.AddGeocoder(mp)
		reg.AddAutocompleter(mp)
		reg.AddPlaceSearcher(mp)
	}

	// ── Routing/matrix/map-match (HTTP provider / OSRM / OpenStack) ──
	switch {
	case httpRoute != nil:
		// Real HTTP router + matrixer. Map-matching isn't in the HTTP contract, so a
		// mock stands in under the same name for live-tracking snapping.
		reg.AddRouter(httpRoute)
		reg.AddMatrixer(httpRoute)
		reg.AddMapMatcher(NewMockProvider("osrm", SourceOpenStack))
	case d.OSRMBaseURL != "":
		o := NewOSRM(d.OSRMBaseURL)
		reg.AddRouter(o)
		reg.AddMatrixer(o)
		reg.AddMapMatcher(o)
	default:
		mp := NewMockProvider("osrm", SourceOpenStack)
		reg.AddRouter(mp)
		reg.AddMatrixer(mp)
		reg.AddMapMatcher(mp)
	}

	// ── Google (autocomplete + external POI; v2 adds geocoding as accuracy fallback) ──
	if d.GoogleKey != "" {
		g := NewGoogle(d.GoogleKey, "ng")
		reg.AddAutocompleter(g)
		reg.AddPlaceSearcher(g)
		reg.AddGeocoder(g) // Google geocoding (never cached)
		reg.AddMatrixer(g) // Google Distance Matrix → delivery-fee driving distance/ETA
	} else {
		// Mock stands in under the "google" name but carries SourceGoogle so the
		// no-cache + license-coherence guards behave identically in dev/CI.
		mp := NewMockProvider("google", SourceGoogle)
		reg.AddAutocompleter(mp)
		reg.AddPlaceSearcher(mp)
		reg.AddGeocoder(mp)
		reg.AddMatrixer(mp)
	}

	// ── HERE (v2 accuracy fallback alongside Google) ──
	if d.HereKey != "" {
		h := NewHERE(d.HereKey, "ng")
		reg.AddGeocoder(h)
		reg.AddAutocompleter(h)
	} else {
		mp := NewMockProvider("here", SourceHere)
		reg.AddGeocoder(mp)
		reg.AddAutocompleter(mp)
	}

	// ── Mapbox (optional map-match fallback) ──
	if d.MapboxToken != "" {
		// Registered lazily as a mock-shaped provider until a full Mapbox adapter
		// is needed; swap in via config without touching feature code.
		reg.AddMapMatcher(NewMockProvider("mapbox", SourceMapbox))
	}

	return reg
}

// NewServiceFromDeps builds a fully-wired Service (registry + cache + repo +
// usage) from RouteDeps. Exposed so other modules (e.g. transport dispatch) can
// depend on MapService directly without going through HTTP.
func NewServiceFromDeps(d RouteDeps) (*Service, error) {
	surfaceCfg, err := LoadSurfaceConfig(d.ConfigPath)
	if err != nil {
		return nil, err
	}
	ttl := d.CacheTTL
	if ttl <= 0 {
		ttl = 30 * 24 * time.Hour
	}
	reg := buildRegistry(d)
	// CacheV2 is a drop-in GeocodeCache (it embeds *Cache) that ALSO implements
	// PutWithSource for per-source TTLs (config_v2 / cache_v2.go). Wiring it here —
	// instead of the fixed-TTL NewCache — is what makes the v2 orchestrator's
	// write-through actually honor per-source TTLs (Service.cachePut prefers
	// PutWithSource). The legacy geocode path is unaffected: it calls Put, which
	// CacheV2 inherits from *Cache unchanged (identical fixed-TTL behavior). The
	// license guard (guardCacheWrite) is identical on both write paths.
	cache := NewCacheV2(d.DB, ttl)
	repo := NewPostGISRepo(d.DB)
	// Budget alerts go to the webhook when configured, else the log.
	usage := NewUsageTracker(d.DB, surfaceCfg.Caps, NewWebhookAlerter(d.AlertWebhook))

	deps := Deps{
		Config:         surfaceCfg,
		Registry:       reg,
		Cache:          cache,
		Repo:           repo,
		Usage:          usage,
		Redis:          d.Redis,
		DefaultSurface: d.DefaultSurface,
	}

	// --- MapService v2: build the coverage-aware collaborators (gated) ---
	if d.V2Enabled && d.DB != nil {
		v2cfg, err := LoadV2Config(d.V2ConfigPath)
		if err != nil {
			return nil, err
		}
		for k, v := range d.DailyBudgets {
			v2cfg.Budgets[k] = v
		}
		// Gazetteer PII encryption (NDPA, MS-4): AES-256-GCM when a 32-byte key is
		// configured, else a Noop (dev/CI) — never store plaintext in prod.
		var enc Encryptor = NoopEncryptor{}
		if len(d.GazetteerKey) >= 32 {
			if e, eerr := NewAESEncryptor([]byte(d.GazetteerKey)[:32]); eerr == nil {
				enc = e
			} else {
				log.Printf("[maps] gazetteer key invalid (%v) — falling back to Noop encryptor", eerr)
			}
		}
		deps.V2Enabled = true
		deps.V2Config = &v2cfg
		deps.Gazetteer = NewGazetteer(d.DB, enc)
		deps.Coverage = NewCoverage(d.DB)
		deps.Recorder = NewRecorder(d.DB)
		deps.Guard = NewGuard(d.DB, v2cfg.Budgets)
		deps.Predictor = NewHistoryPredictor(d.DB)
		log.Println("[maps] v2 enabled — coverage-aware resolution chain active")
	}

	return NewService(deps), nil
}

// Mount attaches the MapService proxy under /api/finance/maps to an already-built
// Service. Split out from Register so the same Service instance can be shared with
// other modules (e.g. transport dispatch) before its routes are mounted. rl is an
// optional per-user rate-limit middleware (cost guard); pass nil to skip.
func Mount(r *gin.Engine, svc *Service, auth gin.HandlerFunc, rl gin.HandlerFunc) {
	h := NewHandler(svc)
	grp := r.Group("/api/finance/maps")
	if auth != nil {
		grp.Use(auth)
	}
	// Metrics middleware runs BEFORE the rate limiter so 429s are recorded.
	grp.Use(MetricsMiddleware())
	if rl != nil {
		grp.Use(rl)
	}
	grp.GET("/metrics", h.Metrics)
	grp.GET("/basemap", h.GetBasemap)
	grp.POST("/autocomplete", h.Autocomplete)
	grp.POST("/geocode", h.Geocode)
	grp.POST("/reverse", h.Reverse)
	grp.POST("/places", h.Places)
	grp.POST("/route", h.Route)
	grp.POST("/matrix", h.Matrix)
	grp.POST("/match", h.Match)
	grp.POST("/nearby", h.Nearby)
	grp.POST("/in-zone", h.InZone)
	grp.POST("/locations", h.UpsertLocation)
	grp.GET("/usage", h.Usage)
	log.Println("[maps] routes registered at /api/finance/maps (provider-agnostic MapService)")
}

// Register builds the Service from deps and mounts the proxy under
// /api/finance/maps, gated on the feature flag. Returns the wired Service (or nil
// when disabled) so callers may also inject it into other modules.
func Register(r *gin.Engine, d RouteDeps) *Service {
	if !d.Enabled {
		log.Println("[maps] FEATURE_MAPS_ENABLED is false — skipping routes")
		return nil
	}
	if d.DB == nil {
		log.Println("[maps] no database pool — skipping routes (PostGIS required)")
		return nil
	}
	svc, err := NewServiceFromDeps(d)
	if err != nil {
		log.Printf("[maps] config error: %v — skipping routes", err)
		return nil
	}
	Mount(r, svc, d.Auth, PerUserRateLimit(d.Redis, d.RateLimitPerMin))
	return svc
}
