package connectvoting

// LIVE-DB regression: connect.contests.view must exist and be grantable.
//
// The admin contest list (GET /api/connect/admin/contests, ListContestsAdmin)
// and the eviction READ routes are guarded by guard("connect.contests.view"),
// but 20261231000000_connect_contests_admin_rbac.sql seeded only manage/judge.
// The view slug existed nowhere, so no role except super-admin (whose bypass is
// hard-coded in user_has_permission) could ever hold it, and a scoped
// contest-manager got 403 on the admin list whatever the console showed.
// 20271700000000_connect_contests_view_rbac_seed seeds the permission and
// grants it to super-admin, system-admin and contest-manager. The judge role is
// deliberately NOT granted: its console reads contestants through the member
// endpoint (/api/v1/connect/contests/:id/stages/:n/contestants), which carries
// authentication but no RBAC.
//
// GATED ON TEST_DATABASE_URL only (see railTestPool):
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/voting/ -run TestLiveDB_ContestViewPermission -v

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const contestViewPerm = "connect.contests.view"

func hasRolePermission(t *testing.T, pool *pgxpool.Pool, role, perm string) bool {
	t.Helper()
	var n int
	err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM public.roles r
		JOIN public.role_permissions rp ON rp.role_id = r.id
		JOIN public.permissions p ON p.id = rp.permission_id
		WHERE r.slug = $1 AND p.slug = $2`, role, perm).Scan(&n)
	if err != nil {
		t.Fatalf("lookup %s/%s: %v", role, perm, err)
	}
	return n > 0
}

func TestLiveDB_ContestViewPermissionSeededAndGranted(t *testing.T) {
	pool := railTestPool(t)

	for _, role := range []string{"super-admin", "system-admin", "contest-manager"} {
		if !hasRolePermission(t, pool, role, contestViewPerm) {
			t.Errorf("role %q is missing %q: the admin contest list answers 403 for it", role, contestViewPerm)
		}
	}
	if hasRolePermission(t, pool, "judge", contestViewPerm) {
		t.Errorf(`judge unexpectedly holds %q: the judge console reads contestants via the member endpoint and needs no admin read scope`, contestViewPerm)
	}

	var system bool
	err := pool.QueryRow(context.Background(),
		`SELECT is_system_permission FROM public.permissions WHERE slug = $1`, contestViewPerm).Scan(&system)
	if err != nil {
		t.Fatalf("permission row lookup: %v", err)
	}
	if !system {
		t.Errorf("%s should be a system permission, like its manage/judge siblings", contestViewPerm)
	}
}

// The seed must survive being applied to a database that already has it
// (supabase db push replays; an operator re-running a release chain must not
// duplicate rows or error). ON CONFLICT (slug) DO NOTHING is the mechanism —
// this proves it on a real replay of the migration file itself. pgx's extended
// protocol refuses multi-statement strings, so the replay pool uses the simple
// protocol.
func TestLiveDB_ContestViewSeedIsIdempotent(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB connect/voting seed replay test")
	}
	sql, err := os.ReadFile(filepath.Clean(filepath.Join("..", "..", "..", "..", "supabase", "migrations",
		"20271700000000_connect_contests_view_rbac_seed.sql")))
	if err != nil {
		t.Fatalf("read seed migration: %v", err)
	}

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse dsn: %v", err)
	}
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("connect replay pool: %v", err)
	}
	defer pool.Close()

	ctx := context.Background()
	for i := 0; i < 2; i++ {
		if _, err := pool.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("replay %d: %v", i+1, err)
		}
	}

	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM public.permissions WHERE slug = $1`, contestViewPerm).Scan(&n); err != nil {
		t.Fatalf("count after replay: %v", err)
	}
	if n != 1 {
		t.Errorf("replaying the seed twice left %d %s permission rows, want exactly 1", n, contestViewPerm)
	}
}
