package connectvoting

// LIVE-DB regression: the locality plane (state -> LGA -> village) must exist,
// be seeded with what a human actually supplied, and reach both the voting
// mirror and the promoted contestant row.
//
// Before 20272000000000 the repo had no village data anywhere: the registration
// wizards' second geography select was labelled "City / town" but its options
// were the 774 LGAs, and `contestants` stored only `state`. A contest that
// should be "local to Onitsha" could therefore say nothing about locality and
// nothing could be filtered by it.
//
// Two contracts these tests exist to keep honest:
//
//  1. SEED = SUPPLIED. The 15 quarters named for Onitsha are seeded under the
//     LGA they belong to (Onitsha North). Every other LGA stays EMPTY, because an
//     invented village name on a locality the platform treats as real is worse
//     than no village. Onitsha South having zero rows is therefore a asserted
//     property, not an accident.
//  2. THE MIRROR CARRIES IT. Mobile reads public.connect_contests through Go, so
//     a locality that only lands on public.contests is invisible on the phone —
//     the exact failure rules_text had before 20270109000000.
//
// GATED ON TEST_DATABASE_URL only (see railTestPool):
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/voting/ -run TestLiveDB_Locality -v

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	localityState     = "Anambra"
	localityLGA       = "Onitsha North"
	localityVillage15 = "Ogbeozala"
)

// onitshaQuarters is the list exactly as supplied for Onitsha.
var onitshaQuarters = []string{
	"Isiokwe", "Mgbelekeke", "Obikporo", "Ogbeabo", "Ogbendida", "Ogbeodogwu",
	"Ogbeotu", "Ogboli", "Omagba", "Owelle Ebo", "Umuaroli", "Umuasele",
	"Umudei", "Umuikem", "Ogbeozala",
}

func hasColumn(t *testing.T, pool *pgxpool.Pool, table, column string) bool {
	t.Helper()
	var n int
	err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
		table, column).Scan(&n)
	if err != nil {
		t.Fatalf("column lookup %s.%s: %v", table, column, err)
	}
	return n > 0
}

// The reference table, its key, and the seeded 15.
func TestLiveDB_LocalityVillagesSeeded(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()

	for _, table := range []string{"villages"} {
		var n int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = $1`, table).Scan(&n); err != nil {
			t.Fatalf("table lookup %s: %v", table, err)
		}
		if n != 1 {
			t.Fatalf("public.%s does not exist — the locality migration has not been applied", table)
		}
	}

	// Every supplied quarter is selectable under its LGA, by exact name.
	for _, name := range onitshaQuarters {
		var found bool
		err := pool.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM public.villages
				WHERE state = $1 AND lga = $2 AND name = $3 AND is_active)`,
			localityState, localityLGA, name).Scan(&found)
		if err != nil {
			t.Fatalf("village %q lookup: %v", name, err)
		}
		if !found {
			t.Errorf("village %q is missing under %s / %s", name, localityState, localityLGA)
		}
	}

	// The seed is the supplied list and nothing else: no fabricated extra
	// quarter, no duplicate of one that was named once.
	var total, distinct int
	if err := pool.QueryRow(ctx, `
		SELECT count(*), count(DISTINCT name) FROM public.villages
		WHERE state = $1 AND lga = $2`, localityState, localityLGA).Scan(&total, &distinct); err != nil {
		t.Fatalf("village count: %v", err)
	}
	if total != len(onitshaQuarters) || distinct != len(onitshaQuarters) {
		t.Errorf("%s/%s has %d village rows (%d distinct), want exactly %d — the seed must be the supplied list, neither padded nor duplicated",
			localityState, localityLGA, total, distinct, len(onitshaQuarters))
	}

	// An LGA nobody has curated stays empty. This is what makes the wizards fall
	// back to a typed village instead of offering a made-up one.
	var neighbours int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM public.villages WHERE state = $1 AND lga = 'Onitsha South'`,
		localityState).Scan(&neighbours); err != nil {
		t.Fatalf("Onitsha South count: %v", err)
	}
	if neighbours != 0 {
		t.Errorf("Onitsha South carries %d seeded villages; only the LGA that was actually named may have rows", neighbours)
	}

	// Uniqueness is per (state, lga, name): two LGAs may each hold a quarter of
	// the same name, one LGA may not hold it twice.
	var hasKey bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM pg_constraint c
			JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
			JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
			WHERE c.conrelid = 'public.villages'::regclass AND c.contype = 'u'
			GROUP BY c.conname
			HAVING string_agg(a.attname, ',' ORDER BY k.ord) = 'state,lga,name'
		)`,
	).Scan(&hasKey); err != nil {
		t.Fatalf("unique key lookup: %v", err)
	}
	if !hasKey {
		t.Errorf("villages has no unique constraint over (state, lga, name) — without it a double add silently grows the picker and two LGAs cannot share a quarter name")
	}

	dup := uuid.NewString()
	_, err := pool.Exec(ctx, `INSERT INTO public.villages (id, state, lga, name) VALUES ($1, $2, $3, $4)`,
		dup, localityState, localityLGA, localityVillage15)
	if err == nil {
		_, _ = pool.Exec(ctx, `DELETE FROM public.villages WHERE id = $1`, dup)
		t.Errorf("a second %q row under %s/%s was accepted: the curated list has no key, so an admin double-add silently grows the picker",
			localityVillage15, localityState, localityLGA)
	} else {
		_, _ = pool.Exec(ctx, `DELETE FROM public.villages WHERE id = $1`, dup)
	}
}

// The columns exist on BOTH planes, because mobile reads the mirror, not the
// console's row.
func TestLiveDB_LocalityColumnsOnBothPlanes(t *testing.T) {
	pool := railTestPool(t)
	for _, c := range []struct{ table, column string }{
		{"contests", "locality_state"},
		{"contests", "locality_lga"},
		{"contests", "locality_village"},
		{"connect_contests", "locality_state"},
		{"connect_contests", "locality_lga"},
		{"connect_contests", "locality_village"},
		{"contestants", "lga"},
		{"contestants", "village"},
	} {
		if !hasColumn(t, pool, c.table, c.column) {
			t.Errorf("public.%s.%s is missing — locality cannot be stored or served", c.table, c.column)
		}
	}
}

// Saving a local contest in the console must reach connect_contests. The mirror
// trigger owns that, and a trigger that forgot a column is silent: the console
// shows the value and the phone shows nothing.
func TestLiveDB_LocalityMirrorsToConnectContests(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()
	id := uuid.NewString()
	slug := "locality-mirror-" + id[:8]
	defer func() {
		_, _ = pool.Exec(ctx, `DELETE FROM public.connect_contests WHERE id = $1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM public.contests WHERE id = $1`, id)
	}()

	// A contest is created without a locality first: an admin can save a national
	// contest, and the mirror must not invent one.
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.contests (id, name, slug, status, category)
		VALUES ($1, $2, $3, 'active', 'Music')`, id, "Locality mirror "+slug, slug); err != nil {
		t.Fatalf("insert contest: %v", err)
	}
	var state, lga, village string
	if err := pool.QueryRow(ctx,
		`SELECT locality_state, locality_lga, locality_village FROM public.connect_contests WHERE id = $1`,
		id).Scan(&state, &lga, &village); err != nil {
		t.Fatalf("mirror read after create: %v", err)
	}
	if state != "" || lga != "" || village != "" {
		t.Errorf("a contest with no locality mirrored %q/%q/%q; empty must stay empty", state, lga, village)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE public.contests
		SET locality_state = $2, locality_lga = $3, locality_village = $4
		WHERE id = $1`, id, localityState, localityLGA, localityVillage15); err != nil {
		t.Fatalf("set locality: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT locality_state, locality_lga, locality_village FROM public.connect_contests WHERE id = $1`,
		id).Scan(&state, &lga, &village); err != nil {
		t.Fatalf("mirror read after update: %v", err)
	}
	if state != localityState || lga != localityLGA || village != localityVillage15 {
		t.Errorf("connect_contests mirrored %q/%q/%q, want %q/%q/%q — mobile reads this row, so a miss means the phone never learns the contest is local",
			state, lga, village, localityState, localityLGA, localityVillage15)
	}

	// Clearing the locality must mirror as cleared too: an admin who switches a
	// contest back to national must not leave a stale village on the phone.
	if _, err := pool.Exec(ctx, `
		UPDATE public.contests
		SET locality_state = '', locality_lga = '', locality_village = ''
		WHERE id = $1`, id); err != nil {
		t.Fatalf("clear locality: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT locality_state, locality_lga, locality_village FROM public.connect_contests WHERE id = $1`,
		id).Scan(&state, &lga, &village); err != nil {
		t.Fatalf("mirror read after clear: %v", err)
	}
	if state != "" || lga != "" || village != "" {
		t.Errorf("after clearing, the mirror still holds %q/%q/%q", state, lga, village)
	}
}

// The wizard's answers must land on the contestant row the roster serves, which
// is what promote_registration_to_contestant owns.
func TestLiveDB_LocalitySurvivesPromotion(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()
	registrationID := uuid.NewString()
	contestID := uuid.NewString()
	slug := "locality-promo-" + contestID[:8]
	defer func() {
		_, _ = pool.Exec(ctx, `DELETE FROM public.contestants WHERE registration_id = $1`, registrationID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.registrations WHERE id = $1`, registrationID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.connect_contests WHERE id = $1`, contestID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.contests WHERE id = $1`, contestID)
	}()

	if _, err := pool.Exec(ctx, `
		INSERT INTO public.contests (id, name, slug, status, category)
		VALUES ($1, $2, $3, 'active', 'Music')`, contestID, "Locality promo "+slug, slug); err != nil {
		t.Fatalf("insert contest: %v", err)
	}

	// The exact keys the registration wizard writes.
	formData := `{"personal.firstName":"Ada","personal.lastName":"Nwosu",` +
		`"personal.stateOfOrigin":"Anambra",` +
		`"personal.localGovernment":"Onitsha North",` +
		`"personal.village":"Ogbendida"}`
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.registrations (id, contest_slug, reference, status, form_data)
		VALUES ($1, $2, $3, 'approved', $4::jsonb)`,
		// registrations.reference_format = '^[A-Z0-9]+-[0-9]+-[A-Z0-9]+$'
		registrationID, slug, "LOC-2027200001-ABC", formData); err != nil {
		t.Fatalf("insert registration: %v", err)
	}

	var contestantID string
	if err := pool.QueryRow(ctx,
		`SELECT public.promote_registration_to_contestant($1::uuid)`, registrationID).Scan(&contestantID); err != nil {
		t.Fatalf("promote: %v", err)
	}

	var state, lga, village string
	if err := pool.QueryRow(ctx,
		`SELECT state, lga, village FROM public.contestants WHERE id = $1`, contestantID).
		Scan(&state, &lga, &village); err != nil {
		t.Fatalf("read promoted contestant: %v", err)
	}
	if lga != localityLGA || village != "Ogbendida" {
		t.Errorf("promoted contestant carries lga=%q village=%q, want %q / %q — the roster can only show and filter what promotion stored",
			lga, village, localityLGA, "Ogbendida")
	}
	if state != localityState {
		t.Errorf("promoted contestant state=%q, want %q (state of origin feeds the locality cascade)", state, localityState)
	}
}

// The file must be safe to replay: db push re-runs the chain, and a release that
// duplicates a curated village list would corrupt every picker that reads it.
func TestLiveDB_LocalityMigrationIsIdempotent(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping locality migration replay test")
	}
	sql, err := os.ReadFile(filepath.Clean(filepath.Join("..", "..", "..", "..", "supabase", "migrations",
		"20272000000000_locality_villages.sql")))
	if err != nil {
		t.Fatalf("read locality migration: %v", err)
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
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM public.villages WHERE state = $1 AND lga = $2`,
		localityState, localityLGA).Scan(&n); err != nil {
		t.Fatalf("count after replay: %v", err)
	}
	if n != len(onitshaQuarters) {
		t.Errorf("replaying the migration twice left %d Onitsha North villages, want %d", n, len(onitshaQuarters))
	}
}
