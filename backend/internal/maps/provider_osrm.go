package maps

import (
	"context"
	"fmt"
	"strconv"
	"strings"
)

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
		return Polyline{}, fmt.Errorf("maps: map-match needs >=2 points")
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
