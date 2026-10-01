package maps

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
)

// MapTiler is the OpenStack basemap/tile provider. It returns a MapLibre GL
// style URL + attribution. The API key is embedded server-side in the style URL
// proxied to the client; for stricter key hygiene point MapsTileStyleURL at a
// self-hosted style and swap provider in config (no code change).
type MapTiler struct {
	apiKey     string
	styleURL   string // optional explicit style override
	defaultMap string // MapTiler style id, e.g. "streets-v2"
}

// NewMapTiler builds the adapter. styleOverride wins when set.
func NewMapTiler(apiKey, styleOverride string) *MapTiler {
	return &MapTiler{apiKey: apiKey, styleURL: styleOverride, defaultMap: "streets-v2"}
}

func (m *MapTiler) Name() string { return "maptiler" }

// BasemapConfig returns the style + attribution for MapLibre GL.
func (m *MapTiler) BasemapConfig(_ context.Context, surface string) (StyleConfig, error) {
	style := m.styleURL
	if style == "" {
		style = fmt.Sprintf("https://api.maptiler.com/maps/%s/style.json?key=%s", m.defaultMap, m.apiKey)
	}
	return StyleConfig{
		StyleURL:    style,
		Attribution: "© MapTiler © OpenStreetMap contributors",
		Provider:    m.Name(),
		Source:      SourceOpenStack,
	}, nil
}

var _ TileProvider = (*MapTiler)(nil)

// OSRM is the self-hosted OpenStack routing engine. It serves single routes,
// many-to-many distance matrices (dispatch), and map-matching (live tracking).
// All output is Source=openstack and renderable on the OpenStack basemap.
type OSRM struct {
	baseURL string // e.g. http://osrm:5000 (no trailing slash)
	profile string // default routing profile
}

// NewOSRM builds the adapter against a self-hosted OSRM base URL.
func NewOSRM(baseURL string) *OSRM {
	return &OSRM{baseURL: strings.TrimRight(baseURL, "/"), profile: "driving"}
}

func (o *OSRM) Name() string { return "osrm" }

func (o *OSRM) profileOf(opts RouteOptions) string {
	if opts.Profile != "" {
		return opts.Profile
	}
	return o.profile
}

func coord(p Point) string {
	return strconv.FormatFloat(p.Lng, 'f', 6, 64) + "," + strconv.FormatFloat(p.Lat, 'f', 6, 64)
}

func coords(pts []Point) string {
	parts := make([]string, len(pts))
	for i, p := range pts {
		parts[i] = coord(p)
	}
	return strings.Join(parts, ";")
}

type osrmRouteResp struct {
	Code   string `json:"code"`
	Routes []struct {
		Distance float64 `json:"distance"`
		Duration float64 `json:"duration"`
		Geometry string  `json:"geometry"`
	} `json:"routes"`
}

func (o *OSRM) Route(ctx context.Context, origin, dest Point, opts RouteOptions) (Route, error) {
	u := fmt.Sprintf("%s/route/v1/%s/%s;%s?overview=full&geometries=polyline",
		o.baseURL, o.profileOf(opts), coord(origin), coord(dest))
	var r osrmRouteResp
	if err := getJSON(ctx, u, &r); err != nil {
		return Route{}, err
	}
	if r.Code != "Ok" || len(r.Routes) == 0 {
		return Route{}, fmt.Errorf("maps: osrm route code=%s", r.Code)
	}
	rt := r.Routes[0]
	return Route{
		DistanceM: int(rt.Distance), DurationS: int(rt.Duration), Polyline: rt.Geometry,
		Provider: o.Name(), Source: SourceOpenStack,
	}, nil
}

type osrmTableResp struct {
	Code      string      `json:"code"`
	Durations [][]float64 `json:"durations"`
	Distances [][]float64 `json:"distances"`
}

func (o *OSRM) Matrix(ctx context.Context, origins, dests []Point) (Matrix, error) {
	all := append(append([]Point{}, origins...), dests...)
	srcIdx := make([]string, len(origins))
	for i := range origins {
		srcIdx[i] = strconv.Itoa(i)
	}
	dstIdx := make([]string, len(dests))
	for j := range dests {
		dstIdx[j] = strconv.Itoa(len(origins) + j)
	}
	u := fmt.Sprintf("%s/table/v1/%s/%s?annotations=duration,distance&sources=%s&destinations=%s",
		o.baseURL, o.profile, coords(all), strings.Join(srcIdx, ";"), strings.Join(dstIdx, ";"))
	var r osrmTableResp
	if err := getJSON(ctx, u, &r); err != nil {
		return Matrix{}, err
	}
	if r.Code != "Ok" {
		return Matrix{}, fmt.Errorf("maps: osrm table code=%s", r.Code)
	}
	rows := make([][]MatrixCell, len(origins))
	for i := range origins {
		row := make([]MatrixCell, len(dests))
		for j := range dests {
			cell := MatrixCell{}
			if i < len(r.Durations) && j < len(r.Durations[i]) {
				cell.DurationS = int(r.Durations[i][j])
			}
			if i < len(r.Distances) && j < len(r.Distances[i]) {
				cell.DistanceM = int(r.Distances[i][j])
			}
			row[j] = cell
		}
		rows[i] = row
	}
	return Matrix{Rows: rows, Provider: o.Name(), Source: SourceOpenStack}, nil
}

type osrmMatchResp struct {
	Code      string `json:"code"`
	Matchings []struct {
		Geometry string `json:"geometry"`
	} `json:"matchings"`
}

func (o *OSRM) MatchToRoad(ctx context.Context, trace []Point) (Polyline, error) {
	if len(trace) < 2 {
		return Polyline{}, errors.New("maps: map-match needs >=2 points")
	}
	u := fmt.Sprintf("%s/match/v1/%s/%s?geometries=polyline&overview=full",
		o.baseURL, o.profile, coords(trace))
	var r osrmMatchResp
	if err := getJSON(ctx, u, &r); err != nil {
		return Polyline{}, err
	}
	if r.Code != "Ok" || len(r.Matchings) == 0 {
		return Polyline{}, fmt.Errorf("maps: osrm match code=%s", r.Code)
	}
	return Polyline{Encoded: r.Matchings[0].Geometry, Provider: o.Name(), Source: SourceOpenStack}, nil
}

var (
	_ Router     = (*OSRM)(nil)
	_ Matrixer   = (*OSRM)(nil)
	_ MapMatcher = (*OSRM)(nil)
)

const earthRadiusM = 6371000.0

// haversineM is the great-circle distance between two points in metres.
func haversineM(a, b Point) float64 {
	lat1 := a.Lat * math.Pi / 180
	lat2 := b.Lat * math.Pi / 180
	dLat := (b.Lat - a.Lat) * math.Pi / 180
	dLng := (b.Lng - a.Lng) * math.Pi / 180
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusM * math.Asin(math.Min(1, math.Sqrt(h)))
}

// MockProvider is a deterministic, network-free implementation of every adapter
// role. It stands in for a real provider when no key is configured, so dev/CI
// stay fully functional and tests are deterministic. It is registered under the
// REAL provider's name (e.g. "geoapify", "osrm", "maptiler") and carries that
// provider's Source so license/coherence behaviour matches production.
type MockProvider struct {
	name        string
	source      Source
	avgSpeedMPS float64
	codec       PlusCodec
}

// NewMockProvider builds a mock that reports the given name + source.
func NewMockProvider(name string, source Source) *MockProvider {
	return &MockProvider{name: name, source: source, avgSpeedMPS: 8.33, codec: NewPlusCodec()}
}

func (m *MockProvider) Name() string { return m.name }

// BasemapConfig returns a deterministic style URL (no key leaked).
func (m *MockProvider) BasemapConfig(_ context.Context, surface string) (StyleConfig, error) {
	return StyleConfig{
		StyleURL:    "mock://style/" + m.name + "?surface=" + surface,
		Attribution: "© OpenStreetMap contributors (mock)",
		Provider:    m.name,
		Source:      m.source,
	}, nil
}

// pseudoPoint derives a stable Lagos-area coordinate from a string.
func pseudoPoint(s string) (float64, float64) {
	var sum int
	for _, r := range s {
		sum += int(r)
	}
	lat := 6.45 + float64(sum%1000)/10000.0
	lng := 3.39 + float64((sum*7)%1000)/10000.0
	return lat, lng
}

func (m *MockProvider) Geocode(_ context.Context, address string) (GeoResult, error) {
	if address == "" {
		return GeoResult{}, ErrEmptyQuery
	}
	lat, lng := pseudoPoint(address)
	// Cacheable is ALWAYS false for mock results: synthetic answers must never
	// enter geocode_cache, where they would keep shadowing a real provider after
	// keys are configured (observed: mock-era rows served instead of Google).
	return GeoResult{
		Lat: lat, Lng: lng, Address: address, PlusCode: m.codec.Encode(lat, lng),
		Provider: m.name, Source: m.source, Cacheable: false,
		Confidence: 0.9, H3Cell: PointCellKey(lat, lng),
	}, nil
}

func (m *MockProvider) ReverseGeocode(_ context.Context, lat, lng float64) (GeoResult, error) {
	return GeoResult{
		Lat: lat, Lng: lng,
		Address:  fmt.Sprintf("%.5f, %.5f (mock)", lat, lng),
		PlusCode: m.codec.Encode(lat, lng),
		Provider: m.name, Source: m.source, Cacheable: false, // never cache synthetic results
		Confidence: 0.9, H3Cell: PointCellKey(lat, lng),
	}, nil
}

func (m *MockProvider) Autocomplete(_ context.Context, query, _ string, _ *Point) ([]Suggestion, error) {
	if query == "" {
		return nil, ErrEmptyQuery
	}
	lat, lng := pseudoPoint(query)
	return []Suggestion{
		{Label: query + ", Lagos, Nigeria (mock)", Lat: lat, Lng: lng, HasCoords: true, Provider: m.name, Source: m.source, Confidence: 0.9},
		{Label: query + " Extension, Lagos, Nigeria (mock)", Provider: m.name, Source: m.source, Confidence: 0.7},
	}, nil
}

func (m *MockProvider) SearchPlaces(_ context.Context, query string, near *Point) ([]Place, error) {
	if query == "" {
		return nil, ErrEmptyQuery
	}
	lat, lng := pseudoPoint(query)
	if near != nil {
		lat, lng = near.Lat+0.001, near.Lng+0.001
	}
	return []Place{
		{Name: query + " (mock POI)", Lat: lat, Lng: lng, Category: "point_of_interest", Provider: m.name, Source: m.source},
	}, nil
}

func (m *MockProvider) Route(_ context.Context, origin, dest Point, _ RouteOptions) (Route, error) {
	road := haversineM(origin, dest) * 1.3
	dur := road / m.avgSpeedMPS
	return Route{
		DistanceM: int(math.Round(road)),
		DurationS: int(math.Round(dur)),
		Polyline:  fmt.Sprintf("mock:%.5f,%.5f;%.5f,%.5f", origin.Lat, origin.Lng, dest.Lat, dest.Lng),
		Provider:  m.name, Source: m.source,
	}, nil
}

func (m *MockProvider) Matrix(ctx context.Context, origins, dests []Point) (Matrix, error) {
	rows := make([][]MatrixCell, len(origins))
	for i, o := range origins {
		row := make([]MatrixCell, len(dests))
		for j, d := range dests {
			r, _ := m.Route(ctx, o, d, RouteOptions{})
			row[j] = MatrixCell{DistanceM: r.DistanceM, DurationS: r.DurationS}
		}
		rows[i] = row
	}
	return Matrix{Rows: rows, Provider: m.name, Source: m.source}, nil
}

func (m *MockProvider) MatchToRoad(_ context.Context, trace []Point) (Polyline, error) {
	snapped := make([]Point, len(trace))
	for i, p := range trace {
		snapped[i] = Point{Lat: p.Lat, Lng: p.Lng, Source: m.source}
	}
	return Polyline{Points: snapped, Provider: m.name, Source: m.source}, nil
}

// Ensure MockProvider satisfies every adapter role.
var (
	_ TileProvider  = (*MockProvider)(nil)
	_ Geocoder      = (*MockProvider)(nil)
	_ Autocompleter = (*MockProvider)(nil)
	_ PlaceSearcher = (*MockProvider)(nil)
	_ Router        = (*MockProvider)(nil)
	_ Matrixer      = (*MockProvider)(nil)
	_ MapMatcher    = (*MockProvider)(nil)
)

// Geoapify is the OpenStack (OSM-licensed) hosted geocoder. Its results ARE
// cacheable (Source=openstack), so the geocode path persists them in PostGIS.
// It serves geocode, reverse-geocode, autocomplete, and (degraded) place search.
type Geoapify struct {
	apiKey      string
	countryCode string // ISO filter, e.g. "ng" (Nigeria-first)
	codec       PlusCodec
}

// NewGeoapify builds the adapter. countryCode "" disables the country filter.
func NewGeoapify(apiKey, countryCode string) *Geoapify {
	if countryCode == "" {
		countryCode = "ng"
	}
	return &Geoapify{apiKey: apiKey, countryCode: countryCode, codec: NewPlusCodec()}
}

func (g *Geoapify) Name() string { return "geoapify" }

// geoapifyResp is the subset of the Geoapify GeoJSON we consume.
type geoapifyResp struct {
	Features []struct {
		Properties struct {
			Lat       float64 `json:"lat"`
			Lon       float64 `json:"lon"`
			Formatted string  `json:"formatted"`
			PlaceID   string  `json:"place_id"`
			Category  string  `json:"category"`
			Name      string  `json:"name"`
			Rank      struct {
				Importance float64 `json:"importance"` // Nominatim importance (0..1)
				Confidence float64 `json:"confidence"` // Geoapify match confidence (0..1)
			} `json:"rank"`
		} `json:"properties"`
	} `json:"features"`
}

// geoapifyConfidence normalizes Geoapify/Nominatim's native quality signals into
// 0..1. Geoapify returns rank.confidence (its own 0..1 match score); when present
// we prefer it. Otherwise we fall back to Nominatim's rank.importance (also 0..1).
func geoapifyConfidence(confidence, importance float64) Confidence {
	c := confidence
	if c <= 0 {
		c = importance
	}
	if c < 0 {
		c = 0
	}
	if c > 1 {
		c = 1
	}
	return c
}

func (g *Geoapify) Geocode(ctx context.Context, address string) (GeoResult, error) {
	if address == "" {
		return GeoResult{}, ErrEmptyQuery
	}
	u := fmt.Sprintf("https://api.geoapify.com/v1/geocode/search?text=%s&limit=1&format=geojson&apiKey=%s",
		url.QueryEscape(address), url.QueryEscape(g.apiKey))
	if g.countryCode != "" {
		u += "&filter=countrycode:" + g.countryCode
	}
	var r geoapifyResp
	if err := getJSON(ctx, u, &r); err != nil {
		return GeoResult{}, err
	}
	if len(r.Features) == 0 {
		return GeoResult{}, fmt.Errorf("maps: geoapify no match for %q", address)
	}
	p := r.Features[0].Properties
	return GeoResult{
		Lat: p.Lat, Lng: p.Lon, Address: p.Formatted,
		PlusCode: g.codec.Encode(p.Lat, p.Lon),
		Provider: g.Name(), Source: SourceOpenStack, Cacheable: true,
		Confidence: geoapifyConfidence(p.Rank.Confidence, p.Rank.Importance),
		H3Cell:     PointCellKey(p.Lat, p.Lon),
	}, nil
}

func (g *Geoapify) ReverseGeocode(ctx context.Context, lat, lng float64) (GeoResult, error) {
	u := fmt.Sprintf("https://api.geoapify.com/v1/geocode/reverse?lat=%f&lon=%f&format=geojson&apiKey=%s",
		lat, lng, url.QueryEscape(g.apiKey))
	var r geoapifyResp
	if err := getJSON(ctx, u, &r); err != nil {
		return GeoResult{}, err
	}
	addr := fmt.Sprintf("%.5f, %.5f", lat, lng)
	conf := Confidence(1.0) // reverse from an exact coordinate is fully confident.
	if len(r.Features) > 0 {
		p := r.Features[0].Properties
		addr = p.Formatted
		if p.Rank.Confidence > 0 || p.Rank.Importance > 0 {
			conf = geoapifyConfidence(p.Rank.Confidence, p.Rank.Importance)
		}
	}
	return GeoResult{
		Lat: lat, Lng: lng, Address: addr, PlusCode: g.codec.Encode(lat, lng),
		Provider: g.Name(), Source: SourceOpenStack, Cacheable: true,
		Confidence: conf, H3Cell: PointCellKey(lat, lng),
	}, nil
}

func (g *Geoapify) Autocomplete(ctx context.Context, query, _ string, near *Point) ([]Suggestion, error) {
	if query == "" {
		return nil, ErrEmptyQuery
	}
	u := fmt.Sprintf("https://api.geoapify.com/v1/geocode/autocomplete?text=%s&limit=5&format=geojson&apiKey=%s",
		url.QueryEscape(query), url.QueryEscape(g.apiKey))
	if g.countryCode != "" {
		u += "&filter=countrycode:" + g.countryCode
	}
	if near != nil {
		u += fmt.Sprintf("&bias=proximity:%f,%f", near.Lng, near.Lat)
	}
	var r geoapifyResp
	if err := getJSON(ctx, u, &r); err != nil {
		return nil, err
	}
	out := make([]Suggestion, 0, len(r.Features))
	for _, f := range r.Features {
		p := f.Properties
		out = append(out, Suggestion{
			Label: p.Formatted, PlaceID: p.PlaceID,
			Lat: p.Lat, Lng: p.Lon, HasCoords: p.Lat != 0 || p.Lon != 0,
			Provider: g.Name(), Source: SourceOpenStack,
			Confidence: geoapifyConfidence(p.Rank.Confidence, p.Rank.Importance),
		})
	}
	return out, nil
}

// SearchPlaces is the DEGRADED substitute for Google POI search (used only when
// Google is over its soft cap). OSM data, so Source=openstack and renderable on
// the OpenStack basemap.
func (g *Geoapify) SearchPlaces(ctx context.Context, query string, near *Point) ([]Place, error) {
	if query == "" {
		return nil, ErrEmptyQuery
	}
	u := fmt.Sprintf("https://api.geoapify.com/v1/geocode/search?text=%s&limit=10&format=geojson&apiKey=%s",
		url.QueryEscape(query), url.QueryEscape(g.apiKey))
	var r geoapifyResp
	if err := getJSON(ctx, u, &r); err != nil {
		return nil, err
	}
	out := make([]Place, 0, len(r.Features))
	for _, f := range r.Features {
		p := f.Properties
		out = append(out, Place{
			Name: p.Name, Address: p.Formatted, Lat: p.Lat, Lng: p.Lon,
			Category: p.Category, PlaceID: p.PlaceID,
			Provider: g.Name(), Source: SourceOpenStack,
		})
	}
	return out, nil
}

var (
	_ Geocoder      = (*Geoapify)(nil)
	_ Autocompleter = (*Geoapify)(nil)
	_ PlaceSearcher = (*Geoapify)(nil)
)
