package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB test for creator campaign analytics.
//
// WHY THIS EXISTS
// ---------------
// GetCampaignAnalytics used to INVENT the headline numbers on the creator
// performance screen:
//
//	views  := 1200 + idSeed(campaignID)%8000 + contributorCount*40
//	shares := 40 + idSeed(campaignID)%400
//
// with the traffic-source breakdown a fixed 38/27/18/11/6 % split of that
// invented view count. Because the figures shifted when contributors changed,
// they read as real. They are now aggregated from cf_campaign_events.
//
// This test pins the properties that make them real, and would fail against the
// old implementation: a campaign with NO recorded events must report zero (the
// hash version reported >= 1200 views), and a contribution must be attributed
// to the channel of the contributor's LAST view before giving.
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL, which the root .env
// points at the production pooler and this test INSERTs (see
// scripts/ci/check-live-db-gate.sh).
//
// Bring-up:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB -v
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/crowdfunding/creator"
)

func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB campaign analytics test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

// seedCampaign creates a creator, a campaign and returns their ids. Every row is
// namespaced by a fresh uuid and removed on cleanup, so the test is safe to
// re-run and cannot disturb existing data.
func seedCampaign(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (campaignID, creatorID string) {
	t.Helper()
	creatorID = uuid.NewString()
	campaignID = uuid.NewString()

	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, creatorID, "cf-analytics-"+creatorID+"@test.local"); err != nil {
		t.Fatalf("seed creator: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, deadline)
		VALUES ($1, $2, 'Analytics fixture', 1000000, 'active', NOW() + INTERVAL '30 days')`,
		campaignID, creatorID); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM cf_campaign_events WHERE campaign_id = $1`, campaignID)
		_, _ = pool.Exec(ctx, `DELETE FROM contributions WHERE campaign_id = $1`, campaignID)
		_, _ = pool.Exec(ctx, `DELETE FROM campaigns WHERE id = $1`, campaignID)
		_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id = $1`, creatorID)
	})
	return campaignID, creatorID
}

// TestLiveDB_AnalyticsAreZeroWithoutEvents is the regression that kills the
// fabrication: with nothing recorded, every engagement figure must be zero.
// The hash implementation returned at least 1200 views and 40 shares here.
func TestLiveDB_AnalyticsAreZeroWithoutEvents(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	defer pool.Close()

	campaignID, _ := seedCampaign(t, ctx, pool)
	svc := creator.NewService(pool)

	a, err := svc.GetCampaignAnalytics(ctx, campaignID)
	if err != nil {
		t.Fatalf("analytics: %v", err)
	}
	if a.Views != 0 {
		t.Errorf("views = %d, want 0 — a campaign with no recorded views must not invent any", a.Views)
	}
	if a.Shares != 0 {
		t.Errorf("shares = %d, want 0", a.Shares)
	}
	if a.ConversionRate != 0 {
		t.Errorf("conversionRate = %v, want 0 (no views means no rate, not a divide-by-zero)", a.ConversionRate)
	}
	if len(a.TrafficSources) != 0 {
		t.Errorf("trafficSources = %+v, want empty — no traffic means no breakdown", a.TrafficSources)
	}
}

// TestLiveDB_AnalyticsCountRecordedEvents proves the counts are the rows, not a
// function of the id.
func TestLiveDB_AnalyticsCountRecordedEvents(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	defer pool.Close()

	campaignID, _ := seedCampaign(t, ctx, pool)

	for _, ev := range []struct{ typ, src string }{
		{"VIEW", "whatsapp"}, {"VIEW", "whatsapp"}, {"VIEW", "facebook"},
		{"SHARE", "whatsapp"},
	} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO cf_campaign_events (campaign_id, event_type, source, anonymous_id)
			VALUES ($1, $2, $3, 'anon')`, campaignID, ev.typ, ev.src); err != nil {
			t.Fatalf("insert event: %v", err)
		}
	}

	a, err := creator.NewService(pool).GetCampaignAnalytics(ctx, campaignID)
	if err != nil {
		t.Fatalf("analytics: %v", err)
	}
	if a.Views != 3 {
		t.Errorf("views = %d, want 3", a.Views)
	}
	if a.Shares != 1 {
		t.Errorf("shares = %d, want 1", a.Shares)
	}

	got := map[string]int{}
	for _, ts := range a.TrafficSources {
		got[ts.Source] = ts.Visits
	}
	if got["WhatsApp"] != 2 || got["Facebook"] != 1 {
		t.Errorf("traffic visits = %+v, want WhatsApp 2 / Facebook 1", got)
	}
}

// TestLiveDB_ContributionAttributedToLastTouch is the subtle one: a contributor
// who arrived via WhatsApp but last viewed via Facebook before giving must be
// credited to Facebook.
func TestLiveDB_ContributionAttributedToLastTouch(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	defer pool.Close()

	campaignID, _ := seedCampaign(t, ctx, pool)
	contributorID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated') ON CONFLICT (id) DO NOTHING`,
		contributorID, "cf-contrib-"+contributorID+"@test.local"); err != nil {
		t.Fatalf("seed contributor: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id = $1`, contributorID) })

	gaveAt := time.Now()
	// First touch WhatsApp, LAST touch Facebook, then the contribution.
	for _, ev := range []struct {
		src string
		at  time.Time
	}{
		{"whatsapp", gaveAt.Add(-10 * time.Minute)},
		{"facebook", gaveAt.Add(-1 * time.Minute)},
	} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO cf_campaign_events (campaign_id, event_type, source, actor_user_id, created_at)
			VALUES ($1, 'VIEW', $2, $3, $4)`, campaignID, ev.src, contributorID, ev.at); err != nil {
			t.Fatalf("insert view: %v", err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO contributions (campaign_id, contributor_id, amount_kobo, status, idempotency_key, created_at)
		VALUES ($1, $2, 250000, 'escrowed', $3, $4)`,
		campaignID, contributorID, "cf-analytics-"+uuid.NewString(), gaveAt); err != nil {
		t.Fatalf("insert contribution: %v", err)
	}

	a, err := creator.NewService(pool).GetCampaignAnalytics(ctx, campaignID)
	if err != nil {
		t.Fatalf("analytics: %v", err)
	}

	credited := map[string]int{}
	for _, ts := range a.TrafficSources {
		credited[ts.Source] = ts.Contributions
	}
	if credited["Facebook"] != 1 {
		t.Errorf("Facebook contributions = %d, want 1 — last touch before giving", credited["Facebook"])
	}
	if credited["WhatsApp"] != 0 {
		t.Errorf("WhatsApp contributions = %d, want 0 — it was the FIRST touch, not the last", credited["WhatsApp"])
	}

	// Conversion is contributors per view: 1 of 2.
	if a.ConversionRate != 50 {
		t.Errorf("conversionRate = %v, want 50 (1 contribution / 2 views)", a.ConversionRate)
	}
}
