package navigation

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func findScreen(s []TopScreen, route string) *TopScreen {
	for i := range s {
		if s[i].Route == route {
			return &s[i]
		}
	}
	return nil
}

func findDay(s []DayBucket, day string) DayBucket {
	for _, b := range s {
		if b.Day == day {
			return b
		}
	}
	return DayBucket{Day: day}
}

func TestLive_AnalyticsAggregateNavigation(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	u1, u2 := uuid.NewString(), uuid.NewString()
	cleanupUser(t, pool, u1)
	cleanupUser(t, pool, u2)

	tag := strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	routeA := "/cry" + tag // 4 views, 2 users
	routeB := "/home" + tag
	old := "/cry-old" + tag

	now := time.Now().UTC()
	d0 := now.Add(-1 * time.Hour)
	d1 := now.Add(-26 * time.Hour)
	day0, day1 := d0.Format("2006-01-02"), d1.Format("2006-01-02")

	base, err := repo.AggregateNavigation(ctx, AnalyticsFilter{Range: "7d", Surface: "all"})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := repo.Insert(ctx, []Event{
		{UserID: u1, Surface: "mobile", Route: routeA, OccurredAt: d0},
		{UserID: u1, Surface: "mobile", Route: routeA, OccurredAt: d1},
		{UserID: u2, Surface: "web", Route: routeA, OccurredAt: d0},
		{UserID: u2, Surface: "web", Route: routeA, OccurredAt: d1},
		{UserID: u1, Surface: "web", Route: routeB, OccurredAt: d0},
		{UserID: u1, Surface: "web", Route: old, OccurredAt: now.Add(-20 * 24 * time.Hour)},
	}); err != nil {
		t.Fatal(err)
	}

	got, err := repo.AggregateNavigation(ctx, AnalyticsFilter{Range: "7d", Surface: "all", Search: tag})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.TopScreens) != 2 || got.TopScreens[0].Route != routeA || got.TopScreens[1].Route != routeB {
		t.Fatalf("topScreens = %+v", got.TopScreens)
	}
	if a := got.TopScreens[0]; a.Views != 4 || a.Users != 2 {
		t.Fatalf("A = %+v", a)
	}
	if findScreen(got.TopScreens, old) != nil {
		t.Fatal("out-of-window row included")
	}
	// 30d window includes the old one.
	g30, err := repo.AggregateNavigation(ctx, AnalyticsFilter{Range: "30d", Surface: "all", Search: tag})
	if err != nil || findScreen(g30.TopScreens, old) == nil {
		t.Fatalf("30d: %+v %v", g30, err)
	}

	// search narrows topScreens only: split/timeseries equal the unsearched totals.
	all, err := repo.AggregateNavigation(ctx, AnalyticsFilter{Range: "7d", Surface: "all"})
	if err != nil {
		t.Fatal(err)
	}
	if all.SurfaceSplit.Mobile-base.SurfaceSplit.Mobile != 2 || all.SurfaceSplit.Web-base.SurfaceSplit.Web != 3 ||
		all.SurfaceSplit.Total-base.SurfaceSplit.Total != 5 {
		t.Fatalf("split delta: base=%+v all=%+v", base.SurfaceSplit, all.SurfaceSplit)
	}
	if got.SurfaceSplit != all.SurfaceSplit {
		t.Fatalf("search affected split: %+v vs %+v", got.SurfaceSplit, all.SurfaceSplit)
	}
	d0b, d0a := findDay(base.Timeseries, day0), findDay(all.Timeseries, day0)
	if d0a.Mobile-d0b.Mobile != 1 || d0a.Web-d0b.Web != 2 || d0a.Total-d0b.Total != 3 {
		t.Fatalf("day0 %+v -> %+v", d0b, d0a)
	}
	d1b, d1a := findDay(base.Timeseries, day1), findDay(all.Timeseries, day1)
	if d1a.Mobile-d1b.Mobile != 1 || d1a.Web-d1b.Web != 1 || d1a.Total-d1b.Total != 2 {
		t.Fatalf("day1 %+v -> %+v", d1b, d1a)
	}

	// surface=mobile scopes topScreens + timeseries; split still has both.
	mob, err := repo.AggregateNavigation(ctx, AnalyticsFilter{Range: "7d", Surface: "mobile", Search: tag})
	if err != nil {
		t.Fatal(err)
	}
	if len(mob.TopScreens) != 1 || mob.TopScreens[0].Route != routeA || mob.TopScreens[0].Views != 2 || mob.TopScreens[0].Users != 1 {
		t.Fatalf("mobile topScreens = %+v", mob.TopScreens)
	}
	if mb := findDay(mob.Timeseries, day0); mb.Web != 0 || mb.Mobile < 1 {
		t.Fatalf("mobile timeseries day0 = %+v", mb)
	}
	if mob.SurfaceSplit != all.SurfaceSplit || mob.SurfaceSplit.Web == 0 {
		t.Fatalf("split not unscoped: %+v", mob.SurfaceSplit)
	}

	// search narrowing by prefix.
	cry, err := repo.AggregateNavigation(ctx, AnalyticsFilter{Range: "7d", Surface: "all", Search: "cry" + tag})
	if err != nil || len(cry.TopScreens) != 1 || cry.TopScreens[0].Route != routeA {
		t.Fatalf("cry: %+v %v", cry, err)
	}

	// Hostile search strings are bound, never interpolated.
	for _, s := range []string{"'", "%", "'; DROP TABLE navigation_events; --", `\`} {
		if _, err := repo.AggregateNavigation(ctx, AnalyticsFilter{Range: "7d", Surface: "all", Search: s}); err != nil {
			t.Fatalf("search %q: %v", s, err)
		}
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM navigation_events WHERE user_id=$1::uuid`, u1).Scan(&n); err != nil || n == 0 {
		t.Fatalf("table damaged: %d %v", n, err)
	}
}
