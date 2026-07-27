package restaurant

import (
	"strings"
	"testing"
	"time"
)

func f(v float64) *float64 { return &v }

func TestBuildSearchQuery_Defaults(t *testing.T) {
	sql, args := buildSearchQuery(SearchParams{}, time.Now(), time.UTC)
	if !strings.Contains(sql, "WHERE r.is_open = TRUE") {
		t.Error("must always restrict to open restaurants")
	}
	if !strings.Contains(sql, "LEFT JOIN merchant_locations") {
		t.Error("must LEFT JOIN merchant_locations for a stable distance column")
	}
	if !strings.Contains(sql, "NULL::float8 AS distance_m") {
		t.Error("no near point ⇒ distance must be NULL")
	}
	// Default page: LIMIT 20 OFFSET 0 as the only two args.
	if len(args) != 2 || args[0] != defaultSearchLimit || args[1] != 0 {
		t.Fatalf("default paging args = %v, want [20 0]", args)
	}
	if !strings.Contains(sql, "ORDER BY r.rating DESC") {
		t.Error("default sort should be relevance→rating without a near point")
	}
}

func TestBuildSearchQuery_TextAndFilters(t *testing.T) {
	sql, args := buildSearchQuery(SearchParams{
		Query: "  Pizza ", Cuisine: "Italian", MinRating: 4.5, Limit: 10, Offset: 30,
	}, time.Now(), time.UTC)
	if !strings.Contains(sql, "r.name ILIKE $1 OR r.description ILIKE $1") {
		t.Errorf("text search should ILIKE name+description on one placeholder: %s", sql)
	}
	if args[0] != "%Pizza%" { // trimmed, wildcarded
		t.Errorf("query arg = %v, want %q", args[0], "%Pizza%")
	}
	if !strings.Contains(sql, "lower(r.cuisine) = lower($2)") || args[1] != "Italian" {
		t.Errorf("cuisine filter wrong: sql=%s args=%v", sql, args)
	}
	if !strings.Contains(sql, "r.rating >= $3") || args[2] != 4.5 {
		t.Errorf("min-rating filter wrong: sql=%s args=%v", sql, args)
	}
	// paging clamped/passed: limit 10, offset 30 as the last two args.
	if args[len(args)-2] != 10 || args[len(args)-1] != 30 {
		t.Errorf("paging args = %v, want [...10 30]", args)
	}
}

func TestBuildSearchQuery_ClampsLimit(t *testing.T) {
	for _, lim := range []int{0, -5, 999} {
		_, args := buildSearchQuery(SearchParams{Limit: lim}, time.Now(), time.UTC)
		if args[len(args)-2] != defaultSearchLimit {
			t.Errorf("limit %d should clamp to %d, got %v", lim, defaultSearchLimit, args[len(args)-2])
		}
	}
	// A valid in-range limit is preserved.
	_, args := buildSearchQuery(SearchParams{Limit: 25}, time.Now(), time.UTC)
	if args[len(args)-2] != 25 {
		t.Errorf("in-range limit 25 should be preserved, got %v", args[len(args)-2])
	}
}

func TestBuildSearchQuery_Near(t *testing.T) {
	sql, args := buildSearchQuery(SearchParams{
		NearLat: f(6.5), NearLng: f(3.4), RadiusKm: 3, Sort: "distance",
	}, time.Now(), time.UTC)
	if !strings.Contains(sql, "ST_Distance(ml.geog") {
		t.Error("near search must project a real distance")
	}
	if !strings.Contains(sql, "ST_DWithin(ml.geog") {
		t.Error("near search must filter by radius")
	}
	if !strings.Contains(sql, "ORDER BY distance_m ASC NULLS LAST") {
		t.Error("distance sort with a near point must order by distance")
	}
	// lng, lat, radius(m) appear as args (radius 3km → 3000m).
	found := false
	for _, a := range args {
		if a == 3000.0 {
			found = true
		}
	}
	if !found {
		t.Errorf("radius 3km should pass 3000m, args=%v", args)
	}
}

func TestBuildSearchQuery_RadiusClamped(t *testing.T) {
	_, args := buildSearchQuery(SearchParams{NearLat: f(6.5), NearLng: f(3.4), RadiusKm: 999}, time.Now(), time.UTC)
	hasMax := false
	for _, a := range args {
		if a == maxRadiusKm*1000 {
			hasMax = true
		}
	}
	if !hasMax {
		t.Errorf("oversized radius should clamp to %g m, args=%v", maxRadiusKm*1000, args)
	}
}

func TestBuildSearchQuery_DistanceSortWithoutNearFallsBack(t *testing.T) {
	sql, _ := buildSearchQuery(SearchParams{Sort: "distance"}, time.Now(), time.UTC)
	if strings.Contains(sql, "distance_m ASC") {
		t.Error("distance sort without a near point must fall back (no distance ordering)")
	}
	if !strings.Contains(sql, "ORDER BY r.rating DESC") {
		t.Error("fallback should be rating")
	}
}

func TestBuildSearchQuery_OpenNow(t *testing.T) {
	// Monday 12:00 UTC → weekday 1, minute 720, yesterday 0.
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	sql, args := buildSearchQuery(SearchParams{OpenNow: true}, now, time.UTC)
	if !strings.Contains(sql, "restaurant_business_hours") {
		t.Error("open_now must consult the business-hours schedule")
	}
	if !strings.Contains(sql, "NOT EXISTS") {
		t.Error("open_now must treat a restaurant with no schedule as open (is_open only)")
	}
	// weekday(1), yesterday(0), minute(720) all appear as args.
	want := map[any]bool{1: false, 0: false, 720: false}
	for _, a := range args {
		if _, ok := want[a]; ok {
			want[a] = true
		}
	}
	for v, seen := range want {
		if !seen {
			t.Errorf("open_now should pass arg %v (weekday/yesterday/minute), args=%v", v, args)
		}
	}
}
