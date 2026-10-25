package connectvoting

// LIVE-DB test for the contest logo + status filter, end to end through the real
// contests -> connect_contests mirror trigger.
//
// Why live: a contest's logo is written to public.contests by the admin and
// reaches mobile only through public.sync_connect_contest(). That function was
// rebuilt from an older definition once and broke every fresh replay with
// "column banner_image_url of relation connect_contests does not exist"
// (42703). This proves, on a database built from the full migration chain, that
// the logo AND the banner/rules the function already carried all survive, and
// that the list endpoint's status filter returns exactly the right contests.
//
// GATED ON TEST_DATABASE_URL only (see railTestPool):
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/voting/ -run TestLiveDB_ContestLogo -v

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func seedLegacyContest(t *testing.T, pool *pgxpool.Pool, status, logo, banner string) string {
	t.Helper()
	id := uuid.NewString()
	slug := "zz-logo-" + id[:8]
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO public.contests (id, name, slug, status, rules_text, logo_url, banner_image_url)
		VALUES ($1, $2, $3, $4::public.contest_status, $5, $6, $7)`,
		id, "ZZ logo fixture "+id[:8], slug, status, "fixture rules", logo, banner); err != nil {
		t.Fatalf("seed legacy contest (%s): %v", status, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.connect_contests WHERE id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.contests WHERE id = $1`, id)
	})
	return id
}

func TestLiveDB_ContestLogo_MirrorsAndFilters(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	// 'active' mirrors to connect status 'open'; 'ended' mirrors to 'closed'.
	activeID := seedLegacyContest(t, pool, "active", "https://cdn.test/logo-a.png", "https://cdn.test/banner-a.jpg")
	closedID := seedLegacyContest(t, pool, "ended", "", "")

	// 1. The mirror carries the logo AND the pre-existing banner + rules.
	got, err := repo.GetContest(ctx, activeID)
	if err != nil {
		t.Fatalf("GetContest(active): %v", err)
	}
	if got.LogoURL != "https://cdn.test/logo-a.png" {
		t.Errorf("mirror dropped the logo: %q", got.LogoURL)
	}
	if want := "zz-logo-" + activeID[:8]; got.Slug != want {
		t.Errorf("GetContest lost the slug: got %q, want %q", got.Slug, want)
	}
	if got.BannerImageURL != "https://cdn.test/banner-a.jpg" {
		t.Errorf("logo migration clobbered the banner: %q", got.BannerImageURL)
	}
	if got.RulesText != "fixture rules" {
		t.Errorf("logo migration clobbered rules_text: %q", got.RulesText)
	}

	// 2. An update on the legacy row reaches the mirror.
	if _, err := pool.Exec(ctx, `UPDATE public.contests SET logo_url = $2 WHERE id = $1`,
		activeID, "https://cdn.test/logo-b.png"); err != nil {
		t.Fatalf("update logo: %v", err)
	}
	got, err = repo.GetContest(ctx, activeID)
	if err != nil {
		t.Fatalf("GetContest after update: %v", err)
	}
	if got.LogoURL != "https://cdn.test/logo-b.png" {
		t.Errorf("logo update did not reach the mirror: %q", got.LogoURL)
	}

	// 3. The status filter returns exactly the right contests.
	has := func(list []Contest, id string) bool {
		for _, c := range list {
			if c.ID == id {
				return true
			}
		}
		return false
	}
	open, err := repo.ListContestsByStatus(ctx, 200, []string{"open"})
	if err != nil {
		t.Fatalf("list open: %v", err)
	}
	if !has(open, activeID) || has(open, closedID) {
		t.Errorf("active filter must include the open contest and exclude the closed one")
	}
	closed, err := repo.ListContestsByStatus(ctx, 200, []string{"closed"})
	if err != nil {
		t.Fatalf("list closed: %v", err)
	}
	if has(closed, activeID) || !has(closed, closedID) {
		t.Errorf("closed filter must include the closed contest and exclude the open one")
	}
	both, err := repo.ListContests(ctx, 200)
	if err != nil {
		t.Fatalf("list both: %v", err)
	}
	if !has(both, activeID) || !has(both, closedID) {
		t.Errorf("the unfiltered list must still return open and closed, as before")
	}

	// 4. Slug is the last column of the shared scan list, so a misordered SELECT
	//    or a NULL that fails to coalesce shows up here and nowhere else — no
	//    DB-free test can see it, and the admin console builds its Edit link
	//    from this value.
	for _, c := range both {
		if c.ID != activeID {
			continue
		}
		if want := "zz-logo-" + activeID[:8]; c.Slug != want {
			t.Errorf("the list lost the slug: got %q, want %q", c.Slug, want)
		}
	}
}
