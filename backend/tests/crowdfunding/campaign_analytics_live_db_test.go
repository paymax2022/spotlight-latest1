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

	// The pool is closed via t.Cleanup, NOT `defer` in the caller. t.Cleanup runs
	// LIFO and only AFTER the test function returns, so a `t.Cleanup(pool.Close)` in
	// the test would close the pool BEFORE the fixture cleanup registered below
	// ever runs — every DELETE would fail against a closed pool. Registering the
	// close here, first, guarantees it runs LAST. This is not hypothetical: the
	// original version of this file used `t.Cleanup(pool.Close)` and silently leaked
	// nine campaigns, twelve users and their contributions into the shared dev
	// database before anyone noticed.
	t.Cleanup(pool.Close)
	return pool
}

// seedCampaign creates a creator and a campaign, and returns their ids plus a
// trackUser hook for any additional user the test creates (e.g. a contributor).
//
// Everything is namespaced by a fresh uuid and removed on cleanup, so the test is
// safe to re-run and cannot disturb existing data. Cleanup deletes in FK-safe
// order — events and contributions reference the campaign, and contributions
// reference the contributor — and REPORTS failures instead of swallowing them: a
// cleanup that silently fails leaks rows into a shared database, which is exactly
// how this file once left nine stray campaigns behind.
func seedCampaign(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (campaignID, creatorID string, trackUser func(string)) {
	t.Helper()
	creatorID = uuid.NewString()
	campaignID = uuid.NewString()
	extraUsers := []string{}

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
		mustExec := func(what, sql string, args ...any) {
			if _, err := pool.Exec(ctx, sql, args...); err != nil {
				t.Errorf("cleanup %s: %v (fixture rows may be left in the database)", what, err)
			}
		}
		mustExec("events", `DELETE FROM cf_campaign_events WHERE campaign_id = $1`, campaignID)
		mustExec("contributions", `DELETE FROM contributions WHERE campaign_id = $1`, campaignID)
		mustExec("campaign", `DELETE FROM campaigns WHERE id = $1`, campaignID)
		for _, u := range extraUsers {
			mustExec("extra user", `DELETE FROM auth.users WHERE id = $1`, u)
		}
		mustExec("creator", `DELETE FROM auth.users WHERE id = $1`, creatorID)

		// Prove the fixture is actually gone rather than trusting the DELETEs.
		var left int
		if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM campaigns WHERE id = $1`, campaignID).Scan(&left); err == nil && left != 0 {
			t.Errorf("fixture campaign %s survived cleanup", campaignID)
		}
	})

	return campaignID, creatorID, func(id string) { extraUsers = append(extraUsers, id) }
}

// TestLiveDB_AnalyticsAreZeroWithoutEvents is the regression that kills the
// fabrication: with nothing recorded, every engagement figure must be zero.
// The hash implementation returned at least 1200 views and 40 shares here.
func TestLiveDB_AnalyticsAreZeroWithoutEvents(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)

	campaignID, _, _ := seedCampaign(t, ctx, pool)
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

	campaignID, _, _ := seedCampaign(t, ctx, pool)

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

	campaignID, _, trackUser := seedCampaign(t, ctx, pool)
	contributorID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated') ON CONFLICT (id) DO NOTHING`,
		contributorID, "cf-contrib-"+contributorID+"@test.local"); err != nil {
		t.Fatalf("seed contributor: %v", err)
	}
	trackUser(contributorID)

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
