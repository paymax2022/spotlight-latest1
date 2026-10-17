package top5events_test

// Organiser profile, banner presign and banner key ownership (events-social,
// Task 6).
//
// Two kinds of test live here:
//   - Live-DB tests (TestGetOrganiser_*, TestUpdateMyOrganiser_Persists*,
//     TestUpdateMyOrganiser_ClearBanner*) reuse the pool and user fixtures from
//     ticket_token_live_db_test.go and skip unless TEST_DATABASE_URL is set.
//   - TestUpdateMyOrganiser_RejectsForeignBannerKey and
//     TestPresignOrganiserBanner_RejectsBadContentType need no database: both
//     checks must fire BEFORE any write or any URL is issued, so they run
//     against a Service built with a nil pool. A write attempt would panic on
//     the nil pool, so a pass proves the rejection comes first.

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/platform/r2"
	"spotlight/backend/internal/top5events"
)

func testBannerPresigner() *r2.Presigner {
	return r2.New(r2.Config{
		AccountEndpoint: "https://acct.r2.cloudflarestorage.com",
		Bucket:          "test-bucket",
		AccessKeyID:     "AKIDEXAMPLE",
		SecretAccessKey: "secretsecretsecretsecretsecretsecretsecret",
		Region:          "auto",
	})
}

// ---------- DB-free ----------

func TestUpdateMyOrganiser_RejectsForeignBannerKey(t *testing.T) {
	svc := top5events.NewService(nil, nil, nil, nil, nil, nil, nil, nil)
	me := uuid.New().String()
	other := uuid.New().String()

	for name, ref := range map[string]string{
		"another user's key":   "organiser/" + other + "/banner/abc.png",
		"my id, wrong folder":  "organiser/" + me + "/avatar/abc.png",
		"restaurant key":       "restaurant/" + me + "/store/banner/abc.png",
		"path traversal":       "organiser/" + me + "/banner/../../" + other + "/banner/abc.png",
		"disallowed extension": "organiser/" + me + "/banner/abc.svg",
		"no extension":         "organiser/" + me + "/banner/abc",
		"javascript scheme":    "javascript:alert(1)",
		"data scheme":          "data:image/png;base64,AAAA",
		"file scheme":          "file:///var/mobile/photo.png",
		"scheme with no host":  "https:///x.png",
		"bare prefix, no file": "organiser/" + me + "/banner/",
		"prefix of someone else with my id as suffix": "organiser/" + other + "/banner/" + me + ".png",
	} {
		_, err := svc.UpdateMyOrganiser(context.Background(), me, top5events.OrganiserPatch{
			BannerURL: strp(ref), BannerSet: true,
		})
		if !errors.Is(err, top5events.ErrValidation) {
			t.Errorf("%s (%q): err = %v, want ErrValidation", name, ref, err)
		}
	}
}

func TestUpdateMyOrganiser_RejectsBadText(t *testing.T) {
	svc := top5events.NewService(nil, nil, nil, nil, nil, nil, nil, nil)
	me := uuid.New().String()
	long := strings.Repeat("x", 2001)
	if _, err := svc.UpdateMyOrganiser(context.Background(), me, top5events.OrganiserPatch{Bio: &long}); !errors.Is(err, top5events.ErrValidation) {
		t.Errorf("long bio: err = %v, want ErrValidation", err)
	}
	longName := strings.Repeat("x", 121)
	if _, err := svc.UpdateMyOrganiser(context.Background(), me, top5events.OrganiserPatch{DisplayName: &longName}); !errors.Is(err, top5events.ErrValidation) {
		t.Errorf("long display name: err = %v, want ErrValidation", err)
	}
	if _, err := svc.UpdateMyOrganiser(context.Background(), "not-a-uuid", top5events.OrganiserPatch{}); !errors.Is(err, top5events.ErrValidation) {
		t.Errorf("bad caller id: err = %v, want ErrValidation", err)
	}
}

func TestPresignOrganiserBanner_RejectsBadContentType(t *testing.T) {
	// A configured presigner proves the rejection is the content-type check, not a
	// missing-storage fallback.
	svc := top5events.NewService(nil, nil, nil, nil, nil, nil, nil, nil).WithStorage(testBannerPresigner())
	me := uuid.New().String()

	for name, tc := range map[string]struct{ file, ct string }{
		"pdf":                    {"banner.pdf", "application/pdf"},
		"svg":                    {"banner.svg", "image/svg+xml"},
		"html":                   {"banner.html", "text/html"},
		"gif":                    {"banner.gif", "image/gif"},
		"no extension":           {"banner", "image/png"},
		"type mismatches ext":    {"banner.png", "image/jpeg"},
		"image ext, text type":   {"banner.png", "text/plain"},
		"empty content type":     {"banner.png", ""},
		"smuggled type on a png": {"banner.png", "image/png; charset=x"},
	} {
		got, err := svc.PresignOrganiserBanner(context.Background(), me, tc.file, tc.ct)
		if !errors.Is(err, top5events.ErrValidation) {
			t.Errorf("%s: err = %v, want ErrValidation", name, err)
		}
		if got != nil {
			t.Errorf("%s: a URL was issued for a rejected type: %+v", name, got)
		}
	}
}

func TestPresignOrganiserBanner_IssuesScopedKey(t *testing.T) {
	svc := top5events.NewService(nil, nil, nil, nil, nil, nil, nil, nil).WithStorage(testBannerPresigner())
	me := uuid.New().String()

	p, err := svc.PresignOrganiserBanner(context.Background(), me, "Banner.JPG", "image/jpeg")
	if err != nil {
		t.Fatalf("presign: %v", err)
	}
	if !strings.HasPrefix(p.ObjectKey, "organiser/"+me+"/banner/") || !strings.HasSuffix(p.ObjectKey, ".jpg") {
		t.Errorf("object key %q is not under the caller's banner prefix", p.ObjectKey)
	}
	if p.Method != "PUT" || p.ContentType != "image/jpeg" || p.ExpiresIn != 600 || p.UploadURL == "" {
		t.Errorf("unexpected presign: %+v", p)
	}
	if !strings.Contains(p.UploadURL, "test-bucket") {
		t.Errorf("upload url %q should address the configured bucket", p.UploadURL)
	}
	// The key it mints is exactly what UpdateMyOrganiser accepts as its own (the
	// validation passes; the nil pool then stops the write, which panics, so only
	// check acceptance through the rejection path's complement in the live test).
}

func TestPresignOrganiserBanner_UnavailableWithoutStorage(t *testing.T) {
	svc := top5events.NewService(nil, nil, nil, nil, nil, nil, nil, nil)
	_, err := svc.PresignOrganiserBanner(context.Background(), uuid.New().String(), "b.png", "image/png")
	if !errors.Is(err, top5events.ErrBannerUploadsUnavailable) {
		t.Fatalf("err = %v, want ErrBannerUploadsUnavailable", err)
	}
}

// ---------- live DB ----------

func TestGetOrganiser_FallsBackToFullName(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)
	// handle_new_user may already have made the row; set the name either way.
	if _, err := pool.Exec(ctx,
		`INSERT INTO user_profiles (id, email, full_name) VALUES ($1,$2,'Ada Organiser')
		 ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name`,
		organiser, organiser+"@organiser-profile.itest"); err != nil {
		t.Fatalf("seed user_profiles: %v", err)
	}

	got, err := svc.GetOrganiser(ctx, organiser, organiser)
	if err != nil {
		t.Fatalf("GetOrganiser: %v", err)
	}
	if got.DisplayName != "Ada Organiser" {
		t.Fatalf("DisplayName = %q, want the full_name fallback", got.DisplayName)
	}
	if got.OrganiserID != organiser || got.FollowerCount != 0 || got.Following || got.BannerURL != nil {
		t.Fatalf("unexpected profile: %+v", got)
	}
	if got.Events == nil {
		t.Fatal("Events must be a non-nil empty list so JSON is [] not null")
	}
}

func TestGetOrganiser_UnknownOrganiserIsNotFound(t *testing.T) {
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	viewer := seedTicketTokenUser(t, context.Background(), pool)

	if _, err := svc.GetOrganiser(context.Background(), viewer, uuid.New().String()); !errors.Is(err, top5events.ErrNotFound) {
		t.Fatalf("unknown organiser: err = %v, want ErrNotFound", err)
	}
	if _, err := svc.GetOrganiser(context.Background(), viewer, "not-a-uuid"); !errors.Is(err, top5events.ErrNotFound) {
		t.Fatalf("malformed organiser id: err = %v, want ErrNotFound", err)
	}
}

func TestGetOrganiser_ShowsFollowStateAndUpcomingPublicEvents(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)
	viewer := seedTicketTokenUser(t, ctx, pool)
	live := seedSocialEvent(t, ctx, pool, organiser, "LIVE")
	_ = seedSocialEvent(t, ctx, pool, organiser, "DRAFT") // must not be listed

	if _, err := svc.FollowOrganiser(ctx, viewer, organiser); err != nil {
		t.Fatalf("follow: %v", err)
	}
	if _, err := svc.LikeEvent(ctx, viewer, live); err != nil {
		t.Fatalf("like: %v", err)
	}

	got, err := svc.GetOrganiser(ctx, viewer, organiser)
	if err != nil {
		t.Fatalf("GetOrganiser: %v", err)
	}
	if !got.Following || got.FollowerCount != 1 {
		t.Fatalf("follow state = %v / %d, want true / 1", got.Following, got.FollowerCount)
	}
	if len(got.Events) != 1 || got.Events[0].ID != live || !got.Events[0].Liked {
		t.Fatalf("events = %+v, want only the LIVE event, liked by the viewer", got.Events)
	}
}

func TestUpdateMyOrganiser_PersistsAndKeepsFollowerCount(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)

	organiser := seedTicketTokenUser(t, ctx, pool)
	fan := seedTicketTokenUser(t, ctx, pool)
	if _, err := svc.FollowOrganiser(ctx, fan, organiser); err != nil {
		t.Fatalf("follow: %v", err)
	}

	key := "organiser/" + organiser + "/banner/abc123.png"
	got, err := svc.UpdateMyOrganiser(ctx, organiser, top5events.OrganiserPatch{
		DisplayName: strp("Ada Events"), Bio: strp("We throw parties."),
		BannerURL: strp(key), BannerSet: true,
	})
	if err != nil {
		t.Fatalf("UpdateMyOrganiser: %v", err)
	}
	if got.DisplayName != "Ada Events" || got.Bio != "We throw parties." || got.FollowerCount != 1 {
		t.Fatalf("unexpected profile: %+v", got)
	}
	// A partial edit leaves the other fields alone.
	got, err = svc.UpdateMyOrganiser(ctx, organiser, top5events.OrganiserPatch{Bio: strp("New bio")})
	if err != nil {
		t.Fatalf("second update: %v", err)
	}
	if got.DisplayName != "Ada Events" || got.Bio != "New bio" {
		t.Fatalf("partial edit clobbered a field: %+v", got)
	}
	var stored *string
	if err := pool.QueryRow(ctx, `SELECT banner_url FROM organiser_profiles WHERE organiser_id=$1`, organiser).Scan(&stored); err != nil {
		t.Fatalf("read banner: %v", err)
	}
	if stored == nil || *stored != key {
		t.Fatalf("stored banner = %v, want the key as sent", stored)
	}
}

func TestUpdateMyOrganiser_ClearBannerWithNullOrEmpty(t *testing.T) {
	pool := ticketTokenPool(t)
	ctx := context.Background()
	svc := ticketTokenService(pool)
	organiser := seedTicketTokenUser(t, ctx, pool)

	set := func() {
		t.Helper()
		if _, err := svc.UpdateMyOrganiser(ctx, organiser, top5events.OrganiserPatch{
			BannerURL: strp("https://example.com/b.png"), BannerSet: true,
		}); err != nil {
			t.Fatalf("set banner: %v", err)
		}
	}
	stored := func() *string {
		t.Helper()
		var s *string
		if err := pool.QueryRow(ctx, `SELECT banner_url FROM organiser_profiles WHERE organiser_id=$1`, organiser).Scan(&s); err != nil {
			t.Fatalf("read banner: %v", err)
		}
		return s
	}

	set()
	// Absent field: no change.
	if _, err := svc.UpdateMyOrganiser(ctx, organiser, top5events.OrganiserPatch{Bio: strp("x")}); err != nil {
		t.Fatalf("update: %v", err)
	}
	if s := stored(); s == nil {
		t.Fatal("an absent banner_url must not clear the banner")
	}
	// Explicit null clears.
	if _, err := svc.UpdateMyOrganiser(ctx, organiser, top5events.OrganiserPatch{BannerSet: true}); err != nil {
		t.Fatalf("clear with null: %v", err)
	}
	if s := stored(); s != nil {
		t.Fatalf("banner after null = %q, want NULL", *s)
	}
	set()
	// Empty string clears.
	if _, err := svc.UpdateMyOrganiser(ctx, organiser, top5events.OrganiserPatch{BannerURL: strp(""), BannerSet: true}); err != nil {
		t.Fatalf("clear with empty: %v", err)
	}
	if s := stored(); s != nil {
		t.Fatalf("banner after empty string = %q, want NULL", *s)
	}
}
