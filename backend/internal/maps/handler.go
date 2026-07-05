package maps

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
)

// Handler exposes MapService over HTTP. The client calls THESE endpoints, never
// a provider directly — so provider API keys stay server-side. Responses carry
// the provider + source so the client knows which basemap a result may render on.
type Handler struct {
	svc *Service
}

// NewHandler builds the proxy handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// needsPinBody is the structured, actionable response surfaced when resolution
// ends in ErrNeedsPin: confidence fell below the floor (or every provider was
// unavailable), so the client should prompt the user to drop a precise pin.
// NEEDS_PIN is a degrade, never a hard failure (MAPSERVICE.md §2 principle 7) —
// we return HTTP 200 with an explicit, machine-readable flag rather than a 5xx,
// so clients branch on `needs_pin` instead of error-handling a generic failure.
func needsPinBody() gin.H {
	return gin.H{
		"needs_pin": true,
		"message":   "We couldn't pin this precisely — please drop a pin.",
	}
}

// respondNeedsPin writes the NEEDS_PIN degrade response if err is ErrNeedsPin and
// reports whether it handled the error. Keeps Geocode/Reverse paths tidy.
func respondNeedsPin(c *gin.Context, err error) bool {
	if errors.Is(err, ErrNeedsPin) {
		c.JSON(http.StatusOK, needsPinBody())
		return true
	}
	return false
}

// validateLatLng enforces valid WGS-84 coordinate bounds BEFORE any provider call
// (input hardening). Latitude must be in [-90, 90] and longitude in [-180, 180].
// The (0,0) "null island" point is allowed — it is a valid coordinate and some
// callers legitimately probe it — so we bound-check only, never reject zero. It
// returns a human-readable reason on failure (empty string on success).
func validateLatLng(lat, lng float64) string {
	// NaN/Inf never satisfy these comparisons, so they are rejected here too.
	if !(lat >= -90 && lat <= 90) {
		return "lat must be between -90 and 90"
	}
	if !(lng >= -180 && lng <= 180) {
		return "lng must be between -180 and 180"
	}
	return ""
}

// validatePoint bound-checks a Point's coordinates. Reused by every endpoint that
// accepts a coordinate so the rule lives in exactly one place.
func validatePoint(p Point) string { return validateLatLng(p.Lat, p.Lng) }

// badLatLng writes the standard HTTP 400 for a coordinate validation failure.
func badLatLng(c *gin.Context, reason string) {
	c.JSON(http.StatusBadRequest, gin.H{"error": reason})
}

func status(err error) int {
	switch {
	case errors.Is(err, ErrEmptyQuery):
		return http.StatusBadRequest
	case errors.Is(err, ErrNoProvider):
		return http.StatusServiceUnavailable
	case errors.Is(err, ErrLicenseCoherence):
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

// GET /basemap?surface=checkout
func (h *Handler) GetBasemap(c *gin.Context) {
	cfg, err := h.svc.GetBasemapConfig(c.Request.Context(), c.Query("surface"))
	if err != nil {
		c.JSON(status(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

type autocompleteReq struct {
	Query        string `json:"query"`
	SessionToken string `json:"session_token"`
	Surface      string `json:"surface"`
	Near         *Point `json:"near"`
}

// POST /autocomplete
func (h *Handler) Autocomplete(c *gin.Context) {
	var in autocompleteReq
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if in.Near != nil {
		if reason := validatePoint(*in.Near); reason != "" {
			badLatLng(c, "near: "+reason)
			return
		}
	}
	out, err := h.svc.AutocompleteAddress(c.Request.Context(), in.Query, in.SessionToken, in.Surface, in.Near)
	if err != nil {
		c.JSON(status(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"suggestions": out})
}

type geocodeReq struct {
	Address string `json:"address"`
	Surface string `json:"surface"`
}

// POST /geocode
func (h *Handler) Geocode(c *gin.Context) {
	var in geocodeReq
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	res, err := h.svc.Geocode(c.Request.Context(), in.Address, in.Surface)
	if err != nil {
		if respondNeedsPin(c, err) {
			return
		}
		c.JSON(status(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

type reverseReq struct {
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Surface string  `json:"surface"`
}

// POST /reverse
func (h *Handler) Reverse(c *gin.Context) {
	var in reverseReq
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if reason := validateLatLng(in.Lat, in.Lng); reason != "" {
		badLatLng(c, reason)
		return
	}
	res, err := h.svc.ReverseGeocode(c.Request.Context(), in.Lat, in.Lng, in.Surface)
	if err != nil {
		if respondNeedsPin(c, err) {
			return
		}
		c.JSON(status(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

type placesReq struct {
	Query string `json:"query"`
	Near  *Point `json:"near"`
}

// POST /places
func (h *Handler) Places(c *gin.Context) {
	var in placesReq
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if in.Near != nil {
		if reason := validatePoint(*in.Near); reason != "" {
			badLatLng(c, "near: "+reason)
			return
		}
	}
	out, err := h.svc.SearchExternalPlaces(c.Request.Context(), in.Query, in.Near)
	if err != nil {
		c.JSON(status(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"places": out})
}

type routeReq struct {
	Origin  Point  `json:"origin"`
	Dest    Point  `json:"dest"`
	Profile string `json:"profile"`
}

// POST /route
func (h *Handler) Route(c *gin.Context) {
	var in routeReq
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if reason := validatePoint(in.Origin); reason != "" {
		badLatLng(c, "origin: "+reason)
		return
	}
	if reason := validatePoint(in.Dest); reason != "" {
		badLatLng(c, "dest: "+reason)
		return
	}
	res, err := h.svc.GetRoute(c.Request.Context(), in.Origin, in.Dest, RouteOptions{Profile: in.Profile})
	if err != nil {
		c.JSON(status(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

type matrixReq struct {
	Origins []Point `json:"origins"`
	Dests   []Point `json:"dests"`
}

// POST /matrix
func (h *Handler) Matrix(c *gin.Context) {
	var in matrixReq
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if len(in.Origins) == 0 || len(in.Dests) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "origins and dests must be non-empty"})
		return
	}
	for i, p := range in.Origins {
		if reason := validatePoint(p); reason != "" {
			badLatLng(c, fmt.Sprintf("origins[%d]: %s", i, reason))
			return
		}
	}
	for i, p := range in.Dests {
		if reason := validatePoint(p); reason != "" {
			badLatLng(c, fmt.Sprintf("dests[%d]: %s", i, reason))
			return
		}
	}
	res, err := h.svc.GetDistanceMatrix(c.Request.Context(), in.Origins, in.Dests)
	if err != nil {
		c.JSON(status(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

type matchReq struct {
	Trace []Point `json:"trace"`
}

// POST /match
func (h *Handler) Match(c *gin.Context) {
	var in matchReq
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if len(in.Trace) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trace must be non-empty"})
		return
	}
	for i, p := range in.Trace {
		if reason := validatePoint(p); reason != "" {
			badLatLng(c, fmt.Sprintf("trace[%d]: %s", i, reason))
			return
		}
	}
	res, err := h.svc.MatchToRoad(c.Request.Context(), in.Trace)
	if err != nil {
		c.JSON(status(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

type nearbyReq struct {
	EntityType string  `json:"entity_type"`
	Point      Point   `json:"point"`
	RadiusM    float64 `json:"radius_m"`
	Limit      int     `json:"limit"`
}

// POST /nearby — "near me", PostGIS only.
func (h *Handler) Nearby(c *gin.Context) {
	var in nearbyReq
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if reason := validatePoint(in.Point); reason != "" {
		badLatLng(c, "point: "+reason)
		return
	}
	if in.RadiusM < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "radius_m must be non-negative"})
		return
	}
	out, err := h.svc.FindNearbyOwn(c.Request.Context(), in.EntityType, in.Point, in.RadiusM, in.Limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"results": out})
}

type inZoneReq struct {
	Point  Point  `json:"point"`
	ZoneID string `json:"zone_id"`
}

// POST /in-zone — geofence check, PostGIS only.
func (h *Handler) InZone(c *gin.Context) {
	var in inZoneReq
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if reason := validatePoint(in.Point); reason != "" {
		badLatLng(c, "point: "+reason)
		return
	}
	if in.ZoneID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "zone_id required"})
		return
	}
	inside, err := h.svc.IsInZone(c.Request.Context(), in.Point, in.ZoneID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"in_zone": inside})
}

type locationReq struct {
	EntityID   string  `json:"entity_id"`
	EntityType string  `json:"entity_type"`
	Lat        float64 `json:"lat"`
	Lng        float64 `json:"lng"`
	PlusCode   string  `json:"plus_code"`
}

// POST /locations — persist a confirmed map pin + Plus Code (Nigeria design rule:
// the pin + Plus Code is the source of truth, the typed address is a label).
func (h *Handler) UpsertLocation(c *gin.Context) {
	var in locationReq
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if in.EntityID == "" || in.EntityType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "entity_id and entity_type required"})
		return
	}
	// Validate the pin coordinates BEFORE deriving a Plus Code or persisting — a
	// bad coordinate would otherwise be silently encoded and stored.
	if reason := validateLatLng(in.Lat, in.Lng); reason != "" {
		badLatLng(c, reason)
		return
	}
	// Idempotency: a repeated Idempotency-Key within the window is a no-op
	// (the upsert is naturally idempotent; this also short-circuits retries).
	if !h.svc.IdempotentFirst(c.Request.Context(), c.GetHeader("Idempotency-Key")) {
		c.JSON(http.StatusOK, gin.H{"ok": true, "deduplicated": true})
		return
	}
	plus := in.PlusCode
	if plus == "" {
		plus = h.svc.PlusCode().Encode(in.Lat, in.Lng)
	}
	err := h.svc.Repo().UpsertLocation(c.Request.Context(),
		OwnEntity{EntityID: in.EntityID, Lat: in.Lat, Lng: in.Lng},
		in.EntityType, plus)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "plus_code": plus})
}

// adminRoleSlugs are the roles permitted to read provider cost/usage telemetry.
// Kept in sync with the RBAC role slugs used elsewhere (see rbac personas tests).
var adminRoleSlugs = map[string]bool{"admin": true, "super_admin": true}

// requireAdmin gates cost/usage telemetry to admins. It reads the authenticated
// user that middleware.RequireAuthContext places in the gin context (key
// "authUser") and checks its role slugs. The maps proxy is always mounted behind
// RequireAuthContext (finance_routes.go mapsAuth()), so the context is populated.
//
// FAIL-CLOSED: if no authenticated user is present (context missing) OR the user
// carries no admin role, the request is rejected 403 — provider cost/usage must
// never leak to a non-admin caller. Returns true when the handler may proceed.
//
// NOTE: this is an in-handler defence-in-depth guard. The route-registration owner
// (finance_routes.go / transport) SHOULD additionally wrap GET /metrics and
// GET /usage with middleware.RequirePermission(rbac, "maps:metrics:read") so the
// gate is enforced at the router edge too. See the report for the exact change.
func (h *Handler) requireAdmin(c *gin.Context) bool {
	u, ok := middleware.GetAuthenticatedUser(c)
	if !ok {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin only"})
		return false
	}
	for _, r := range u.Roles {
		if adminRoleSlugs[r] {
			return true
		}
	}
	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin only"})
	return false
}

// GET /metrics — Prometheus text exposition (RED + cache/degradation + usage).
// Admin-gated: provider cost/usage figures are sensitive operational telemetry.
func (h *Handler) Metrics(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	body := mx.render()
	if rows, err := h.svc.UsageSnapshot(c.Request.Context()); err == nil {
		body += renderUsage(rows)
	}
	c.Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	c.String(http.StatusOK, body)
}

// GET /usage — per-provider/per-primitive monthly usage (cost guard metrics).
// Admin-gated: exposes provider spend/usage; not for ordinary authenticated users.
func (h *Handler) Usage(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	rows, err := h.svc.UsageSnapshot(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"month": currentMonth(), "usage": rows})
}
