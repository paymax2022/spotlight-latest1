package maps

import (
	"context"
	"fmt"
	"net/url"
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
		} `json:"properties"`
	} `json:"features"`
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
	if len(r.Features) > 0 {
		addr = r.Features[0].Properties.Formatted
	}
	return GeoResult{
		Lat: lat, Lng: lng, Address: addr, PlusCode: g.codec.Encode(lat, lng),
		Provider: g.Name(), Source: SourceOpenStack, Cacheable: true,
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
