package rbac_test

// ---------------------------------------------------------------------------
// LIVE-DB test: GetAdminUser fetches the REQUESTED user, not just whichever
// user happens to be newest.
//
// WHY THIS EXISTS (AUTH-019)
// --------------------------
// GetAdminUser used to be implemented as ListAdminUsers(Limit: 1) followed by
// a linear search of that one-row result for a matching ID. ListAdminUsers
// orders by created_at.desc, so a Limit of 1 fetches only the single newest
// platform_users row system-wide — every other lookup silently 404'd. This
// broke the admin console's per-user inspect/update/suspend/lock workflow for
// every user except whoever registered last.
//
// A test that seeds one user and fetches it by ID would pass against BOTH the
// broken implementation (if that user happens to be newest) and the fixed
// one, so it would not have caught this. The property that actually matters
// is: fetching a user that is NOT the most recently created one still
// succeeds and returns the right row. This seeds three users with distinct,
// explicit created_at timestamps and fetches the two that are NOT newest.
//
// Runs against real PostgREST (the same code path GetAdminUser uses in
// production — internal/integrations.SupabaseRestClient), not a mock, so a
// wrong query-param shape (e.g. malformed `id=eq.<uuid>`) fails here instead
// of only in production.
//
// Gated on TEST_DATABASE_URL (never DATABASE_URL — see
// scripts/ci/check-live-db-gate.sh) AND on SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY, because the repository talks to PostgREST, not
// the database directly.
//
// Bring-up:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	export SUPABASE_URL="http://127.0.0.1:54321"
//	export SUPABASE_SERVICE_ROLE_KEY="<local service role key>"
//	cd backend && go test ./tests/rbac/... -v
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/repositories"
)

func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB GetAdminUser test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	// Registered first so it runs LAST: t.Cleanup is LIFO, and closing the
	// pool before the fixture DELETEs would leak rows into the shared dev DB.
	t.Cleanup(pool.Close)
	return pool
}

func supabaseForTest(t *testing.T) *integrations.SupabaseRestClient {
	t.Helper()
	url := strings.TrimRight(strings.TrimSpace(os.Getenv("SUPABASE_URL")), "/")
	key := strings.TrimSpace(os.Getenv("SUPABASE_SERVICE_ROLE_KEY"))
	if url == "" || key == "" {
		t.Skip("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping live-DB GetAdminUser test")
	}
	return integrations.NewSupabaseRestClient(url, key)
}

// seedPlatformUser inserts a minimal platform_users row directly via SQL
// (platform_users has no FK to auth.users — see the "Platform Users FK
// Cleanup Gotcha" memory note — so this needs no GoTrue identity) with an
// explicit created_at, and registers its removal.
func seedPlatformUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, createdAt time.Time) (id, email string) {
	t.Helper()
	email = "auth019-" + uuid.NewString() + "@test.local"
	row := pool.QueryRow(ctx, `
		INSERT INTO platform_users (first_name, last_name, email, user_type, status, created_at, updated_at)
		VALUES ($1, $2, $3, 'registered_user', 'active', $4, $4)
		RETURNING id::text
	`, "AUTH019", "Fixture", email, createdAt)
	if err := row.Scan(&id); err != nil {
		t.Fatalf("seed platform_users row: %v", err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `DELETE FROM platform_users WHERE id = $1`, id); err != nil {
			t.Errorf("cleanup platform_users row %s: %v", id, err)
		}
	})
	return id, email
}

func TestLiveDB_GetAdminUserFetchesNonNewestUserByID(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	supabase := supabaseForTest(t)
	repo := repositories.NewRBACSupabaseRepository(supabase)

	now := time.Now().UTC()
	oldestID, oldestEmail := seedPlatformUser(t, ctx, pool, now.Add(-2*time.Hour))
	middleID, middleEmail := seedPlatformUser(t, ctx, pool, now.Add(-1*time.Hour))
	newestID, _ := seedPlatformUser(t, ctx, pool, now)

	// Sanity check on the property this bug depended on: ListAdminUsers with
	// Limit 1 and no filters (what the old, broken GetAdminUser called under
	// the hood, ordered created_at.desc) returns the NEWEST row system-wide —
	// never the oldest of our three seeded rows. This is deliberately loose
	// (this is a shared dev DB; another session may have an even-newer row)
	// — it only needs to show the newest-only page can't be our oldest seed.
	newestOnly, err := repo.ListAdminUsers(domain.AdminUserFilter{Limit: 1})
	if err != nil {
		t.Fatalf("ListAdminUsers(Limit: 1): %v", err)
	}
	if len(newestOnly) == 1 && newestOnly[0].ID == oldestID {
		t.Fatalf("ListAdminUsers(Limit: 1) unexpectedly returned the oldest seeded user (%s) — "+
			"test assumptions about created_at ordering are stale", oldestID)
	}

	// Fetch the OLDEST seeded user — the case that was broken (it is never
	// the single row a Limit:1/created_at.desc query returns).
	got, err := repo.GetAdminUser(oldestID)
	if err != nil {
		t.Fatalf("GetAdminUser(oldest, non-newest user): %v", err)
	}
	if got.ID != oldestID {
		t.Fatalf("GetAdminUser(%s) returned a different user: %s", oldestID, got.ID)
	}
	if got.Email != oldestEmail {
		t.Fatalf("GetAdminUser(%s) returned email %q, want %q", oldestID, got.Email, oldestEmail)
	}

	// And the middle one, for good measure — also not the newest.
	got, err = repo.GetAdminUser(middleID)
	if err != nil {
		t.Fatalf("GetAdminUser(middle, non-newest user): %v", err)
	}
	if got.ID != middleID || got.Email != middleEmail {
		t.Fatalf("GetAdminUser(%s) = {ID:%s Email:%s}, want {ID:%s Email:%s}", middleID, got.ID, got.Email, middleID, middleEmail)
	}

	// The newest user must still be fetchable too — this endpoint must not
	// regress into only ever finding non-newest rows.
	got, err = repo.GetAdminUser(newestID)
	if err != nil {
		t.Fatalf("GetAdminUser(newest user): %v", err)
	}
	if got.ID != newestID {
		t.Fatalf("GetAdminUser(%s) returned a different user: %s", newestID, got.ID)
	}

	// An ID that exists nowhere must report "not found", not a stale/wrong row.
	if _, err := repo.GetAdminUser(uuid.NewString()); err == nil {
		t.Fatal("GetAdminUser with an unknown ID returned no error")
	}
}
