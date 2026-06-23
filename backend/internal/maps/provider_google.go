package maps

import (
	"context"
	"fmt"
	"net/url"
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
}

// NewGoogle builds the adapter. countryCode "" disables the country filter.
func NewGoogle(apiKey, countryCode string) *Google {
	if countryCode == "" {
		countryCode = "ng"
	}
	return &Google{apiKey: apiKey, countryCode: countryCode}
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

var (
	_ Autocompleter = (*Google)(nil)
	_ PlaceSearcher = (*Google)(nil)
)
