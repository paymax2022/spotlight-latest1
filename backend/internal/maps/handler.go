package maps

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes MapService over HTTP. The client calls THESE endpoints, never
// a provider directly — so provider API keys stay server-side. Responses carry
// the provider + source so the client knows which basemap a result may render on.
type Handler struct {
	svc *Service
}

// NewHandler builds the proxy handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

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
	res, err := h.svc.ReverseGeocode(c.Request.Context(), in.Lat, in.Lng, in.Surface)
	if err != nil {
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

// GET /metrics — Prometheus text exposition (RED + cache/degradation + usage).
func (h *Handler) Metrics(c *gin.Context) {
	body := mx.render()
	if rows, err := h.svc.UsageSnapshot(c.Request.Context()); err == nil {
		body += renderUsage(rows)
	}
	c.Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	c.String(http.StatusOK, body)
}

// GET /usage — per-provider/per-primitive monthly usage (cost guard metrics).
func (h *Handler) Usage(c *gin.Context) {
	rows, err := h.svc.UsageSnapshot(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"month": currentMonth(), "usage": rows})
}
