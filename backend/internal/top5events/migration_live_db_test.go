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

type policyInfo struct {
	cmd       string
	qual      string
	withCheck string
}

func socialPolicies(t *testing.T, pool *pgxpool.Pool, table string) map[string]policyInfo {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT policyname, cmd, COALESCE(qual, ''), COALESCE(with_check, '')
		  FROM pg_policies
		 WHERE schemaname = 'public' AND tablename = $1`, table)
	if err != nil {
		t.Fatalf("policies(%s): %v", table, err)
	}
	defer rows.Close()
	out := map[string]policyInfo{}
	for rows.Next() {
		var name string
		var p policyInfo
		if err := rows.Scan(&name, &p.cmd, &p.qual, &p.withCheck); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out[name] = p
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	return out
}

func TestMigrationEventsSocial_RLSPolicies(t *testing.T) {
	pool := socialMigrationPool(t)

	// ownCol is the column the own-row predicate must reference; "" means a plain
	// read policy that must be `true` (any signed-in user).
	type want struct {
		table, name, cmd, ownCol string
	}
	cases := []want{
		{"event_likes", "event_likes_read", "SELECT", ""},
		{"event_likes", "event_likes_insert_own", "INSERT", "user_id"},
		{"event_likes", "event_likes_delete_own", "DELETE", "user_id"},
		{"organiser_follows", "organiser_follows_read", "SELECT", ""},
		{"organiser_follows", "organiser_follows_insert_own", "INSERT", "follower_id"},
		{"organiser_follows", "organiser_follows_delete_own", "DELETE", "follower_id"},
		{"organiser_profiles", "organiser_profiles_read", "SELECT", ""},
		{"organiser_profiles", "organiser_profiles_insert_own", "INSERT", "organiser_id"},
		{"organiser_profiles", "organiser_profiles_update_own", "UPDATE", "organiser_id"},
	}
	byTable := map[string]map[string]policyInfo{}
	for _, c := range cases {
		if byTable[c.table] == nil {
			byTable[c.table] = socialPolicies(t, pool, c.table)
		}
		p, ok := byTable[c.table][c.name]
		if !ok {
			t.Errorf("%s: policy %s missing", c.table, c.name)
			continue
		}
		if p.cmd != c.cmd {
			t.Errorf("%s.%s cmd = %q, want %q", c.table, c.name, p.cmd, c.cmd)
		}
		// INSERT policies carry their predicate in WITH CHECK, DELETE in USING,
		// UPDATE in both.
		var preds []string
		switch c.cmd {
		case "INSERT":
			preds = []string{p.withCheck}
		case "DELETE", "SELECT":
			preds = []string{p.qual}
		case "UPDATE":
			preds = []string{p.qual, p.withCheck}
		}
		for _, pred := range preds {
			if c.ownCol == "" {
				if strings.TrimSpace(strings.Trim(pred, "()")) != "true" {
					t.Errorf("%s.%s predicate = %q, want true", c.table, c.name, pred)
				}
				continue
			}
			if !strings.Contains(pred, c.ownCol) || !strings.Contains(pred, "auth.uid()") {
				t.Errorf("%s.%s predicate = %q, want %s = auth.uid()", c.table, c.name, pred, c.ownCol)
			}
		}
	}
	// No policy beyond the nine expected, so nothing grants wider writes.
	total := 0
	for _, m := range byTable {
		total += len(m)
	}
	if total != len(cases) {
		t.Errorf("found %d policies across the three tables, want %d", total, len(cases))
	}
}

func TestMigrationEventsSocial_ForeignKeys(t *testing.T) {
	pool := socialMigrationPool(t)
	rows, err := pool.Query(context.Background(), `
		SELECT cl.relname, a.attname, tn.nspname || '.' || tc.relname, c.confdeltype
		  FROM pg_constraint c
		  JOIN pg_class cl      ON cl.oid = c.conrelid
		  JOIN pg_namespace n   ON n.oid = cl.relnamespace AND n.nspname = 'public'
		  JOIN pg_attribute a   ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
		  JOIN pg_class tc      ON tc.oid = c.confrelid
		  JOIN pg_namespace tn  ON tn.oid = tc.relnamespace
		 WHERE c.contype = 'f'
		   AND cl.relname IN ('event_likes', 'organiser_follows', 'organiser_profiles')`)
	if err != nil {
		t.Fatalf("fk query: %v", err)
	}
	defer rows.Close()
	got := map[string]string{} // "table.column" -> "target|deltype"
	for rows.Next() {
		var table, col, target, del string
		if err := rows.Scan(&table, &col, &target, &del); err != nil {
			t.Fatalf("scan: %v", err)
		}
		got[table+"."+col] = target + "|" + del
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	want := map[string]string{
		"event_likes.event_id":            "public.events|c",
		"event_likes.user_id":             "auth.users|c",
		"organiser_follows.organiser_id":  "auth.users|c",
		"organiser_follows.follower_id":   "auth.users|c",
		"organiser_profiles.organiser_id": "auth.users|c",
	}
	for k, w := range want {
		if got[k] != w {
			t.Errorf("FK %s = %q, want %q (target|ON DELETE; c = CASCADE)", k, got[k], w)
		}
	}
	for k := range got {
		if _, ok := want[k]; !ok {
			t.Errorf("unexpected FK %s -> %s", k, got[k])
		}
	}
}

func TestMigrationEventsSocial_CounterColumnsNotWritableByClients(t *testing.T) {
	pool := socialMigrationPool(t)
	has := func(table, col, priv string) bool {
		var ok bool
		err := pool.QueryRow(context.Background(),
			`SELECT has_column_privilege('authenticated', $1, $2, $3)`,
			"public."+table, col, priv).Scan(&ok)
		if err != nil {
			t.Fatalf("has_column_privilege(%s.%s %s): %v", table, col, priv, err)
		}
		return ok
	}

	// organiser_profiles.follower_count: neither INSERT nor UPDATE for clients.
	for _, priv := range []string{"UPDATE", "INSERT"} {
		if has("organiser_profiles", "follower_count", priv) {
			t.Errorf("authenticated can %s organiser_profiles.follower_count; must be backend-only", priv)
		}
	}
	// The columns an organiser edits must stay writable.
	for _, col := range []string{"display_name", "bio", "updated_at"} {
		if !has("organiser_profiles", col, "UPDATE") {
			t.Errorf("authenticated lost UPDATE on organiser_profiles.%s", col)
		}
	}
	// banner_url is backend-only (R42): a PostgREST write would skip the
	// classifyBannerRef ownership check that PUT /events/organisers/me applies.
	for _, priv := range []string{"UPDATE", "INSERT"} {
		if has("organiser_profiles", "banner_url", priv) {
			t.Errorf("authenticated can %s organiser_profiles.banner_url; must be backend-only", priv)
		}
	}

	// events.like_count: pinned by a trigger (a column REVOKE cannot subtract from
	// the table-level grant), so assert the trigger exists, is enabled, covers
	// INSERT and UPDATE, and its function references like_count.
	var def string
	var enabled string
	err := pool.QueryRow(context.Background(), `
		SELECT pg_get_triggerdef(t.oid), t.tgenabled::text
		  FROM pg_trigger t
		 WHERE t.tgrelid = 'public.events'::regclass
		   AND t.tgname = 'trg_events_protect_like_count'
		   AND NOT t.tgisinternal`).Scan(&def, &enabled)
	if err != nil {
		t.Fatalf("trigger trg_events_protect_like_count missing: %v", err)
	}
	if enabled == "D" {
		t.Error("trg_events_protect_like_count is disabled")
	}
	for _, frag := range []string{"BEFORE INSERT OR UPDATE", "FOR EACH ROW"} {
		if !strings.Contains(def, frag) {
			t.Errorf("trigger definition %q missing %q", def, frag)
		}
	}
	var src string
	if err := pool.QueryRow(context.Background(),
		`SELECT prosrc FROM pg_proc WHERE proname = 'events_protect_like_count' AND pronamespace = 'public'::regnamespace`).Scan(&src); err != nil {
		t.Fatalf("function events_protect_like_count missing: %v", err)
	}
	if !strings.Contains(src, "like_count") || !strings.Contains(src, "authenticated") {
		t.Errorf("events_protect_like_count does not pin like_count for authenticated: %q", src)
	}
}
