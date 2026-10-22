package association_test

// ---------------------------------------------------------------------------
// LIVE-DB regression guard for CheckInMeeting's new time window, added
// during a comprehensive association-module UAT pass. Before this:
// CheckInMeeting had no time bound at all — a member could "check in" to a
// meeting that hasn't started yet, or one from months ago, producing a false
// attendance record with no error and nothing to distinguish it from a real
// one.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestLiveDB_CheckInMeeting_RejectsOutsideWindow(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "Meeting Window "+uuid.New().String())
	member, _ := seedActiveMembership(t, ctx, pool, orgID)

	insertMeeting := func(startsAt time.Time, endsAt *time.Time) string {
		id := uuid.New().String()
		if _, err := pool.Exec(ctx,
			`INSERT INTO assoc_meetings (id, organisation_id, title, starts_at, ends_at) VALUES ($1,$2,'Board Sync',$3,$4)`,
			id, orgID, startsAt, endsAt); err != nil {
			t.Fatalf("seed meeting: %v", err)
		}
		return id
	}

	// Future meeting: check-in must be rejected, hasn't started.
	future := insertMeeting(time.Now().Add(48*time.Hour), nil)
	if err := svc.CheckInMeeting(ctx, member, future); err == nil {
		t.Error("check-in to a meeting 48h in the future returned nil error, want rejection")
	}

	// Long-past meeting: check-in must be rejected, window closed.
	pastEnd := time.Now().Add(-30 * 24 * time.Hour)
	pastStart := pastEnd.Add(-1 * time.Hour)
	past := insertMeeting(pastStart, &pastEnd)
	if err := svc.CheckInMeeting(ctx, member, past); err == nil {
		t.Error("check-in to a meeting 30 days past returned nil error, want rejection")
	}
	var checkedIn *time.Time
	if err := pool.QueryRow(ctx, `SELECT checked_in_at FROM assoc_meeting_attendance WHERE meeting_id=$1 AND membership_id=(SELECT id FROM assoc_memberships WHERE user_id=$2)`, past, member).Scan(&checkedIn); err == nil && checkedIn != nil {
		t.Error("a rejected check-in still wrote a checked_in_at row")
	}

	// Currently live meeting: check-in must succeed.
	liveStart := time.Now().Add(-30 * time.Minute)
	live := insertMeeting(liveStart, nil)
	if err := svc.CheckInMeeting(ctx, member, live); err != nil {
		t.Fatalf("check-in to a meeting in progress: %v (want success)", err)
	}
	if err := pool.QueryRow(ctx, `SELECT checked_in_at FROM assoc_meeting_attendance WHERE meeting_id=$1 AND membership_id=(SELECT id FROM assoc_memberships WHERE user_id=$2)`, live, member).Scan(&checkedIn); err != nil || checkedIn == nil {
		t.Fatalf("checked_in_at not recorded for a valid in-window check-in: %v", err)
	}
}
