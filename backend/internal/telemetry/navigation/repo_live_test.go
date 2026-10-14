package navigation

// LIVE-DB test for the navigation_events repository. Skipped unless
// TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func cleanupUser(t *testing.T, pool *pgxpool.Pool, uid string) {
	t.Helper()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM navigation_events WHERE user_id = $1::uuid`, uid)
	})
}

func TestLive_InsertBatch(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	uid := uuid.NewString()
	cleanupUser(t, pool, uid)

	now := time.Now().UTC()
	n, err := repo.Insert(ctx, []Event{
		{UserID: uid, Surface: "mobile", Route: "/wallet", OccurredAt: now.Add(-2 * time.Minute)},
		{UserID: uid, Surface: "mobile", Route: "/home", OccurredAt: now.Add(-1 * time.Minute)},
	})
	if err != nil || n != 2 {
		t.Fatalf("Insert = %d, %v; want 2, nil", n, err)
	}
	rows, err := pool.Query(ctx, `SELECT route FROM navigation_events WHERE user_id = $1::uuid ORDER BY occurred_at`, uid)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var r string
		if err := rows.Scan(&r); err != nil {
			t.Fatal(err)
		}
		got = append(got, r)
	}
	if len(got) != 2 || got[0] != "/wallet" || got[1] != "/home" {
		t.Fatalf("rows = %v", got)
	}

	if n, err := repo.Insert(ctx, nil); err != nil || n != 0 {
		t.Fatalf("empty Insert = %d, %v", n, err)
	}
}

func TestLive_PurgeOlderThan(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	uid := uuid.NewString()
	cleanupUser(t, pool, uid)

	now := time.Now().UTC()
	if _, err := repo.Insert(ctx, []Event{
		{UserID: uid, Surface: "web", Route: "/old", OccurredAt: now.Add(-100 * 24 * time.Hour)},
		{UserID: uid, Surface: "web", Route: "/recent", OccurredAt: now.Add(-24 * time.Hour)},
	}); err != nil {
		t.Fatal(err)
	}
	// Other rows in a shared DB may also be purged; scope the assertion to ours
	// by using a tiny batch size to exercise the loop.
	if _, err := repo.PurgeOlderThan(ctx, now.Add(-90*24*time.Hour), 1); err != nil {
		t.Fatal(err)
	}
	var routes []string
	rows, err := pool.Query(ctx, `SELECT route FROM navigation_events WHERE user_id = $1::uuid`, uid)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var r string
		_ = rows.Scan(&r)
		routes = append(routes, r)
	}
	if len(routes) != 1 || routes[0] != "/recent" {
		t.Fatalf("remaining = %v; want [/recent]", routes)
	}
}

func TestLive_PurgeReturnsCount(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	// Isolate: only meaningful if no other stale rows exist.
	var stale int
	cutoff := time.Now().UTC().Add(-90 * 24 * time.Hour)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM navigation_events WHERE occurred_at < $1`, cutoff).Scan(&stale)
	if stale != 0 {
		t.Skip("pre-existing stale rows; count assertion not isolable")
	}
	uid := uuid.NewString()
	cleanupUser(t, pool, uid)
	now := time.Now().UTC()
	if _, err := repo.Insert(ctx, []Event{
		{UserID: uid, Surface: "web", Route: "/old", OccurredAt: now.Add(-100 * 24 * time.Hour)},
		{UserID: uid, Surface: "web", Route: "/recent", OccurredAt: now.Add(-24 * time.Hour)},
	}); err != nil {
		t.Fatal(err)
	}
	n, err := repo.PurgeOlderThan(ctx, cutoff, 10000)
	if err != nil || n != 1 {
		t.Fatalf("PurgeOlderThan = %d, %v; want 1, nil", n, err)
	}
}
