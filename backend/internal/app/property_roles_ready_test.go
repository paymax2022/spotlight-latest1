package app

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fakeRow struct {
	v   bool
	err error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	*(dest[0].(*bool)) = r.v
	return nil
}

type fakeQuerier struct{ row fakeRow }

func (q fakeQuerier) QueryRow(context.Context, string, ...any) pgx.Row { return q.row }

func TestRolesTablesReady_FalsePaths(t *testing.T) {
	ctx := context.Background()
	if rolesTablesReady(ctx, nil) {
		t.Fatal("nil pool must be not-ready")
	}
	if tablesProbe(ctx, fakeQuerier{fakeRow{v: false}}) {
		t.Fatal("missing table must be not-ready")
	}
	if tablesProbe(ctx, fakeQuerier{fakeRow{err: errors.New("boom")}}) {
		t.Fatal("probe error must be not-ready (fail closed)")
	}
	if !tablesProbe(ctx, fakeQuerier{fakeRow{v: true}}) {
		t.Fatal("present table must be ready")
	}
}

// Live-DB: the migration is applied on the local stack, so the probe is true.
func TestRolesTablesReady_LiveDB(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if !rolesTablesReady(context.Background(), pool) {
		t.Fatal("property_role_profiles exists on the test DB; probe must be true")
	}
}
