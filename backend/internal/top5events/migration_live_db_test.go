package top5events_test

// Schema assertions for supabase/migrations/20271044000000_events_social.sql
// (event_likes, organiser_follows, organiser_profiles and the new events
// columns). Reads information_schema / pg_constraint / pg_policies only; it
// writes nothing.
//
// Skips unless TEST_DATABASE_URL is set, like the other live-DB suites here.

import (
	"context"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func socialMigrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping events-social migration schema tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

type colInfo struct {
	dataType string
	nullable bool
	dflt     string
}

func socialColumns(t *testing.T, pool *pgxpool.Pool, table string) map[string]colInfo {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT column_name, data_type, is_nullable = 'YES', COALESCE(column_default, '')
		  FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = $1`, table)
	if err != nil {
		t.Fatalf("columns(%s): %v", table, err)
	}
	defer rows.Close()
	out := map[string]colInfo{}
	for rows.Next() {
		var name string
		var c colInfo
		if err := rows.Scan(&name, &c.dataType, &c.nullable, &c.dflt); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out[name] = c
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	return out
}

func socialPrimaryKey(t *testing.T, pool *pgxpool.Pool, table string) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT a.attname
		  FROM pg_constraint c
		  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
		 WHERE c.contype = 'p' AND c.conrelid = ('public.' || $1)::regclass`, table)
	if err != nil {
		t.Fatalf("pk(%s): %v", table, err)
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			t.Fatalf("scan: %v", err)
		}
		cols = append(cols, n)
	}
	sort.Strings(cols)
	return cols
}

func TestMigrationEventsSocial_TablesAndPrimaryKeys(t *testing.T) {
	pool := socialMigrationPool(t)
	cases := map[string][]string{
		"event_likes":        {"event_id", "user_id"},
		"organiser_follows":  {"follower_id", "organiser_id"},
		"organiser_profiles": {"organiser_id"},
	}
	for table, wantPK := range cases {
		cols := socialColumns(t, pool, table)
		if len(cols) == 0 {
			t.Errorf("table public.%s does not exist", table)
			continue
		}
		got := socialPrimaryKey(t, pool, table)
		if strings.Join(got, ",") != strings.Join(wantPK, ",") {
			t.Errorf("%s primary key = %v, want %v", table, got, wantPK)
		}
	}
}

func TestMigrationEventsSocial_NewTableColumns(t *testing.T) {
	pool := socialMigrationPool(t)
	type want struct {
		dataType string
		nullable bool
	}
	cases := map[string]map[string]want{
		"event_likes": {
			"event_id":   {"uuid", false},
			"user_id":    {"uuid", false},
			"created_at": {"timestamp with time zone", false},
		},
		"organiser_follows": {
			"organiser_id": {"uuid", false},
			"follower_id":  {"uuid", false},
			"created_at":   {"timestamp with time zone", false},
		},
		"organiser_profiles": {
			"organiser_id":   {"uuid", false},
			"display_name":   {"text", true},
			"bio":            {"text", false},
			"banner_url":     {"text", true},
			"follower_count": {"integer", false},
			"updated_at":     {"timestamp with time zone", false},
		},
	}
	for table, wantCols := range cases {
		got := socialColumns(t, pool, table)
		for name, w := range wantCols {
			c, ok := got[name]
			if !ok {
				t.Errorf("%s.%s missing", table, name)
				continue
			}
			if c.dataType != w.dataType {
				t.Errorf("%s.%s type = %q, want %q", table, name, c.dataType, w.dataType)
			}
			if c.nullable != w.nullable {
				t.Errorf("%s.%s nullable = %v, want %v", table, name, c.nullable, w.nullable)
			}
		}
	}

	prof := socialColumns(t, pool, "organiser_profiles")
	if d := prof["follower_count"].dflt; d != "0" {
		t.Errorf("organiser_profiles.follower_count default = %q, want 0", d)
	}
	if d := prof["bio"].dflt; !strings.HasPrefix(d, "''") {
		t.Errorf("organiser_profiles.bio default = %q, want empty string", d)
	}
}

func TestMigrationEventsSocial_FollowerCountCheckNonNegative(t *testing.T) {
	pool := socialMigrationPool(t)
	var n int
	err := pool.QueryRow(context.Background(), `
		SELECT count(*)
		  FROM pg_constraint c
		  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
		 WHERE c.contype = 'c'
		   AND c.conrelid = 'public.organiser_profiles'::regclass
		   AND a.attname = 'follower_count'
		   AND pg_get_constraintdef(c.oid) ~ '>= 0'`).Scan(&n)
	if err != nil {
		t.Fatalf("check constraint query: %v", err)
	}
	if n == 0 {
		t.Error("organiser_profiles.follower_count has no CHECK (follower_count >= 0)")
	}
}

func TestMigrationEventsSocial_EventsColumns(t *testing.T) {
	pool := socialMigrationPool(t)
	got := socialColumns(t, pool, "events")

	nullable := map[string]string{
		"banner_url":     "text",
		"venue_lat":      "double precision",
		"venue_lng":      "double precision",
		"venue_place_id": "text",
	}
	for name, typ := range nullable {
		c, ok := got[name]
		if !ok {
			t.Errorf("events.%s missing", name)
			continue
		}
		if c.dataType != typ {
			t.Errorf("events.%s type = %q, want %q", name, c.dataType, typ)
		}
		if !c.nullable {
			t.Errorf("events.%s must be nullable (legacy rows have no value)", name)
		}
	}

	lc, ok := got["like_count"]
	if !ok {
		t.Fatal("events.like_count missing")
	}
	if lc.dataType != "integer" {
		t.Errorf("events.like_count type = %q, want integer", lc.dataType)
	}
	if lc.nullable {
		t.Error("events.like_count must be NOT NULL")
	}
	if lc.dflt != "0" {
		t.Errorf("events.like_count default = %q, want 0", lc.dflt)
	}
}

func TestMigrationEventsSocial_RLSEnabledNotForced(t *testing.T) {
	pool := socialMigrationPool(t)
	for _, table := range []string{"event_likes", "organiser_follows", "organiser_profiles"} {
		var enabled, forced bool
		err := pool.QueryRow(context.Background(), `
			SELECT relrowsecurity, relforcerowsecurity
			  FROM pg_class
			 WHERE oid = ('public.' || $1)::regclass`, table).Scan(&enabled, &forced)
		if err != nil {
			t.Fatalf("rls(%s): %v", table, err)
		}
		if !enabled {
			t.Errorf("%s: RLS not enabled", table)
		}
		if forced {
			t.Errorf("%s: RLS must not be FORCEd", table)
		}
	}
}

func TestMigrationEventsSocial_Indexes(t *testing.T) {
	pool := socialMigrationPool(t)
	for _, idx := range []string{"idx_organiser_follows_follower", "idx_events_organiser_state_starts"} {
		var n int
		if err := pool.QueryRow(context.Background(),
			`SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`, idx).Scan(&n); err != nil {
			t.Fatalf("index query: %v", err)
		}
		if n != 1 {
			t.Errorf("index %s missing", idx)
		}
	}
}
