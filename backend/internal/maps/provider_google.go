package maps

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

// Google is used ONLY for autocompleteAddress (consumer checkout/delivery
// surfaces) and searchExternalPlaces. Nothing else by default.
//
// License coherence (enforced here + in guards.go/cache.go):
//   - Every result is tagged Source=google and Cacheable=false.
//   - The cache writer REFUSES to persist these (guardCacheWrite).
//   - The renderer guard THROWS if a google-sourced point reaches the OpenStack
//     basemap (AssertRenderable). Google results may be shown on a Google map
//     ONLY on the surface that produced them.
type Google struct {
	apiKey      string
	countryCode string // components filter, e.g. "ng"
	codec       PlusCodec
}

// NewGoogle builds the adapter. countryCode "" disables the country filter.
func NewGoogle(apiKey, countryCode string) *Google {
	if countryCode == "" {
		countryCode = "ng"
	}
	return &Google{apiKey: apiKey, countryCode: countryCode, codec: NewPlusCodec()}
}

func (g *Google) Name() string { return "google" }

type googleAutocompleteResp struct {
	Status      string `json:"status"`
	Predictions []struct {
		Description string `json:"description"`
		PlaceID     string `json:"place_id"`
	} `json:"predictions"`
}

// Autocomplete returns Google predictions. They carry no coordinates (a Place
// Details lookup would resolve the pin) and are NEVER cached.
func (g *Google) Autocomplete(ctx context.Context, query, sessionToken string, near *Point) ([]Suggestion, error) {
	if query == "" {
		return nil, ErrEmptyQuery
	}
	u := fmt.Sprintf("https://maps.googleapis.com/maps/api/place/autocomplete/json?input=%s&key=%s",
		url.QueryEscape(query), url.QueryEscape(g.apiKey))
	if sessionToken != "" {
		u += "&sessiontoken=" + url.QueryEscape(sessionToken)
	}
	if g.countryCode != "" {
		u += "&components=country:" + g.countryCode
	}
	if near != nil {
		u += fmt.Sprintf("&location=%f,%f&radius=50000", near.Lat, near.Lng)
	}
	var r googleAutocompleteResp
	if err := getJSON(ctx, u, &r); err != nil {
		return nil, err
	}
	if r.Status != "OK" && r.Status != "ZERO_RESULTS" {
		return nil, fmt.Errorf("maps: google autocomplete status=%s", r.Status)
	}
	out := make([]Suggestion, 0, len(r.Predictions))
	for _, p := range r.Predictions {
		out = append(out, Suggestion{
			Label: p.Description, PlaceID: p.PlaceID, HasCoords: false,
			Provider: g.Name(), Source: SourceGoogle, // license: never cached, Google map only
			// Google autocomplete returns no per-prediction score; predictions are
			// already relevance-ranked, so we assign a reasonable fixed confidence.
			Confidence: 0.8,
		})
	}
	return out, nil
}

type googleTextSearchResp struct {
	Status  string `json:"status"`
	Results []struct {
		Name             string   `json:"name"`
		FormattedAddress string   `json:"formatted_address"`
		PlaceID          string   `json:"place_id"`
		Types            []string `json:"types"`
		Geometry         struct {
			Location struct {
				Lat float64 `json:"lat"`
				Lng float64 `json:"lng"`
			} `json:"location"`
		} `json:"geometry"`
	} `json:"results"`
}

// SearchPlaces returns Google world POIs. Results are Source=google and are
// NEVER cached or rendered on the OpenStack basemap.
func (g *Google) SearchPlaces(ctx context.Context, query string, near *Point) ([]Place, error) {
	if query == "" {
		return nil, ErrEmptyQuery
	}
	u := fmt.Sprintf("https://maps.googleapis.com/maps/api/place/textsearch/json?query=%s&key=%s",
		url.QueryEscape(query), url.QueryEscape(g.apiKey))
	if near != nil {
		u += fmt.Sprintf("&location=%f,%f&radius=20000", near.Lat, near.Lng)
	}
	var r googleTextSearchResp
	if err := getJSON(ctx, u, &r); err != nil {
		return nil, err
	}
	if r.Status != "OK" && r.Status != "ZERO_RESULTS" {
		return nil, fmt.Errorf("maps: google places status=%s", r.Status)
	}
	out := make([]Place, 0, len(r.Results))
	for _, p := range r.Results {
		cat := ""
		if len(p.Types) > 0 {
			cat = p.Types[0]
		}
		out = append(out, Place{
			Name: p.Name, Address: p.FormattedAddress,
			Lat: p.Geometry.Location.Lat, Lng: p.Geometry.Location.Lng,
			Category: cat, PlaceID: p.PlaceID,
			Provider: g.Name(), Source: SourceGoogle,
		})
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Geocoder (Google Geocoding API) — Source=google, NEVER cacheable.
// ─────────────────────────────────────────────────────────────────────────────

type googleGeocodeResp struct {
	Status  string `json:"status"`
	Results []struct {
		FormattedAddress string `json:"formatted_address"`
		PlaceID          string `json:"place_id"`
		PartialMatch     bool   `json:"partial_match"`
		Geometry         struct {
			LocationType string `json:"location_type"`
			Location     struct {
				Lat float64 `json:"lat"`
				Lng float64 `json:"lng"`
			} `json:"location"`
		} `json:"geometry"`
	} `json:"results"`
}

// googleConfidence normalizes Google's native quality signals into 0..1.
//
//	geometry.location_type: ROOFTOP=1.0, RANGE_INTERPOLATED=0.8,
//	GEOMETRIC_CENTER=0.6, APPROXIMATE=0.4 (unknown → 0.4).
//	partial_match=true multiplies the result by 0.7 (and sets Partial=true).
func googleConfidence(locationType string, partial bool) Confidence {
	var c Confidence
	switch locationType {
	case "ROOFTOP":
		c = 1.0
	case "RANGE_INTERPOLATED":
		c = 0.8
	case "GEOMETRIC_CENTER":
		c = 0.6
	case "APPROXIMATE":
		c = 0.4
	default:
		c = 0.4
	}
	if partial {
		c *= 0.7
	}
	return c
}

func (g *Google) Geocode(ctx context.Context, address string) (GeoResult, error) {
	if address == "" {
		return GeoResult{}, ErrEmptyQuery
	}
	u := fmt.Sprintf("https://maps.googleapis.com/maps/api/geocode/json?address=%s&key=%s",
		url.QueryEscape(address), url.QueryEscape(g.apiKey))
	if g.countryCode != "" {
		u += "&components=country:" + g.countryCode
	}
	var r googleGeocodeResp
	if err := getJSON(ctx, u, &r); err != nil {
		return GeoResult{}, err
	}
	if r.Status != "OK" && r.Status != "ZERO_RESULTS" {
		return GeoResult{}, fmt.Errorf("maps: google geocode status=%s", r.Status)
	}
	if len(r.Results) == 0 {
		return GeoResult{}, fmt.Errorf("maps: google no match for %q", address)
	}
	res := r.Results[0]
	lat, lng := res.Geometry.Location.Lat, res.Geometry.Location.Lng
	return GeoResult{
		Lat: lat, Lng: lng, Address: res.FormattedAddress,
		PlusCode: g.codec.Encode(lat, lng),
		Provider: g.Name(), Source: SourceGoogle, Cacheable: false,
		Confidence: googleConfidence(res.Geometry.LocationType, res.PartialMatch),
		H3Cell:     PointCellKey(lat, lng),
		Partial:    res.PartialMatch,
	}, nil
}

func (g *Google) ReverseGeocode(ctx context.Context, lat, lng float64) (GeoResult, error) {
	u := fmt.Sprintf("https://maps.googleapis.com/maps/api/geocode/json?latlng=%f,%f&key=%s",
		lat, lng, url.QueryEscape(g.apiKey))
	var r googleGeocodeResp
	if err := getJSON(ctx, u, &r); err != nil {
		return GeoResult{}, err
	}
	if r.Status != "OK" && r.Status != "ZERO_RESULTS" {
		return GeoResult{}, fmt.Errorf("maps: google reverse status=%s", r.Status)
	}
	addr := fmt.Sprintf("%.5f, %.5f", lat, lng)
	conf := Confidence(1.0) // reverse from an exact coordinate is fully confident.
	partial := false
	if len(r.Results) > 0 {
		res := r.Results[0]
		addr = res.FormattedAddress
		conf = googleConfidence(res.Geometry.LocationType, res.PartialMatch)
		partial = res.PartialMatch
	}
	return GeoResult{
		Lat: lat, Lng: lng, Address: addr, PlusCode: g.codec.Encode(lat, lng),
		Provider: g.Name(), Source: SourceGoogle, Cacheable: false,
		Confidence: conf, H3Cell: PointCellKey(lat, lng), Partial: partial,
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Distance Matrix (Google Distance Matrix API) — driving distance + ETA.
// Source=google. Used for delivery-fee distance pricing on consumer surfaces.
// ─────────────────────────────────────────────────────────────────────────────

type googleMatrixResp struct {
	Status string `json:"status"`
	Rows   []struct {
		Elements []struct {
			Status   string `json:"status"`
			Distance struct {
				Value int `json:"value"` // metres
			} `json:"distance"`
			Duration struct {
				Value int `json:"value"` // seconds
			} `json:"duration"`
			// duration_in_traffic is returned only with departure_time; we request
			// it so the ETA reflects live conditions when the key has it enabled.
			DurationInTraffic struct {
				Value int `json:"value"`
			} `json:"duration_in_traffic"`
		} `json:"elements"`
	} `json:"rows"`
}

func googleLatLngList(pts []Point) string {
	parts := make([]string, len(pts))
	for i, p := range pts {
		parts[i] = fmt.Sprintf("%f,%f", p.Lat, p.Lng)
	}
	return strings.Join(parts, "|")
}

// Matrix computes a driving distance/ETA grid via the Google Distance Matrix API.
// Rows[i][j] = origins[i] → dests[j]. An element that Google could not route
// yields a zero cell (callers treat zero distance as "unavailable").
func (g *Google) Matrix(ctx context.Context, origins, dests []Point) (Matrix, error) {
	if len(origins) == 0 || len(dests) == 0 {
		return Matrix{}, fmt.Errorf("maps: google matrix needs origins and destinations")
	}
	u := fmt.Sprintf(
		"https://maps.googleapis.com/maps/api/distancematrix/json?origins=%s&destinations=%s&mode=driving&departure_time=now&key=%s",
		url.QueryEscape(googleLatLngList(origins)),
		url.QueryEscape(googleLatLngList(dests)),
		url.QueryEscape(g.apiKey),
	)
	var r googleMatrixResp
	if err := getJSON(ctx, u, &r); err != nil {
		return Matrix{}, err
	}
	if r.Status != "OK" {
		return Matrix{}, fmt.Errorf("maps: google matrix status=%s", r.Status)
	}
	rows := make([][]MatrixCell, len(origins))
	for i := range origins {
		row := make([]MatrixCell, len(dests))
		for j := range dests {
			cell := MatrixCell{}
			if i < len(r.Rows) && j < len(r.Rows[i].Elements) {
				el := r.Rows[i].Elements[j]
				if el.Status == "OK" {
					cell.DistanceM = el.Distance.Value
					if el.DurationInTraffic.Value > 0 {
						cell.DurationS = el.DurationInTraffic.Value
					} else {
						cell.DurationS = el.Duration.Value
					}
				}
			}
			row[j] = cell
		}
		rows[i] = row
	}
	return Matrix{Rows: rows, Provider: g.Name(), Source: SourceGoogle}, nil
}

var (
	_ Geocoder      = (*Google)(nil)
	_ Autocompleter = (*Google)(nil)
	_ PlaceSearcher = (*Google)(nil)
	_ Matrixer      = (*Google)(nil)
)
