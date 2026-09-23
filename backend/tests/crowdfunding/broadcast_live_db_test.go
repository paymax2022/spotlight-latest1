package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB regression for CF-008: the mobile "Message contributors" screen
// (app/crowdfunding/creator/performance/[id].tsx, a real navigable button,
// not behind any feature flag) called POST /campaigns/:id/broadcast, which
// had no proxy route and no Go handler anywhere — every real send 404'd.
// This pins the new engage.Service.BroadcastToContributors end to end: it
// notifies every distinct backer who hasn't opted out, is creator-scoped,
// and validates the same fields the mobile client itself validates.
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL. See
// campaign_analytics_live_db_test.go in this package for the pattern.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Broadcast -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/crowdfunding/engage"
)

// TestLiveDB_Broadcast_NotifiesOptedInBackersOnly seeds a creator, three
// distinct backers (two opted in, one opted out of campaign_updates), and
// confirms the broadcast reaches exactly the two opted-in backers — with a
// real cf_notifications row each, and none for the opted-out backer.
func TestLiveDB_Broadcast_NotifiesOptedInBackersOnly(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)
	svc := engage.NewService(pool)

	creatorID := uuid.NewString()
	backerIn1 := uuid.NewString()
	backerIn2 := uuid.NewString()
	backerOut := uuid.NewString()
	refundedBacker := uuid.NewString()
	campaignID := uuid.NewString()

	for _, id := range []string{creatorID, backerIn1, backerIn2, backerOut, refundedBacker} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')
			ON CONFLICT (id) DO NOTHING`, id, "cf-uat-bcast-"+id+"@test.local"); err != nil {
			t.Fatalf("seed user %s: %v", id, err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, deadline)
		VALUES ($1, $2, 'Broadcast fixture', 5000000, 'active', 'ACTIVE', NOW() + INTERVAL '30 days')`,
		campaignID, creatorID); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}

	// backerOut explicitly opts out of campaign_updates.
	if _, err := pool.Exec(ctx, `
		INSERT INTO cf_notification_prefs (user_id, campaign_updates) VALUES ($1, FALSE)`,
		backerOut); err != nil {
		t.Fatalf("seed opted-out prefs: %v", err)
	}
	// backerIn2 has no prefs row at all — must default to opted-in.

	seedContribution := func(contributorID, status string) {
		if _, err := pool.Exec(ctx, `
			INSERT INTO contributions (id, campaign_id, contributor_id, amount_kobo, status, idempotency_key)
			VALUES ($1, $2, $3, 100000, $4, $5)`,
			uuid.NewString(), campaignID, contributorID, status, "cf-uat-bcast-"+contributorID); err != nil {
			t.Fatalf("seed contribution for %s: %v", contributorID, err)
		}
	}
	seedContribution(backerIn1, "released")
	seedContribution(backerIn2, "escrowed")
	seedContribution(backerOut, "released")
	seedContribution(refundedBacker, "refunded") // must never be notified

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM cf_notifications WHERE campaign_id = $1`, campaignID)
		pool.Exec(ctx, `DELETE FROM contributions WHERE campaign_id = $1`, campaignID)
		pool.Exec(ctx, `DELETE FROM campaigns WHERE id = $1`, campaignID)
		pool.Exec(ctx, `DELETE FROM cf_notification_prefs WHERE user_id = $1`, backerOut)
	})

	// Non-owner is refused before anything is sent.
	if _, err := svc.BroadcastToContributors(ctx, campaignID, backerIn1, engage.BroadcastInput{
		Subject: "Milestone reached!", Body: "We hit our first milestone, thank you all.", ChannelPush: true,
	}); err == nil {
		t.Fatalf("BroadcastToContributors succeeded for a non-owner caller")
	}

	result, err := svc.BroadcastToContributors(ctx, campaignID, creatorID, engage.BroadcastInput{
		Subject: "Milestone reached!", Body: "We hit our first milestone, thank you all.", ChannelPush: true,
	})
	if err != nil {
		t.Fatalf("BroadcastToContributors: %v", err)
	}
	if result.Recipients != 2 {
		t.Errorf("Recipients = %d, want 2 (backerIn1 + backerIn2 only — opted-out and refunded backers excluded)", result.Recipients)
	}

	assertNotified := func(userID string, want bool) {
		var count int
		if err := pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM cf_notifications WHERE user_id = $1 AND campaign_id = $2 AND type = 'campaign_broadcast'`,
			userID, campaignID).Scan(&count); err != nil {
			t.Fatalf("count notifications for %s: %v", userID, err)
		}
		got := count > 0
		if got != want {
			t.Errorf("notified(%s) = %v, want %v (row count %d)", userID, got, want, count)
		}
	}
	assertNotified(backerIn1, true)
	assertNotified(backerIn2, true)
	assertNotified(backerOut, false)
	assertNotified(refundedBacker, false)

	var storedTitle, storedBody string
	if err := pool.QueryRow(ctx,
		`SELECT title, body FROM cf_notifications WHERE user_id = $1 AND campaign_id = $2`,
		backerIn1, campaignID).Scan(&storedTitle, &storedBody); err != nil {
		t.Fatalf("read stored notification: %v", err)
	}
	if storedTitle != "Milestone reached!" {
		t.Errorf("stored title = %q, want %q", storedTitle, "Milestone reached!")
	}
	if storedBody != "We hit our first milestone, thank you all." {
		t.Errorf("stored body = %q, want the original message", storedBody)
	}
}

// TestLiveDB_Broadcast_RejectsShortFieldsAndNoChannel mirrors the mobile
// client's own validation (subject > 3 chars, body > 10 chars, at least one
// channel) server-side, since client validation alone is never trustworthy.
func TestLiveDB_Broadcast_RejectsShortFieldsAndNoChannel(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)
	svc := engage.NewService(pool)

	creatorID := uuid.NewString()
	campaignID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, creatorID, "cf-uat-bcast-valid-"+creatorID+"@test.local"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO campaigns (id, creator_id, title, goal_kobo, status, review_status, deadline)
		VALUES ($1, $2, 'Broadcast validation fixture', 5000000, 'active', 'ACTIVE', NOW() + INTERVAL '30 days')`,
		campaignID, creatorID); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM campaigns WHERE id = $1`, campaignID) })

	cases := []struct {
		name  string
		input engage.BroadcastInput
	}{
		{"subject too short", engage.BroadcastInput{Subject: "Hi", Body: "A message long enough to pass.", ChannelPush: true}},
		{"body too short", engage.BroadcastInput{Subject: "A real subject", Body: "short", ChannelPush: true}},
		{"no channel selected", engage.BroadcastInput{Subject: "A real subject", Body: "A message long enough to pass."}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := svc.BroadcastToContributors(ctx, campaignID, creatorID, tc.input); err == nil {
				t.Errorf("BroadcastToContributors succeeded, want a validation refusal")
			}
		})
	}
}
