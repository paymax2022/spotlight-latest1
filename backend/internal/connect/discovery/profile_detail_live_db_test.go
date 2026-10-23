package connectdiscovery

// LIVE-DB tests for GET /discovery/profiles/:id (the public profile-detail read).
// They assert the visibility/safety gate and the rich wire shape the mobile
// detail screen needs.
//
// GATED ON TEST_DATABASE_URL only — never DATABASE_URL (production pooler):
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/discovery/ -run TestLiveDB_PublicProfile -v

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	connectprofile "spotlight/backend/internal/connect/profile"
	"spotlight/backend/internal/testsupport"
)

func discoveryTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB connect/discovery test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func discoveryTestUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		id, "connect-disc-test-"+id+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

func sp(s string) *string { return &s }

// seedVisibleProfile creates a discoverable profile (adult, one visible dating
// mode, one photo) and returns its auth user id and connect_profiles.id.
func seedVisibleProfile(t *testing.T, pool *pgxpool.Pool, psvc *connectprofile.Service, name string) (userID, profileID string) {
	t.Helper()
	ctx := context.Background()
	userID = discoveryTestUser(t, pool)
	p, err := psvc.GetOrCreate(ctx, userID)
	if err != nil {
		t.Fatalf("GetOrCreate: %v", err)
	}
	profileID = p.ID
	dob := time.Now().UTC().AddDate(-25, 0, 0)
	if _, err := pool.Exec(ctx, `UPDATE connect_profiles SET dob = $2 WHERE user_id = $1`, userID, dob); err != nil {
		t.Fatalf("set dob: %v", err)
	}
	if _, err := psvc.Update(ctx, userID, connectprofile.UpsertProfileInput{
		DisplayName: sp(name), Bio: sp("Loves jollof and live music"), City: sp("Lagos"),
		Headline: sp("Product designer"), Interests: []string{"Music", "Travel"},
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	vis := true
	if _, err := psvc.UpsertMode(ctx, userID, "dating", connectprofile.UpsertModeInput{Visible: &vis}); err != nil {
		t.Fatalf("UpsertMode: %v", err)
	}
	if _, _, err := psvc.AddMedia(ctx, userID, "https://example.invalid/"+name+".jpg", "photo"); err != nil {
		t.Fatalf("AddMedia: %v", err)
	}
	return userID, profileID
}

func TestLiveDB_PublicProfile_VisibleReturnsRichCard(t *testing.T) {
	pool := discoveryTestPool(t)
	ctx := context.Background()
	psvc := connectprofile.NewService(pool, nil)
	svc := NewService(pool) // no presigner → plain-URL photos pass through

	viewerUID, _ := seedVisibleProfile(t, pool, psvc, "Viewer")
	_, targetPID := seedVisibleProfile(t, pool, psvc, "Amara")

	pp, err := svc.PublicProfile(ctx, viewerUID, targetPID)
	if err != nil {
		t.Fatalf("PublicProfile: %v", err)
	}
	if pp.ID != targetPID || pp.DisplayName != "Amara" {
		t.Fatalf("identity wrong: %+v", pp)
	}
	if pp.Age != 25 {
		t.Fatalf("age = %d, want 25", pp.Age)
	}
	if pp.Bio == "" || pp.Headline == "" || len(pp.Interests) != 2 {
		t.Fatalf("details missing: %+v", pp)
	}
	if len(pp.Photos) != 1 {
		t.Fatalf("photos = %v, want 1 (pending photos are shown)", pp.Photos)
	}
	// Collections must never be null (the mobile screen maps them unguarded).
	if pp.Prompts == nil || pp.Verified == nil {
		t.Fatalf("collections must be non-nil: %+v", pp)
	}
}

func TestLiveDB_PublicProfile_SelfIsNotFound(t *testing.T) {
	pool := discoveryTestPool(t)
	ctx := context.Background()
	psvc := connectprofile.NewService(pool, nil)
	svc := NewService(pool)

	uid, pid := seedVisibleProfile(t, pool, psvc, "Me")
	if _, err := svc.PublicProfile(ctx, uid, pid); !errors.Is(err, ErrTargetNotFound) {
		t.Fatalf("self view err = %v, want ErrTargetNotFound", err)
	}
}

func TestLiveDB_PublicProfile_HiddenIsNotFound(t *testing.T) {
	pool := discoveryTestPool(t)
	ctx := context.Background()
	psvc := connectprofile.NewService(pool, nil)
	svc := NewService(pool)

	viewerUID, _ := seedVisibleProfile(t, pool, psvc, "Viewer")
	targetUID, targetPID := seedVisibleProfile(t, pool, psvc, "Hidden")
	// Hide every mode → not discoverable.
	invisible := false
	if _, err := psvc.UpsertMode(ctx, targetUID, "dating", connectprofile.UpsertModeInput{Visible: &invisible}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PublicProfile(ctx, viewerUID, targetPID); !errors.Is(err, ErrTargetNotFound) {
		t.Fatalf("hidden view err = %v, want ErrTargetNotFound", err)
	}
}

func TestLiveDB_PublicProfile_BlockedEitherDirectionIsNotFound(t *testing.T) {
	pool := discoveryTestPool(t)
	ctx := context.Background()
	psvc := connectprofile.NewService(pool, nil)
	svc := NewService(pool)

	viewerUID, _ := seedVisibleProfile(t, pool, psvc, "Viewer")
	targetUID, targetPID := seedVisibleProfile(t, pool, psvc, "Blocked")

	// Viewer blocked the target.
	if _, err := pool.Exec(ctx,
		`INSERT INTO connect_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, viewerUID, targetUID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PublicProfile(ctx, viewerUID, targetPID); !errors.Is(err, ErrTargetNotFound) {
		t.Fatalf("blocker→blocked err = %v, want ErrTargetNotFound", err)
	}

	// Reverse the direction: target blocked the viewer.
	if _, err := pool.Exec(ctx, `DELETE FROM connect_blocks WHERE blocker_id = $1`, viewerUID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO connect_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, targetUID, viewerUID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PublicProfile(ctx, viewerUID, targetPID); !errors.Is(err, ErrTargetNotFound) {
		t.Fatalf("blocked→blocker err = %v, want ErrTargetNotFound", err)
	}
}

func TestLiveDB_PublicProfile_MalformedIDIsNotFound(t *testing.T) {
	pool := discoveryTestPool(t)
	ctx := context.Background()
	svc := NewService(pool)
	viewerUID := discoveryTestUser(t, pool)
	if _, err := svc.PublicProfile(ctx, viewerUID, "not-a-uuid"); !errors.Is(err, ErrTargetNotFound) {
		t.Fatalf("malformed id err = %v, want ErrTargetNotFound", err)
	}
}
