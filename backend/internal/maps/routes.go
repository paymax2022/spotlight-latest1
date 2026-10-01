package maps

import (
	"context"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	platformRedis "spotlight/backend/internal/platform/redis"
	"spotlight/backend/internal/scheduler"
)

const (
	keyError = "error"
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

	if d.MapTilerKey != "" || d.TileStyleURL != "" {
		reg.AddTiles(NewMapTiler(d.MapTilerKey, d.TileStyleURL))
	} else {
		reg.AddTiles(NewMockProvider("maptiler", SourceOpenStack))
	}

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

	if d.HereKey != "" {
		h := NewHERE(d.HereKey, "ng")
		reg.AddGeocoder(h)
		reg.AddAutocompleter(h)
	} else {
		mp := NewMockProvider("here", SourceHere)
		reg.AddGeocoder(mp)
		reg.AddAutocompleter(mp)
	}

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
	// PutWithSource for per-source TTLs (). Wiring it here —
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

// startup wiring + admin surface for MapService v2 (MAPSERVICE.md
// §5/§7/§10). Additive; only runs when v2 is enabled.

// RegisterMapsV2Background seeds the Lagos coverage tiers and registers the OSM
// contribution batch job handler. Best-effort: failures are logged, never fatal.
func RegisterMapsV2Background(svc *Service, pool *pgxpool.Pool) {
	if pool == nil {
		return
	}
	// Seed coverage tiers for Lagos H3 cells (idempotent).
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := NewCoverage(pool).SeedLagos(ctx); err != nil {
			log.Printf("[maps] coverage seed (Lagos) failed: %v", err)
		}
	}()

	// Register the OSM contribution batch handler (moderated, scheduler-driven).
	sched := scheduler.NewService(pool)
	pipeline := NewOSMPipeline(NewContributionService(pool), NoopOSMUploader{})
	RegisterContributionJob(sched, pipeline)
	log.Println("[maps] v2 background wired (coverage seed + OSM contribution job registered)")
}

// mapsV2Admin holds the read/review collaborators for the admin dashboard.
type mapsV2Admin struct {
	rec     *Recorder
	guard   *Guard
	contrib *ContributionService
	cov     *Coverage
}

// RegisterMapsV2Admin mounts the cost/coverage/provider-health dashboard +
// OSM contribution review under /api/maps/admin, gated by RBAC (map.admin.review).
// auth sets user_id; perm enforces the permission (built by the caller).
func RegisterMapsV2Admin(r *gin.Engine, pool *pgxpool.Pool, auth, perm gin.HandlerFunc) {
	if pool == nil {
		return
	}
	a := &mapsV2Admin{
		rec:     NewRecorder(pool),
		guard:   NewGuard(pool, nil),
		contrib: NewContributionService(pool),
		cov:     NewCoverage(pool),
	}
	grp := r.Group("/api/maps/admin")
	if auth != nil {
		grp.Use(auth)
	}
	if perm != nil {
		grp.Use(perm)
	}
	grp.GET("/dashboard", a.dashboard)
	grp.GET("/events", a.events)
	grp.GET("/providers", a.providers)
	grp.GET("/contributions", a.listContributions)
	grp.POST("/contributions/:id/review", a.reviewContribution)
	log.Println("[maps] v2 admin dashboard registered at /api/maps/admin (map.admin.review)")
}

func (a *mapsV2Admin) sinceParam(c *gin.Context) time.Time {
	days := 7
	if v := c.Query("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 365 {
			days = n
		}
	}
	return time.Now().AddDate(0, 0, -days)
}

// dashboard returns paid-vs-deflected rollups + provider health (MS-7).
func (a *mapsV2Admin) dashboard(c *gin.Context) {
	stats, err := a.rec.DeflectionStats(c.Request.Context(), a.sinceParam(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: err.Error()})
		return
	}
	health, _ := a.guard.Snapshot(c.Request.Context())
	c.JSON(http.StatusOK, gin.H{"deflection": stats, "deflection_rate": stats.DeflectionRate(), "providers": health})
}

func (a *mapsV2Admin) events(c *gin.Context) {
	limit := 100
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	evs, err := a.rec.RecentEvents(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"events": evs})
}

func (a *mapsV2Admin) providers(c *gin.Context) {
	health, err := a.guard.Snapshot(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"providers": health})
}

func (a *mapsV2Admin) listContributions(c *gin.Context) {
	status := c.DefaultQuery("status", "pending")
	rows, err := a.contrib.ListForReview(c.Request.Context(), status, 200)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"candidates": rows})
}

func (a *mapsV2Admin) reviewContribution(c *gin.Context) {
	var body struct {
		Action string `json:"action" binding:"required"` // approve | reject
		Notes  string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: err.Error()})
		return
	}
	out, err := a.contrib.Review(c.Request.Context(), c.Param("id"), ginutil.UserID(c), body.Action, body.Notes)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{keyError: err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}
