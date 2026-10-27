package top5events_test

// Live-DB tests for the social fields on event reads and the Following feed
// (events-social, Task 5). Reuses the pool, service and fixtures from
// ticket_token_live_db_test.go and social_live_db_test.go.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"
)

func TestGetEvent_LikedFlagIsPerCaller(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := socialService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)
	userA := seedTicketTokenUser(t, ctx, pool)
	userB := seedTicketTokenUser(t, ctx, pool)
	eventID := seedSocialEvent(t, ctx, pool, organiser, "LIVE")

	if _, err := svc.LikeEvent(ctx, userA, eventID); err != nil {
		t.Fatalf("LikeEvent: %v", err)
	}

	for _, tc := range []struct {
		name      string
		caller    string
		wantLiked bool
	}{
		{"liker", userA, true},
		{"other user", userB, false},
		{"anonymous", "", false},
	} {
		got, err := svc.GetEventForCaller(ctx, eventID, tc.caller)
		if err != nil {
			t.Fatalf("%s: GetEventForCaller: %v", tc.name, err)
		}
		if got.Liked != tc.wantLiked {
			t.Fatalf("%s: Liked = %v, want %v", tc.name, got.Liked, tc.wantLiked)
		}
		if got.LikeCount != 1 {
			t.Fatalf("%s: LikeCount = %d, want 1", tc.name, got.LikeCount)
		}
	}

	// The caller-less read used by internal callers never reports a like.
	plain, err := svc.GetEvent(ctx, eventID)
	if err != nil {
		t.Fatalf("GetEvent: %v", err)
	}
	if plain.Liked || plain.LikeCount != 1 {
		t.Fatalf("GetEvent = liked %v count %d, want liked false count 1", plain.Liked, plain.LikeCount)
	}
}

func TestListFollowingEvents_OnlyFollowedOrganisers(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := socialService(pool)

	orgX := seedTicketTokenUser(t, ctx, pool)
	orgY := seedTicketTokenUser(t, ctx, pool)
	user := seedTicketTokenUser(t, ctx, pool)

	liveX := seedSocialEvent(t, ctx, pool, orgX, "LIVE")
	approvedX := seedSocialEvent(t, ctx, pool, orgX, "APPROVED")
	draftX := seedSocialEvent(t, ctx, pool, orgX, "DRAFT")
	closedX := seedSocialEvent(t, ctx, pool, orgX, "CLOSED")
	liveY := seedSocialEvent(t, ctx, pool, orgY, "LIVE")

	// A past LIVE event of a followed organiser must not appear.
	pastX := seedSocialEvent(t, ctx, pool, orgX, "LIVE")
	if _, err := pool.Exec(ctx,
		`UPDATE events SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' WHERE id=$1`, pastX); err != nil {
		t.Fatalf("backdate event: %v", err)
	}

	if _, err := svc.FollowOrganiser(ctx, user, orgX); err != nil {
		t.Fatalf("FollowOrganiser: %v", err)
	}

	feed, err := svc.ListFollowingEvents(ctx, user, 100, 0)
	if err != nil {
		t.Fatalf("ListFollowingEvents: %v", err)
	}
	got := map[string]bool{}
	for _, e := range feed {
		got[e.ID] = true
		if e.OrganiserID != orgX {
			t.Fatalf("feed contains event %s of organiser %s, want only %s", e.ID, e.OrganiserID, orgX)
		}
	}
	if !got[liveX] || !got[approvedX] {
		t.Fatalf("feed = %v, want both LIVE %s and APPROVED %s events of the followed organiser", got, liveX, approvedX)
	}
	for name, id := range map[string]string{"DRAFT": draftX, "CLOSED": closedX, "past": pastX, "unfollowed organiser": liveY} {
		if got[id] {
			t.Fatalf("feed contains the %s event %s, want it excluded", name, id)
		}
	}
	for i := 1; i < len(feed); i++ {
		if feed[i].StartsAt.Before(feed[i-1].StartsAt) {
			t.Fatalf("feed not ordered by starts_at at index %d", i)
		}
	}

	// A user who follows nobody gets an empty, non-nil feed.
	other := seedTicketTokenUser(t, ctx, pool)
	empty, err := svc.ListFollowingEvents(ctx, other, 100, 0)
	if err != nil {
		t.Fatalf("ListFollowingEvents (no follows): %v", err)
	}
	if empty == nil || len(empty) != 0 {
		t.Fatalf("feed for a user with no follows = %v, want empty non-nil slice", empty)
	}
}

func TestListFollowingEvents_Pagination(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := socialService(pool)

	org := seedTicketTokenUser(t, ctx, pool)
	user := seedTicketTokenUser(t, ctx, pool)
	first := seedSocialEvent(t, ctx, pool, org, "LIVE")
	second := seedSocialEvent(t, ctx, pool, org, "LIVE")
	// Fix the order: first starts before second.
	if _, err := pool.Exec(ctx, `UPDATE events SET starts_at = now() + interval '1 day' WHERE id=$1`, first); err != nil {
		t.Fatalf("set first start: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE events SET starts_at = now() + interval '2 days', ends_at = now() + interval '3 days' WHERE id=$1`, second); err != nil {
		t.Fatalf("set second start: %v", err)
	}
	if _, err := svc.FollowOrganiser(ctx, user, org); err != nil {
		t.Fatalf("FollowOrganiser: %v", err)
	}

	page1, err := svc.ListFollowingEvents(ctx, user, 1, 0)
	if err != nil {
		t.Fatalf("limit 1: %v", err)
	}
	if len(page1) != 1 || page1[0].ID != first {
		t.Fatalf("limit 1 offset 0 = %v, want exactly the first event %s", page1, first)
	}
	page2, err := svc.ListFollowingEvents(ctx, user, 1, 1)
	if err != nil {
		t.Fatalf("limit 1 offset 1: %v", err)
	}
	if len(page2) != 1 || page2[0].ID != second {
		t.Fatalf("limit 1 offset 1 = %v, want exactly the second event %s", page2, second)
	}
	page3, err := svc.ListFollowingEvents(ctx, user, 1, 2)
	if err != nil {
		t.Fatalf("limit 1 offset 2: %v", err)
	}
	if len(page3) != 0 {
		t.Fatalf("offset past the end = %d rows, want 0", len(page3))
	}
}

func TestGetEvent_NoCoordinatesIsValid(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := socialService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)
	eventID := seedSocialEvent(t, ctx, pool, organiser, "LIVE")
	if _, err := pool.Exec(ctx,
		`UPDATE events SET banner_url=NULL, venue_lat=NULL, venue_lng=NULL, venue_place_id=NULL WHERE id=$1`, eventID); err != nil {
		t.Fatalf("null out social columns: %v", err)
	}

	got, err := svc.GetEventForCaller(ctx, eventID, organiser)
	if err != nil {
		t.Fatalf("GetEventForCaller with NULL coordinates: %v", err)
	}
	if got.BannerURL != nil || got.VenueLat != nil || got.VenueLng != nil || got.VenuePlaceID != nil {
		t.Fatalf("NULL columns must read as nil pointers, got banner=%v lat=%v lng=%v place=%v",
			got.BannerURL, got.VenueLat, got.VenueLng, got.VenuePlaceID)
	}

	// And when set, the values round-trip.
	if _, err := pool.Exec(ctx,
		`UPDATE events SET banner_url='https://cdn.test/b.jpg', venue_lat=6.5244, venue_lng=3.3792, venue_place_id='place-1' WHERE id=$1`, eventID); err != nil {
		t.Fatalf("set social columns: %v", err)
	}
	got, err = svc.GetEventForCaller(ctx, eventID, organiser)
	if err != nil {
		t.Fatalf("GetEventForCaller with coordinates: %v", err)
	}
	if got.BannerURL == nil || *got.BannerURL != "https://cdn.test/b.jpg" ||
		got.VenueLat == nil || *got.VenueLat != 6.5244 ||
		got.VenueLng == nil || *got.VenueLng != 3.3792 ||
		got.VenuePlaceID == nil || *got.VenuePlaceID != "place-1" {
		t.Fatalf("social columns did not round-trip: %+v", got)
	}
}
