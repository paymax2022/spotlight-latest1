package navigation

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestLive_FunnelStepEvents(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	u1, u2 := uuid.NewString(), uuid.NewString()
	cleanupUser(t, pool, u1)
	cleanupUser(t, pool, u2)

	tag := strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	a, b, other := "/fa"+tag, "/fb"+tag, "/fo"+tag
	now := time.Now().UTC()

	if _, err := repo.Insert(ctx, []Event{
		{UserID: u1, Surface: "mobile", Route: b, OccurredAt: now.Add(-2 * time.Hour)},
		{UserID: u1, Surface: "mobile", Route: a, OccurredAt: now.Add(-3 * time.Hour)},
		{UserID: u1, Surface: "mobile", Route: other, OccurredAt: now.Add(-1 * time.Hour)},
		{UserID: u2, Surface: "web", Route: a, OccurredAt: now.Add(-1 * time.Hour)},
		{UserID: u2, Surface: "web", Route: a, OccurredAt: now.Add(-40 * 24 * time.Hour)},
	}); err != nil {
		t.Fatal(err)
	}

	got, err := repo.FunnelStepEvents(ctx, []string{a, b}, AnalyticsFilter{Range: "30d", Surface: "all"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 step rows in window, got %d: %+v", len(got), got)
	}
	for i := 1; i < len(got); i++ {
		p, c := got[i-1], got[i]
		if p.UserID > c.UserID || (p.UserID == c.UserID && p.OccurredAt.After(c.OccurredAt)) {
			t.Fatalf("not ordered by user, time: %+v", got)
		}
	}
	for _, e := range got {
		if e.Route == other {
			t.Fatalf("non-step route returned: %+v", e)
		}
	}

	web, err := repo.FunnelStepEvents(ctx, []string{a, b}, AnalyticsFilter{Range: "30d", Surface: "web"})
	if err != nil {
		t.Fatal(err)
	}
	if len(web) != 1 || web[0].UserID != u2 || web[0].Route != a {
		t.Fatalf("surface filter: %+v", web)
	}

	if got := ComputeFunnel(got, []string{a, b}, 2*time.Hour); got[0] != 2 || got[1] != 1 {
		t.Fatalf("funnel = %v", got)
	}
}
