package maps

import (
	"log"
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

	// CacheTTL for the PostGIS geocode cache (OSM-only). Defaults to 30 days.
	CacheTTL time.Duration

	// Auth is the middleware that sets user_id (the proxy requires auth).
	Auth gin.HandlerFunc

	// Cost-guard infra (optional). Redis powers cross-instance rate limiting +
	// idempotency; AlertWebhook receives budget alerts; RateLimitPerMin caps
	// per-user requests/min (default 120).
	Redis          *platformRedis.Client
	AlertWebhook   string
	RateLimitPerMin int
}

// buildRegistry constructs the adapter registry from config. When a real key is
// absent, the deterministic MockProvider is registered UNDER THE REAL PROVIDER'S
// NAME with the right Source, so config still resolves and dev/CI stay
// functional — exactly like the invest module's mock broker/market-data.
func buildRegistry(d RouteDeps) *Registry {
	reg := NewRegistry()

	// ── Basemap (MapTiler / OpenStack) ──
	if d.MapTilerKey != "" || d.TileStyleURL != "" {
		reg.AddTiles(NewMapTiler(d.MapTilerKey, d.TileStyleURL))
	} else {
		reg.AddTiles(NewMockProvider("maptiler", SourceOpenStack))
	}

	// ── Geocode/reverse/autocomplete (Geoapify / OpenStack) ──
	if d.GeoapifyKey != "" {
		gp := NewGeoapify(d.GeoapifyKey, "ng")
		reg.AddGeocoder(gp)
		reg.AddAutocompleter(gp)
		reg.AddPlaceSearcher(gp) // degraded POI fallback
	} else {
		mp := NewMockProvider("geoapify", SourceOpenStack)
		reg.AddGeocoder(mp)
		reg.AddAutocompleter(mp)
		reg.AddPlaceSearcher(mp)
	}

	// ── Routing/matrix/map-match (OSRM / OpenStack) ──
	if d.OSRMBaseURL != "" {
		o := NewOSRM(d.OSRMBaseURL)
		reg.AddRouter(o)
		reg.AddMatrixer(o)
		reg.AddMapMatcher(o)
	} else {
		mp := NewMockProvider("osrm", SourceOpenStack)
		reg.AddRouter(mp)
		reg.AddMatrixer(mp)
		reg.AddMapMatcher(mp)
	}

	// ── Google (autocomplete + external POI ONLY) ──
	if d.GoogleKey != "" {
		g := NewGoogle(d.GoogleKey, "ng")
		reg.AddAutocompleter(g)
		reg.AddPlaceSearcher(g)
	} else {
		// Mock stands in under the "google" name but carries SourceGoogle so the
		// no-cache + license-coherence guards behave identically in dev/CI.
		mp := NewMockProvider("google", SourceGoogle)
		reg.AddAutocompleter(mp)
		reg.AddPlaceSearcher(mp)
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
	cache := NewCache(d.DB, ttl)
	repo := NewPostGISRepo(d.DB)
	// Budget alerts go to the webhook when configured, else the log.
	usage := NewUsageTracker(d.DB, surfaceCfg.Caps, NewWebhookAlerter(d.AlertWebhook))

	return NewService(Deps{
		Config:         surfaceCfg,
		Registry:       reg,
		Cache:          cache,
		Repo:           repo,
		Usage:          usage,
		Redis:          d.Redis,
		DefaultSurface: d.DefaultSurface,
	}), nil
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
