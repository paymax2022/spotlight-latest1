package transport

import (
	"context"

	"spotlight/backend/internal/maps"
)

// MapServiceBridge adapts the provider-agnostic maps.MapService to the transport
// module's MapsAdapter interface. This is the payoff of the abstraction: dispatch,
// fare estimation, and ETA now run through MapService (OpenStack/OSRM by default,
// swappable by config) instead of transport's ad-hoc maps stub — with no change
// to transport business logic, which still depends only on MapsAdapter.
//
// transport imports maps (one direction); maps never imports transport, so there
// is no import cycle.
type MapServiceBridge struct {
	svc     maps.MapService
	surface string
}

// NewMapServiceBridge wraps a MapService as a transport MapsAdapter.
func NewMapServiceBridge(svc maps.MapService) *MapServiceBridge {
	return &MapServiceBridge{svc: svc, surface: "default"}
}

func (b *MapServiceBridge) Geocode(ctx context.Context, address string) (LatLng, error) {
	r, err := b.svc.Geocode(ctx, address, b.surface)
	if err != nil {
		return LatLng{}, err
	}
	return LatLng{Lat: r.Lat, Lng: r.Lng}, nil
}

func (b *MapServiceBridge) Route(ctx context.Context, from, to LatLng) (RouteResult, error) {
	rt, err := b.svc.GetRoute(ctx,
		maps.Point{Lat: from.Lat, Lng: from.Lng},
		maps.Point{Lat: to.Lat, Lng: to.Lng},
		maps.RouteOptions{})
	if err != nil {
		return RouteResult{}, err
	}
	return RouteResult{DistanceM: rt.DistanceM, DurationS: rt.DurationS, Polyline: rt.Polyline}, nil
}

func (b *MapServiceBridge) ETA(ctx context.Context, from, to LatLng) (int, error) {
	rt, err := b.Route(ctx, from, to)
	if err != nil {
		return 0, err
	}
	return rt.DurationS, nil
}

func (b *MapServiceBridge) DistanceMatrix(ctx context.Context, origins, destinations []LatLng) ([][]RouteResult, error) {
	mo := toMapsPoints(origins)
	md := toMapsPoints(destinations)
	m, err := b.svc.GetDistanceMatrix(ctx, mo, md)
	if err != nil {
		return nil, err
	}
	out := make([][]RouteResult, len(m.Rows))
	for i, row := range m.Rows {
		rr := make([]RouteResult, len(row))
		for j, c := range row {
			rr[j] = RouteResult{DistanceM: c.DistanceM, DurationS: c.DurationS}
		}
		out[i] = rr
	}
	return out, nil
}

func toMapsPoints(in []LatLng) []maps.Point {
	out := make([]maps.Point, len(in))
	for i, p := range in {
		out[i] = maps.Point{Lat: p.Lat, Lng: p.Lng}
	}
	return out
}

// Compile-time assertion that the bridge satisfies the transport MapsAdapter.
var _ MapsAdapter = (*MapServiceBridge)(nil)
