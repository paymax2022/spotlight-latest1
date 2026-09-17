package marketplace

// ---------------------------------------------------------------------------
// LIVE-DB tests for MKT-007 — the admin CMS backend (home/category banners +
// per-category landing/SEO content). Non-money config: no ledger posting, no
// tier-limit gate. Follows the pattern established by
// service_boost_live_db_test.go: TEST_DATABASE_URL-gated, pgxpool via
// t.Cleanup (never defer — per this session's Live-DB Test Gate note), real
// Service wired the same way app-wiring does.
//
// Run:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/marketplace/... -run TestLiveDB_CMS -v
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func cmsTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB marketplace CMS tests")
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

func cmsSeedCategory(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO mkt_categories (id, market_id, slug, name) VALUES ($1,'NG',$2,'CMS Test Category')`,
		id, "cms-test-"+id); err != nil {
		t.Fatalf("seed category: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM mkt_category_content WHERE category_id=$1`, id)
		pool.Exec(context.Background(), `DELETE FROM mkt_categories WHERE id=$1`, id)
	})
	return id
}

func cmsSeedAdmin(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1`, id) })
	return id
}

// ── Banner CRUD + derived status ────────────────────────────────────────────

func TestLiveDB_CMS_CreateBanner_NoScheduleIsLive(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	admin := cmsSeedAdmin(t, ctx, pool)

	b, err := svc.CreateBanner(ctx, admin, BannerInput{
		Slot: "home_hero", Title: "T1", CTAType: "none", ReasonCode: "test_create",
	})
	if err != nil {
		t.Fatalf("CreateBanner: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_banners WHERE id=$1`, b.ID) })
	if b.Status != "live" {
		t.Fatalf("expected status=live for no schedule, got %q", b.Status)
	}
}

func TestLiveDB_CMS_CreateBanner_FutureStartIsScheduled(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	admin := cmsSeedAdmin(t, ctx, pool)

	future := time.Now().Add(72 * time.Hour)
	b, err := svc.CreateBanner(ctx, admin, BannerInput{
		Slot: "home_strip", Title: "T2", CTAType: "none", StartAt: &future, ReasonCode: "test_create",
	})
	if err != nil {
		t.Fatalf("CreateBanner: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_banners WHERE id=$1`, b.ID) })
	if b.Status != "scheduled" {
		t.Fatalf("expected status=scheduled, got %q", b.Status)
	}
}

func TestLiveDB_CMS_CreateBanner_PastEndIsExpired(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	admin := cmsSeedAdmin(t, ctx, pool)

	past := time.Now().Add(-72 * time.Hour)
	b, err := svc.CreateBanner(ctx, admin, BannerInput{
		Slot: "category_top", Title: "T3", CTAType: "none", EndAt: &past, ReasonCode: "test_create",
	})
	if err != nil {
		t.Fatalf("CreateBanner: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_banners WHERE id=$1`, b.ID) })
	if b.Status != "expired" {
		t.Fatalf("expected status=expired, got %q", b.Status)
	}
}

func TestLiveDB_CMS_CreateBanner_MissingReasonCodeRejected(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	admin := cmsSeedAdmin(t, ctx, pool)

	_, err := svc.CreateBanner(ctx, admin, BannerInput{Slot: "home_hero", Title: "NoReason", CTAType: "none"})
	if err == nil {
		t.Fatal("expected error for missing reason_code, got nil")
	}
	ce := asCoded(err)
	if ce.Code != CodeReasonCodeRequired {
		t.Fatalf("expected CodeReasonCodeRequired, got %s", ce.Code)
	}
}

func TestLiveDB_CMS_SetBannerStatus_ArchiveThenRestore(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	admin := cmsSeedAdmin(t, ctx, pool)

	b, err := svc.CreateBanner(ctx, admin, BannerInput{Slot: "home_hero", Title: "ArchiveMe", CTAType: "none", ReasonCode: "test_create"})
	if err != nil {
		t.Fatalf("CreateBanner: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_banners WHERE id=$1`, b.ID) })

	archived, err := svc.SetBannerStatus(ctx, admin, b.ID, "archived", "policy_violation")
	if err != nil {
		t.Fatalf("SetBannerStatus archive: %v", err)
	}
	if archived.Status != "archived" {
		t.Fatalf("expected archived, got %q", archived.Status)
	}

	restored, err := svc.SetBannerStatus(ctx, admin, b.ID, "draft", "restored_by_admin")
	if err != nil {
		t.Fatalf("SetBannerStatus restore: %v", err)
	}
	if restored.Status != "live" {
		t.Fatalf("expected restored banner (no schedule) to read back live, got %q", restored.Status)
	}

	// Audit rows for both transitions must exist with reason codes intact.
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM mkt_admin_audit_log WHERE target_type='banner' AND target_id=$1 AND action='mkt.cms.banner.set_status'`,
		b.ID).Scan(&count); err != nil {
		t.Fatalf("query audit log: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected 2 audit rows for set_status transitions, got %d", count)
	}
}

func TestLiveDB_CMS_SetBannerStatus_MissingReasonCodeRejected(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	admin := cmsSeedAdmin(t, ctx, pool)

	b, err := svc.CreateBanner(ctx, admin, BannerInput{Slot: "home_hero", Title: "X", CTAType: "none", ReasonCode: "test_create"})
	if err != nil {
		t.Fatalf("CreateBanner: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_banners WHERE id=$1`, b.ID) })

	if _, err := svc.SetBannerStatus(ctx, admin, b.ID, "archived", ""); err == nil {
		t.Fatal("expected error for missing reason_code, got nil")
	}
}

func TestLiveDB_CMS_UpdateBanner_PersistsAndAudits(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	admin := cmsSeedAdmin(t, ctx, pool)

	b, err := svc.CreateBanner(ctx, admin, BannerInput{Slot: "home_hero", Title: "Orig", CTAType: "none", ReasonCode: "test_create"})
	if err != nil {
		t.Fatalf("CreateBanner: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM mkt_banners WHERE id=$1`, b.ID) })

	updated, err := svc.UpdateBanner(ctx, admin, b.ID, BannerInput{
		Slot: "home_hero", Title: "Renamed", Subtitle: "new sub", CTAType: "none", ReasonCode: "edit",
	})
	if err != nil {
		t.Fatalf("UpdateBanner: %v", err)
	}
	if updated.Title != "Renamed" || updated.Subtitle != "new sub" {
		t.Fatalf("update did not persist: %+v", updated)
	}

	reloaded, err := svc.repo.GetBanner(ctx, b.ID)
	if err != nil {
		t.Fatalf("GetBanner reload: %v", err)
	}
	if reloaded.Title != "Renamed" {
		t.Fatalf("reload shows stale title: %q", reloaded.Title)
	}
}

// ── Category content: synthesized default + upsert round-trip ─────────────

func TestLiveDB_CMS_GetCategoryContent_NoRowYetSynthesizesDefault(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	catID := cmsSeedCategory(t, ctx, pool)

	cc, err := svc.GetCategoryContent(ctx, catID)
	if err != nil {
		t.Fatalf("GetCategoryContent: %v", err)
	}
	if cc.CategoryName != "CMS Test Category" {
		t.Fatalf("expected category name populated, got %q", cc.CategoryName)
	}
	if cc.HeroHeading != "" || cc.IntroCopy != "" || cc.SEOTitle != "" || cc.SEODescription != "" {
		t.Fatalf("expected empty text fields for synthesized default, got %+v", cc)
	}
	if cc.UpdatedAt != nil || cc.UpdatedBy != nil {
		t.Fatalf("expected nil updated_at/updated_by for synthesized default, got %+v", cc)
	}
}

func TestLiveDB_CMS_GetCategoryContent_UnknownCategoryNotFound(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)

	_, err := svc.GetCategoryContent(ctx, uuid.New().String())
	if err == nil {
		t.Fatal("expected not-found error for unknown category, got nil")
	}
	ce := asCoded(err)
	if ce.Code != CodeNotFound {
		t.Fatalf("expected CodeNotFound, got %s", ce.Code)
	}
}

func TestLiveDB_CMS_UpsertCategoryContent_RoundTrips(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	admin := cmsSeedAdmin(t, ctx, pool)
	catID := cmsSeedCategory(t, ctx, pool)

	written, err := svc.UpsertCategoryContent(ctx, admin, catID, CategoryContentInput{
		HeroHeading: "Welcome", IntroCopy: "Intro", SEOTitle: "SEO T", SEODescription: "SEO D", ReasonCode: "seo_refresh",
	})
	if err != nil {
		t.Fatalf("UpsertCategoryContent: %v", err)
	}
	if written.CategoryName != "CMS Test Category" {
		t.Fatalf("expected category_name on write response, got %q", written.CategoryName)
	}

	readBack, err := svc.GetCategoryContent(ctx, catID)
	if err != nil {
		t.Fatalf("GetCategoryContent after upsert: %v", err)
	}
	if readBack.HeroHeading != "Welcome" || readBack.SEOTitle != "SEO T" || readBack.CategoryName != "CMS Test Category" {
		t.Fatalf("round-trip mismatch: %+v", readBack)
	}
	if readBack.UpdatedBy == nil || *readBack.UpdatedBy != admin {
		t.Fatalf("expected updated_by=%s, got %+v", admin, readBack.UpdatedBy)
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM mkt_admin_audit_log WHERE target_type='category_content' AND target_id=$1 AND reason_code='seo_refresh'`,
		catID).Scan(&count); err != nil {
		t.Fatalf("query audit log: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 audit row, got %d", count)
	}
}

func TestLiveDB_CMS_UpsertCategoryContent_MissingReasonCodeRejected(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	admin := cmsSeedAdmin(t, ctx, pool)
	catID := cmsSeedCategory(t, ctx, pool)

	_, err := svc.UpsertCategoryContent(ctx, admin, catID, CategoryContentInput{HeroHeading: "X"})
	if err == nil {
		t.Fatal("expected error for missing reason_code, got nil")
	}
}
