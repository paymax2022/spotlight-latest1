package maps

import (
	"context"
	"fmt"
	"net/url"
)

// HERE is HERE Technologies (Geocoding & Search v1, Autosuggest, Routing v8). It
// is an ACCURACY fallback used alongside Google for low-coverage areas and
// traffic-aware routing (MAPSERVICE.md §10).
//
// License coherence (enforced here + in guards.go/cache.go):
//   - Every result is tagged Source=here and Cacheable=false. HERE results, like
//     Google's, are NEVER persisted to the OSM cache and may only be rendered on a
//     HERE/Google basemap on the surface that produced them.
//   - The cache writer REFUSES to persist these (isCacheableSource → false).
type HERE struct {
	apiKey      string
	countryCode string // ISO-3166 alpha-3 for the "in=countryCode:" filter, e.g. "NGA"
}

// NewHERE builds the adapter. countryCode "" defaults to Nigeria ("NGA"). HERE
// expects the ISO-3166-1 alpha-3 code (not alpha-2) for the country filter.
func NewHERE(apiKey, countryCode string) *HERE {
	if countryCode == "" {
		countryCode = "NGA"
	}
	return &HERE{apiKey: apiKey, countryCode: countryCode}
}

func (h *HERE) Name() string { return "here" }

// Capabilities declares what the HERE adapter can serve. HERE is traffic-aware
// (Routing v8 + real-time traffic), unlike OSRM.
func (h *HERE) Capabilities() Capset {
	return Capset{
		Geocode:      true,
		Reverse:      true,
		Autocomplete: true,
		Route:        true,
		Matrix:       false,
		TrafficAware: true,
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Geocoder
// ─────────────────────────────────────────────────────────────────────────────

// hereItem is the subset of a HERE Geocoding & Search item we consume.
type hereItem struct {
	Title    string `json:"title"`
	ID       string `json:"id"`
	Address  struct {
		Label string `json:"label"`
	} `json:"address"`
	Position struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	} `json:"position"`
	Scoring struct {
		QueryScore  float64            `json:"queryScore"`
		FieldScore  map[string]float64 `json:"fieldScore"`
	} `json:"scoring"`
}

type hereSearchResp struct {
	Items []hereItem `json:"items"`
}

// hereConfidence normalizes HERE's native quality signals into 0..1.
//
//	scoring.queryScore is already 0..1 (1.0 = exact full-query match). We weight it
//	with the average of the per-field scores (street/houseNumber/postalCode/…),
//	which are also 0..1, so a high overall match with weak individual fields is
//	penalized. When no field scores are present we fall back to queryScore alone.
//
//	confidence = queryScore                              (no field scores)
//	confidence = 0.7*queryScore + 0.3*avg(fieldScore)    (field scores present)
func hereConfidence(it hereItem) Confidence {
	q := it.Scoring.QueryScore
	if q < 0 {
		q = 0
	}
	if q > 1 {
		q = 1
	}
	if len(it.Scoring.FieldScore) == 0 {
		return q
	}
	var sum float64
	for _, v := range it.Scoring.FieldScore {
		sum += v
	}
	avg := sum / float64(len(it.Scoring.FieldScore))
	c := 0.7*q + 0.3*avg
	if c > 1 {
		c = 1
	}
	return c
}

func (h *HERE) Geocode(ctx context.Context, address string) (GeoResult, error) {
	if address == "" {
		return GeoResult{}, ErrEmptyQuery
	}
	u := fmt.Sprintf("https://geocode.search.hereapi.com/v1/geocode?q=%s&apiKey=%s",
		url.QueryEscape(address), url.QueryEscape(h.apiKey))
	if h.countryCode != "" {
		u += "&in=countryCode:" + url.QueryEscape(h.countryCode)
	}
	var r hereSearchResp
	if err := getJSON(ctx, u, &r); err != nil {
		return GeoResult{}, err
	}
	if len(r.Items) == 0 {
		return GeoResult{}, fmt.Errorf("maps: here no match for %q", address)
	}
	it := r.Items[0]
	lat, lng := it.Position.Lat, it.Position.Lng
	conf := hereConfidence(it)
	return GeoResult{
		Lat: lat, Lng: lng, Address: firstNonEmpty(it.Address.Label, it.Title),
		PlusCode: "", // HERE does not return Plus Codes; left empty (server may derive).
		Provider: h.Name(), Source: SourceHere, Cacheable: false,
		Confidence: conf, H3Cell: PointCellKey(lat, lng),
		Partial: conf < 1.0,
	}, nil
}

func (h *HERE) ReverseGeocode(ctx context.Context, lat, lng float64) (GeoResult, error) {
	u := fmt.Sprintf("https://revgeocode.search.hereapi.com/v1/revgeocode?at=%f,%f&apiKey=%s",
		lat, lng, url.QueryEscape(h.apiKey))
	var r hereSearchResp
	if err := getJSON(ctx, u, &r); err != nil {
		return GeoResult{}, err
	}
	addr := fmt.Sprintf("%.5f, %.5f", lat, lng)
	conf := Confidence(1.0) // reverse from an exact coordinate is fully confident.
	if len(r.Items) > 0 {
		it := r.Items[0]
		addr = firstNonEmpty(it.Address.Label, it.Title)
		if it.Scoring.QueryScore > 0 {
			conf = hereConfidence(it)
		}
	}
	return GeoResult{
		Lat: lat, Lng: lng, Address: addr,
		Provider: h.Name(), Source: SourceHere, Cacheable: false,
		Confidence: conf, H3Cell: PointCellKey(lat, lng),
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Autocompleter
// ─────────────────────────────────────────────────────────────────────────────

func (h *HERE) Autocomplete(ctx context.Context, query, _ string, near *Point) ([]Suggestion, error) {
	if query == "" {
		return nil, ErrEmptyQuery
	}
	u := fmt.Sprintf("https://autosuggest.search.hereapi.com/v1/autosuggest?q=%s&limit=5&apiKey=%s",
		url.QueryEscape(query), url.QueryEscape(h.apiKey))
	// HERE Autosuggest REQUIRES an `at` focus point. Default to Lagos when no
	// proximity hint is supplied so the request is well-formed.
	if near != nil {
		u += fmt.Sprintf("&at=%f,%f", near.Lat, near.Lng)
	} else {
		u += "&at=6.4541,3.3947"
	}
	if h.countryCode != "" {
		u += "&in=countryCode:" + url.QueryEscape(h.countryCode)
	}
	var r hereSearchResp
	if err := getJSON(ctx, u, &r); err != nil {
		return nil, err
	}
	out := make([]Suggestion, 0, len(r.Items))
	for _, it := range r.Items {
		label := firstNonEmpty(it.Address.Label, it.Title)
		lat, lng := it.Position.Lat, it.Position.Lng
		out = append(out, Suggestion{
			Label: label, PlaceID: it.ID,
			Lat: lat, Lng: lng, HasCoords: lat != 0 || lng != 0,
			Provider: h.Name(), Source: SourceHere,
			Confidence: hereConfidence(it),
		})
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Router (HERE Routing v8) — optional; provides traffic-aware ETAs.
// ─────────────────────────────────────────────────────────────────────────────

type hereRouteResp struct {
	Routes []struct {
		Sections []struct {
			Summary struct {
				Length   float64 `json:"length"`   // metres
				Duration float64 `json:"duration"` // seconds (traffic-aware when transportMode+departureTime)
			} `json:"summary"`
			Polyline string `json:"polyline"` // HERE flexible polyline
		} `json:"sections"`
	} `json:"routes"`
}

// Route computes a single origin→destination route with HERE Routing v8. When
// opts.TrafficAware is set we request the live-traffic ETA (departureTime=now).
func (h *HERE) Route(ctx context.Context, origin, dest Point, opts RouteOptions) (Route, error) {
	mode := "car"
	switch opts.Profile {
	case "cycling":
		mode = "bicycle"
	case "walking":
		mode = "pedestrian"
	}
	u := fmt.Sprintf("https://router.hereapi.com/v8/routes?transportMode=%s"+
		"&origin=%f,%f&destination=%f,%f&return=summary,polyline&apiKey=%s",
		mode, origin.Lat, origin.Lng, dest.Lat, dest.Lng, url.QueryEscape(h.apiKey))
	if opts.TrafficAware {
		u += "&departureTime=now"
	}
	var r hereRouteResp
	if err := getJSON(ctx, u, &r); err != nil {
		return Route{}, err
	}
	if len(r.Routes) == 0 || len(r.Routes[0].Sections) == 0 {
		return Route{}, fmt.Errorf("maps: here no route")
	}
	var distM, durS float64
	var poly string
	for _, s := range r.Routes[0].Sections {
		distM += s.Summary.Length
		durS += s.Summary.Duration
		if poly == "" {
			poly = s.Polyline
		}
	}
	return Route{
		DistanceM: int(distM + 0.5),
		DurationS: int(durS + 0.5),
		Polyline:  poly,
		Provider:  h.Name(), Source: SourceHere,
	}, nil
}

// Compile-time assertions: HERE serves geocode, autocomplete, and routing.
var (
	_ Geocoder      = (*HERE)(nil)
	_ Autocompleter = (*HERE)(nil)
	_ Router        = (*HERE)(nil)
	_ Named         = (*HERE)(nil)
)
