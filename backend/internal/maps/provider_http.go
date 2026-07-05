package maps

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// HTTPProvider — a REAL, config-driven maps provider behind a documented generic
// JSON contract. It mirrors the invest module's provider_http.go pattern: the
// same interfaces the mock satisfies (Geocoder / Router / Matrixer), so swapping
// it in is a config change — never a business-logic change. Feature code (and the
// transport pricing engine) keep depending only on MapService / MapsAdapter.
//
// Point it at:
//   - a thin gateway/shim you control that fronts Google Distance Matrix /
//     Directions / Geocoding, or Mapbox Directions / Matrix / Geocoding, mapping
//     the partner response onto the contract below, OR
//   - any service that already speaks this contract.
//
// The selection is config-driven: MAPS_PROVIDER=http + MAPS_BASE_URL (+ optional
// MAPS_API_KEY). When unconfigured the deterministic MockProvider stays the
// default, so dev/CI stay fully functional and offline.
//
// ── Units (IMPORTANT) ────────────────────────────────────────────────────────
// The wire contract speaks SI base units so no provider-specific scaling leaks
// in: distance in METRES, duration in SECONDS — exactly what Route.DistanceM /
// Route.DurationS / MatrixCell.* carry. The transport pricing engine
// (transport/pricing.go) reads route.DistanceM (metres → km via /1000) and
// route.DurationS (seconds → minutes), so emitting metres+seconds here means the
// fare math is correct with zero conversion at the call site. If a partner returns
// kilometres or minutes, convert in the gateway/shim, not here.
//
// ── License/Source ───────────────────────────────────────────────────────────
// Results are tagged with a configurable Source (default SourceOpenStack) so the
// cache + renderer guards behave coherently. Use SourceOpenStack for an OSM-based
// gateway (Mapbox/OSRM/Geoapify-style, cacheable) and SourceGoogle for a Google
// gateway (never cached, Google-basemap-only). Distance/route geometry itself is
// not subject to the geocode cache, but the Source still travels for coherence.
// ─────────────────────────────────────────────────────────────────────────────

// HTTPProviderConfig configures the real HTTP maps provider.
type HTTPProviderConfig struct {
	// Name is the provider id this adapter registers under (e.g. "osrm",
	// "geoapify", "http"). buildRegistry registers it under the names the surface
	// config routes to, so the router resolves to it with no config edit.
	Name string
	// BaseURL is the gateway root, e.g. https://maps-gw.partner.example/v1
	// (no trailing slash required). Required; empty disables the provider.
	BaseURL string
	// APIKey is sent as a Bearer token when set. Server-side only.
	APIKey string
	// Source tags every result for license coherence (default SourceOpenStack).
	Source Source
	// Timeout per request (default 8s).
	Timeout time.Duration
	codec   PlusCodec
}

// HTTPProvider implements Geocoder, Router and Matrixer against the JSON contract
// documented per-method below.
type HTTPProvider struct {
	cfg    HTTPProviderConfig
	client *http.Client
}

// NewHTTPProvider builds the adapter. An empty BaseURL yields a nil provider so
// callers can fall back to the mock (see buildRegistry).
func NewHTTPProvider(cfg HTTPProviderConfig) *HTTPProvider {
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return nil
	}
	if cfg.Name == "" {
		cfg.Name = "http"
	}
	if cfg.Source == "" {
		cfg.Source = SourceOpenStack
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 8 * time.Second
	}
	cfg.BaseURL = strings.TrimRight(cfg.BaseURL, "/")
	cfg.codec = NewPlusCodec()
	return &HTTPProvider{cfg: cfg, client: &http.Client{Timeout: cfg.Timeout}}
}

func (h *HTTPProvider) Name() string { return h.cfg.Name }

// ── Geocoder ─────────────────────────────────────────────────────────────────

// Geocode resolves an address to a coordinate.
//
// Expected GET {base}/geocode?address=... → 200
//
//	{ "lat":6.4541,"lng":3.3947,"address":"12 Marina, Lagos","plus_code":"6FR5C8R4+8Q" }
func (h *HTTPProvider) Geocode(ctx context.Context, address string) (GeoResult, error) {
	if address == "" {
		return GeoResult{}, ErrEmptyQuery
	}
	var body struct {
		Lat      float64 `json:"lat"`
		Lng      float64 `json:"lng"`
		Address  string  `json:"address"`
		PlusCode string  `json:"plus_code"`
	}
	if err := h.get(ctx, "/geocode?address="+queryEscape(address), &body); err != nil {
		return GeoResult{}, err
	}
	return h.geoResult(body.Lat, body.Lng, firstNonEmpty(body.Address, address), body.PlusCode), nil
}

// ReverseGeocode resolves a coordinate to an address.
//
// Expected GET {base}/reverse?lat=..&lng=.. → 200
//
//	{ "lat":6.4541,"lng":3.3947,"address":"12 Marina, Lagos","plus_code":"..." }
func (h *HTTPProvider) ReverseGeocode(ctx context.Context, lat, lng float64) (GeoResult, error) {
	var body struct {
		Lat      float64 `json:"lat"`
		Lng      float64 `json:"lng"`
		Address  string  `json:"address"`
		PlusCode string  `json:"plus_code"`
	}
	path := fmt.Sprintf("/reverse?lat=%f&lng=%f", lat, lng)
	if err := h.get(ctx, path, &body); err != nil {
		return GeoResult{}, err
	}
	// Trust the supplied coordinate if the gateway echoes zeros.
	outLat, outLng := body.Lat, body.Lng
	if outLat == 0 && outLng == 0 {
		outLat, outLng = lat, lng
	}
	return h.geoResult(outLat, outLng, body.Address, body.PlusCode), nil
}

func (h *HTTPProvider) geoResult(lat, lng float64, address, plusCode string) GeoResult {
	if plusCode == "" {
		plusCode = h.cfg.codec.Encode(lat, lng)
	}
	return GeoResult{
		Lat: lat, Lng: lng, Address: address, PlusCode: plusCode,
		Provider: h.cfg.Name, Source: h.cfg.Source,
		Cacheable: isCacheableSource(h.cfg.Source),
	}
}

// ── Router ───────────────────────────────────────────────────────────────────

// Route computes a single origin→destination route.
//
// Expected GET {base}/route?from_lat=..&from_lng=..&to_lat=..&to_lng=..&profile=driving → 200
//
//	{ "distance_m":4230,"duration_s":612,"polyline":"a~l~Fjk~uOwHJy@P" }
//
// distance_m is METRES, duration_s is SECONDS — the units Route carries and the
// pricing engine expects. polyline is an encoded polyline (geometry), passed
// through verbatim.
func (h *HTTPProvider) Route(ctx context.Context, origin, dest Point, opts RouteOptions) (Route, error) {
	profile := opts.Profile
	if profile == "" {
		profile = "driving"
	}
	path := fmt.Sprintf("/route?from_lat=%f&from_lng=%f&to_lat=%f&to_lng=%f&profile=%s",
		origin.Lat, origin.Lng, dest.Lat, dest.Lng, queryEscape(profile))
	var body struct {
		DistanceM float64 `json:"distance_m"`
		DurationS float64 `json:"duration_s"`
		Polyline  string  `json:"polyline"`
	}
	if err := h.get(ctx, path, &body); err != nil {
		return Route{}, err
	}
	return Route{
		DistanceM: int(body.DistanceM + 0.5),
		DurationS: int(body.DurationS + 0.5),
		Polyline:  body.Polyline,
		Provider:  h.cfg.Name, Source: h.cfg.Source,
	}, nil
}

// ── Matrixer ─────────────────────────────────────────────────────────────────

// Matrix computes a many-to-many distance/ETA grid (dispatch).
//
// Expected POST {base}/matrix → 200
//
//	req:  { "origins":[{"lat":..,"lng":..}],"destinations":[{"lat":..,"lng":..}] }
//	resp: { "rows":[ [ {"distance_m":4230,"duration_s":612}, ... ], ... ] }
//
// rows[i][j] is origins[i] → destinations[j]; units are metres + seconds.
func (h *HTTPProvider) Matrix(ctx context.Context, origins, dests []Point) (Matrix, error) {
	type llt struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	}
	req := struct {
		Origins      []llt `json:"origins"`
		Destinations []llt `json:"destinations"`
	}{
		Origins:      make([]llt, len(origins)),
		Destinations: make([]llt, len(dests)),
	}
	for i, p := range origins {
		req.Origins[i] = llt{Lat: p.Lat, Lng: p.Lng}
	}
	for j, p := range dests {
		req.Destinations[j] = llt{Lat: p.Lat, Lng: p.Lng}
	}
	var body struct {
		Rows [][]struct {
			DistanceM float64 `json:"distance_m"`
			DurationS float64 `json:"duration_s"`
		} `json:"rows"`
	}
	if err := h.post(ctx, "/matrix", req, &body); err != nil {
		return Matrix{}, err
	}
	rows := make([][]MatrixCell, len(body.Rows))
	for i, row := range body.Rows {
		cells := make([]MatrixCell, len(row))
		for j, c := range row {
			cells[j] = MatrixCell{DistanceM: int(c.DistanceM + 0.5), DurationS: int(c.DurationS + 0.5)}
		}
		rows[i] = cells
	}
	return Matrix{Rows: rows, Provider: h.cfg.Name, Source: h.cfg.Source}, nil
}

// ── Health ───────────────────────────────────────────────────────────────────

// Healthy probes GET {base}/health and reports connectivity. Used by ops/readiness
// checks to confirm the gateway is reachable before relying on the real provider.
func (h *HTTPProvider) Healthy(ctx context.Context) (bool, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.cfg.BaseURL+"/health", nil)
	if err != nil {
		return false, err.Error()
	}
	h.auth(req)
	resp, err := h.client.Do(req)
	if err != nil {
		return false, err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false, fmt.Sprintf("status %d", resp.StatusCode)
	}
	return true, "ok"
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

func (h *HTTPProvider) auth(req *http.Request) {
	if h.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+h.cfg.APIKey)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "spotlight-mapservice/1.0")
}

func (h *HTTPProvider) get(ctx context.Context, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.cfg.BaseURL+path, nil)
	if err != nil {
		return err
	}
	h.auth(req)
	return h.do(req, dst)
}

func (h *HTTPProvider) post(ctx context.Context, path string, payload, dst any) error {
	buf, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.cfg.BaseURL+path, strings.NewReader(string(buf)))
	if err != nil {
		return err
	}
	h.auth(req)
	req.Header.Set("Content-Type", "application/json")
	return h.do(req, dst)
}

func (h *HTTPProvider) do(req *http.Request, dst any) error {
	resp, err := h.client.Do(req)
	if err != nil {
		return fmt.Errorf("maps: http provider: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("maps: http provider %d from %s: %s", resp.StatusCode, redact(req.URL.String()), string(body))
	}
	if dst == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(dst)
}

// queryEscape percent-encodes a query value without pulling net/url into the
// per-call signature (kept local for readability + redaction symmetry).
func queryEscape(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
			continue
		}
		const hex = "0123456789ABCDEF"
		b.WriteByte('%')
		b.WriteByte(hex[c>>4])
		b.WriteByte(hex[c&0x0f])
	}
	return b.String()
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// Compile-time assertions: the HTTP provider satisfies the same primitive roles
// the mock does for geocode / route / matrix.
var (
	_ Geocoder = (*HTTPProvider)(nil)
	_ Router   = (*HTTPProvider)(nil)
	_ Matrixer = (*HTTPProvider)(nil)
	_ Named    = (*HTTPProvider)(nil)
)
