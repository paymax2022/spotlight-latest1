package propertyroles_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// fixtureName marks every profile this package creates so cleanup can target
// only its own rows.
const fixtureName = "ZZ Go Property Role Fixture"

// propertyPool returns a pool for the live-DB suites, or skips. Gated on
// TEST_DATABASE_URL only (never DATABASE_URL, which may point at production).
func propertyPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	// Registered FIRST so it runs LAST (cleanups are LIFO); fixture teardowns
	// still need an open pool. Never `defer pool.Close()`.
	t.Cleanup(pool.Close)
	return pool
}

// anyUser borrows an existing auth.users id rather than seeding one.
func anyUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM auth.users ORDER BY created_at LIMIT 1`).Scan(&id); err != nil {
		t.Fatalf("no auth.users row to attach the fixture to: %v", err)
	}
	return id
}
