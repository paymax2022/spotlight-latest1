package top5events_test

// Live-DB tests for likes and follows (events-social, Task 3): idempotent like and
// follow, counters that never drift or go below zero, the profile row a first
// follow creates, self-follow rejection, and non-public events reading as not found.
//
// Reuses the pool, service and user fixtures from ticket_token_live_db_test.go.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/top5events"
)

// seedSocialEvent inserts an event in the given state (both organiser spellings,
// see seedIssuedTicket) and registers cleanup.
func seedSocialEvent(t *testing.T, ctx context.Context, pool *pgxpool.Pool, organiserID, state string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO events (id, organizer_id, organiser_id, title, state, starts_at, ends_at) VALUES ($1,$2,$2,'Social Test Event',$3,$4,$5)`,
		id, organiserID, state, time.Now().Add(24*time.Hour), time.Now().Add(30*time.Hour)); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM events WHERE id=$1`, id) })
	return id
}

func countRows(t *testing.T, ctx context.Context, pool *pgxpool.Pool, query string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, query, args...).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func TestLikeEvent_TwiceCountsOnce(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)
	liker := seedTicketTokenUser(t, ctx, pool)
	eventID := seedSocialEvent(t, ctx, pool, organiser, "LIVE")

	for i := 1; i <= 2; i++ {
		st, err := svc.LikeEvent(ctx, liker, eventID)
		if err != nil {
			t.Fatalf("LikeEvent call %d: %v", i, err)
		}
		if !st.Liked || st.LikeCount != 1 {
			t.Fatalf("LikeEvent call %d = %+v, want liked with LikeCount 1", i, st)
		}
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM event_likes WHERE event_id=$1 AND user_id=$2`, eventID, liker); n != 1 {
		t.Fatalf("event_likes rows = %d, want exactly 1", n)
	}
	if n := countRows(t, ctx, pool, `SELECT like_count FROM events WHERE id=$1`, eventID); n != 1 {
		t.Fatalf("events.like_count = %d, want 1 (equal to the row count)", n)
	}
}

func TestUnlikeEvent_NeverBelowZero(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)
	user := seedTicketTokenUser(t, ctx, pool)
	eventID := seedSocialEvent(t, ctx, pool, organiser, "LIVE")

	st, err := svc.UnlikeEvent(ctx, user, eventID)
	if err != nil {
		t.Fatalf("UnlikeEvent on a never-liked event: %v", err)
	}
	if st.Liked || st.LikeCount != 0 {
		t.Fatalf("UnlikeEvent = %+v, want not liked with LikeCount 0", st)
	}
	if n := countRows(t, ctx, pool, `SELECT like_count FROM events WHERE id=$1`, eventID); n != 0 {
		t.Fatalf("events.like_count = %d, want 0", n)
	}
}

func TestFollowOrganiser_CreatesProfileRow(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)
	follower := seedTicketTokenUser(t, ctx, pool)

	if n := countRows(t, ctx, pool, `SELECT count(*) FROM organiser_profiles WHERE organiser_id=$1`, organiser); n != 0 {
		t.Fatalf("precondition: organiser already has %d profile rows, want 0", n)
	}
	st, err := svc.FollowOrganiser(ctx, follower, organiser)
	if err != nil {
		t.Fatalf("FollowOrganiser: %v", err)
	}
	if !st.Following || st.FollowerCount != 1 {
		t.Fatalf("FollowOrganiser = %+v, want following with FollowerCount 1", st)
	}
	if n := countRows(t, ctx, pool, `SELECT follower_count FROM organiser_profiles WHERE organiser_id=$1`, organiser); n != 1 {
		t.Fatalf("organiser_profiles.follower_count = %d, want 1 (row must now exist)", n)
	}
}

func TestFollowOrganiser_SelfRejected(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)

	_, err := svc.FollowOrganiser(ctx, organiser, organiser)
	if !errors.Is(err, top5events.ErrValidation) {
		t.Fatalf("FollowOrganiser self = %v, want ErrValidation", err)
	}
	// Rejected before any write: no follow row and no profile row (so no counter).
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM organiser_follows WHERE organiser_id=$1`, organiser); n != 0 {
		t.Fatalf("organiser_follows rows = %d, want 0", n)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM organiser_profiles WHERE organiser_id=$1`, organiser); n != 0 {
		t.Fatalf("organiser_profiles rows = %d, want 0 (follower_count unchanged)", n)
	}
}

func TestLikeEvent_DraftIsNotFound(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)
	liker := seedTicketTokenUser(t, ctx, pool)
	eventID := seedSocialEvent(t, ctx, pool, organiser, "DRAFT")

	_, err := svc.LikeEvent(ctx, liker, eventID)
	if !errors.Is(err, top5events.ErrNotFound) {
		t.Fatalf("LikeEvent on DRAFT = %v, want ErrNotFound", err)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM event_likes WHERE event_id=$1`, eventID); n != 0 {
		t.Fatalf("event_likes rows = %d, want 0 (nothing written)", n)
	}
	if n := countRows(t, ctx, pool, `SELECT like_count FROM events WHERE id=$1`, eventID); n != 0 {
		t.Fatalf("events.like_count = %d, want 0", n)
	}
}
