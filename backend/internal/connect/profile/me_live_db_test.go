package connectprofile

// LIVE-DB tests for the owner's own profile: the composite read, the new
// registration fields, and photo add/order/delete scoping.
//
// GATED ON TEST_DATABASE_URL only — never DATABASE_URL (production pooler):
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/profile/ -run TestLiveDB -v

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func profileTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB connect/profile test")
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

func profileTestUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		id, "connect-profile-test-"+id+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

func str(s string) *string { return &s }

func TestLiveDB_GetMeReturnsEverythingRegistrationCollected(t *testing.T) {
	pool := profileTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	uid := profileTestUser(t, pool)

	dob := time.Now().UTC().AddDate(-27, 0, -3)
	if _, err := svc.GetOrCreate(ctx, uid); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE connect_profiles SET dob = $2 WHERE user_id = $1`, uid, dob); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Update(ctx, uid, UpsertProfileInput{
		DisplayName: str("Amara"), Bio: str("Hello"), City: str("Lagos"),
		Gender: str("female"), Headline: str("Designer"),
		Interests:   []string{"Music", "Travel"},
		Preferences: map[string]any{"intent_date": "Long-term"},
	}); err != nil {
		t.Fatal(err)
	}
	vis := true
	if _, err := svc.UpsertMode(ctx, uid, "dating", UpsertModeInput{Visible: &vis, IntentTags: []string{"long_term"}}); err != nil {
		t.Fatal(err)
	}

	fp, err := svc.GetMe(ctx, uid)
	if err != nil {
		t.Fatal(err)
	}
	if fp.Age == nil || *fp.Age != 27 {
		t.Fatalf("age = %v, want 27", fp.Age)
	}
	if fp.DisplayName == nil || *fp.DisplayName != "Amara" || fp.Gender == nil || *fp.Gender != "female" ||
		fp.Headline == nil || *fp.Headline != "Designer" || fp.City == nil || *fp.City != "Lagos" {
		t.Fatalf("details not returned: %+v", fp.Profile)
	}
	if len(fp.Interests) != 2 {
		t.Fatalf("interests = %v", fp.Interests)
	}
	if fp.Preferences["intent_date"] != "Long-term" {
		t.Fatalf("preferences = %v", fp.Preferences)
	}
	if len(fp.Modes) != 1 || fp.Modes[0].Mode != "dating" || !fp.Modes[0].Visible {
		t.Fatalf("modes = %+v", fp.Modes)
	}
	if fp.Photos == nil {
		t.Fatal("photos must be an empty list, not null")
	}

	// A later partial update must not wipe other fields; [] clears interests.
	if _, err := svc.Update(ctx, uid, UpsertProfileInput{Bio: str("Updated")}); err != nil {
		t.Fatal(err)
	}
	fp, _ = svc.GetMe(ctx, uid)
	if *fp.Bio != "Updated" || *fp.DisplayName != "Amara" || len(fp.Interests) != 2 {
		t.Fatalf("partial update clobbered fields: %+v", fp.Profile)
	}
	if _, err := svc.Update(ctx, uid, UpsertProfileInput{Interests: []string{}}); err != nil {
		t.Fatal(err)
	}
	fp, _ = svc.GetMe(ctx, uid)
	if len(fp.Interests) != 0 {
		t.Fatalf("interests not cleared: %v", fp.Interests)
	}
}

func TestLiveDB_MediaOwnershipOrderAndDelete(t *testing.T) {
	pool := profileTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	me := profileTestUser(t, pool)
	other := profileTestUser(t, pool)

	// Another member's object key must be refused.
	if _, _, err := svc.AddMedia(ctx, me, mediaKeyPrefix(other)+"x.jpg", "photo"); err == nil {
		t.Fatal("attaching another member's key must fail")
	}
	if _, _, err := svc.AddMedia(ctx, me, "connect/profile/not-mine.jpg", "photo"); err == nil {
		t.Fatal("a key outside the caller's prefix must fail")
	}

	var ids []string
	for _, n := range []string{"a", "b", "c"} {
		id, status, err := svc.AddMedia(ctx, me, mediaKeyPrefix(me)+n+".jpg", "photo")
		if err != nil {
			t.Fatal(err)
		}
		if status != "pending" {
			t.Fatalf("status = %q, want pending", status)
		}
		ids = append(ids, id)
	}
	photos, err := svc.ListPhotos(ctx, me)
	if err != nil || len(photos) != 3 || photos[0].ID != ids[0] || photos[2].ID != ids[2] {
		t.Fatalf("initial order wrong: %v %+v", err, photos)
	}

	// Reorder: c first. A partial/duplicate/foreign list is rejected.
	if err := svc.ReorderPhotos(ctx, me, []string{ids[2], ids[0]}); !errors.Is(err, ErrBadOrder) {
		t.Fatalf("partial order: err = %v", err)
	}
	if err := svc.ReorderPhotos(ctx, me, []string{ids[2], ids[2], ids[0]}); !errors.Is(err, ErrBadOrder) {
		t.Fatalf("duplicate order: err = %v", err)
	}
	if err := svc.ReorderPhotos(ctx, me, []string{ids[2], ids[0], ids[1]}); err != nil {
		t.Fatal(err)
	}
	photos, _ = svc.ListPhotos(ctx, me)
	if photos[0].ID != ids[2] || photos[1].ID != ids[0] || photos[2].ID != ids[1] {
		t.Fatalf("reorder not applied: %+v", photos)
	}

	// Another member cannot delete my photo; I can.
	if err := svc.DeleteMedia(ctx, other, ids[0]); !errors.Is(err, ErrMediaNotFound) {
		t.Fatalf("foreign delete: err = %v", err)
	}
	if err := svc.DeleteMedia(ctx, me, ids[0]); err != nil {
		t.Fatal(err)
	}
	photos, _ = svc.ListPhotos(ctx, me)
	if len(photos) != 2 {
		t.Fatalf("after delete: %+v", photos)
	}
}

func TestLiveDB_PhotoCap(t *testing.T) {
	pool := profileTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	uid := profileTestUser(t, pool)
	for i := 0; i < MaxPhotos; i++ {
		if _, _, err := svc.AddMedia(ctx, uid, "https://example.invalid/"+strings.Repeat("p", i+1)+".jpg", "photo"); err != nil {
			t.Fatalf("photo %d: %v", i, err)
		}
	}
	if _, _, err := svc.AddMedia(ctx, uid, "https://example.invalid/over.jpg", "photo"); !errors.Is(err, ErrTooManyPhotos) {
		t.Fatalf("over cap: err = %v", err)
	}
}
