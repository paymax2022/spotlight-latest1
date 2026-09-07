package voting_test

// ---------------------------------------------------------------------------
// Shared fixtures for the voting projection live-DB suites.
//
// WHY THIS PACKAGE EXISTS. These tests began life as TypeScript integration
// specs under frontend-web/tests/integration, written with supabase-js. They
// were wired into no workflow and so ran only by hand — and they could not
// simply be added to integration-verify.yml either, because that job provides a
// migrated BARE Postgres with no PostgREST and no GoTrue. supabase-js speaks
// HTTP, so the specs would have found no SUPABASE_URL, skipped silently, and
// produced a green check that guarded nothing.
//
// Everything they assert is DATABASE behaviour — triggers, a partial unique
// index and one RPC — so it belongs next to the schema it guards, in a suite the
// Postgres service already runs.
//
// WHERE THIS ACTUALLY RUNS. integration-verify.yml — the only lane that stands
// up Postgres and sets TEST_DATABASE_URL — and it triggers on pull_request and
// on push to main. Every module lane called by ci.yml (including the repo-wide
// `go test ./...` that fx-ci runs on any backend change) executes this package
// with no DSN, so on a direct push to develop these SKIP. That is the standing
// arrangement for every *_live_db_test.go in the repo, not something special
// here; closing it means giving a develop-triggered lane a Postgres service.
// The canary step in integration-verify names four tests from this package, so
// a future env change cannot quietly return them to skipping where they do run.
//
// Rule for anything added later: seed through a helper that registers its own
// teardown, and never write `defer pool.Close()` — a deferred close fires when
// the function returns, which is BEFORE any t.Cleanup, so every delete would run
// against a closed pool and fail silently. That exact mistake left fixture
// categories rendering as real tiles in the marketplace for weeks.
// ---------------------------------------------------------------------------

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Fixture markers. Every row this package creates carries one, so a killed run
// can be swept by the next.
const (
	fixtureSlugPrefix = "zzgo-voting-"
	fixtureRegSlug    = "zzgo-one-per-contest"
	fixtureTitle      = "ZZ Go Voting Fixture"
)

// votingPool returns a pool for the live-DB suites, or skips.
//
// Gated on TEST_DATABASE_URL only, never falling back to DATABASE_URL: the root
// .env points DATABASE_URL at the production Supabase pooler and these tests
// INSERT fixtures. Enforced repo-wide by scripts/ci/check-live-db-gate.sh.
func votingPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	// Registered FIRST so it runs LAST: cleanups are last-in-first-out, and every
	// fixture teardown below still needs an open pool.
	t.Cleanup(pool.Close)
	return pool
}

// fixtureRef builds a reference that satisfies registrations' reference_format
// CHECK (^[A-Z0-9]+-[0-9]+-[A-Z0-9]+$) — the middle segment must be digits only.
func fixtureRef(suffix string) string {
	return fmt.Sprintf("ZZGO-%d-%s%s", time.Now().UnixNano(),
		strings.ToUpper(suffix), strings.ToUpper(uuid.NewString()[:6]))
}

// contestOpts is the subset of connect_contests these tests vary.
type contestOpts struct {
	status       string // draft | open | closed; default draft
	paidVoteKobo int
	freeVotes    int
	slug         string // default: a unique fixture slug
}

// newContest seeds a connect_contests row.
//
// It deliberately does NOT create the legacy public.contests twin or the vote
// package ladder — both are trigger output, and arranging them here would hide
// the very behaviour these tests exist to check.
func newContest(t *testing.T, ctx context.Context, pool *pgxpool.Pool, o contestOpts) string {
	t.Helper()
	if o.status == "" {
		o.status = "draft"
	}
	if o.slug == "" {
		o.slug = fixtureSlugPrefix + uuid.NewString()[:8]
	}
	id := uuid.NewString()

	if _, err := pool.Exec(ctx, `
		INSERT INTO public.connect_contests (id, title, slug, status, paid_vote_kobo, free_votes_per_user)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		id, fixtureTitle, o.slug, o.status, o.paidVoteKobo, o.freeVotes); err != nil {
		t.Fatalf("seed contest: %v", err)
	}

	t.Cleanup(func() { deleteContestTree(context.Background(), pool, id) })
	return id
}

// deleteContestTree removes a fixture contest and everything that references it,
// in FK order. vote_transactions.contest_id points at the LEGACY contests row,
// so it has to go before that row does.
//
// Errors are ignored on purpose: teardown may run after a test has already
// failed, and a cascade of secondary errors would bury the real failure. The
// start-of-run sweep in TestMain is the backstop.
func deleteContestTree(ctx context.Context, pool *pgxpool.Pool, contestID string) {
	for _, q := range []string{
		`DELETE FROM public.bridge_outbox      WHERE payload->>'contestId' = $1`,
		`DELETE FROM public.connect_votes      WHERE contest_id = $1`,
		`DELETE FROM public.vote_transactions  WHERE contest_id = $1`,
		`DELETE FROM public.vote_packages      WHERE contest_id = $1`,
		`DELETE FROM public.voting_settings    WHERE contest_id = $1`,
		`DELETE FROM public.contestants        WHERE connect_contest_id = $1`,
		`DELETE FROM public.connect_contests   WHERE id = $1`,
		`DELETE FROM public.contests           WHERE id = $1`,
	} {
		_, _ = pool.Exec(ctx, q, contestID)
	}
}

// newContestant puts an approved, active contestant on a contest's roster.
//
// connect_contest_id is what ListRoster filters on, so a contestant carrying
// only the legacy contest_id is invisible there — and the tally trigger refuses
// to project onto one, deliberately. Pass an empty contestID for the "stranger"
// case: a contestant on no contest at all.
func newContestant(t *testing.T, ctx context.Context, pool *pgxpool.Pool, connectContestID string) string {
	t.Helper()
	var contest any
	if connectContestID != "" {
		contest = connectContestID
	}
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO public.contestants (name, connect_contest_id, status, is_active)
		VALUES ($1, $2, 'approved', TRUE)
		RETURNING id::text`, fixtureTitle, contest).Scan(&id)
	if err != nil {
		t.Fatalf("seed contestant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.contestants WHERE id=$1`, id)
	})
	return id
}

// anyVoter returns an existing auth.users id.
//
// It borrows one rather than seeding. auth.users is GoTrue's table and carries
// three ON INSERT triggers here (profile creation and two RBAC bridges), so a
// seeded fixture user would spray rows across tables this package has no
// business owning — and a leaked one is a login that should not exist. Nothing
// here mutates the borrowed row.
//
// CI has rows to borrow: three migrations seed admin accounts, and the
// supabase-compat prelude gives the shim table the columns they need. So this
// FAILS rather than skipping — with the DSN set and the schema migrated, an
// empty auth.users is a broken environment, and skipping would hand back the
// silent green this whole package was written to remove.
func anyVoter(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(ctx, `SELECT id::text FROM auth.users ORDER BY created_at LIMIT 1`).Scan(&id)
	if err != nil {
		t.Fatalf("no auth.users row to attach the fixture to: %v", err)
	}
	return id
}

// TestMain sweeps fixtures left by an EARLIER run before this one starts.
// Sweeping at the start rather than the end is deliberate: at the end it would
// race a concurrently running package that had seeded its own rows.
func TestMain(m *testing.M) {
	if dsn := os.Getenv("TEST_DATABASE_URL"); dsn != "" {
		ctx := context.Background()
		if pool, err := pgxpool.New(ctx, dsn); err == nil {
			sweepContests(ctx, pool)
			sweepRegistrations(ctx, pool)
			pool.Close()
		}
	}
	os.Exit(m.Run())
}

func sweepContests(ctx context.Context, pool *pgxpool.Pool) {
	// Both planes: the mirror trigger means one fixture becomes two rows, and a
	// mirrored row whose slug collided was written with slug = NULL — so a
	// slug-only sweep leaves it behind. Match the fixture title too.
	rows, err := pool.Query(ctx, `
		SELECT id::text FROM public.connect_contests WHERE slug LIKE $1
		UNION
		SELECT id::text FROM public.contests         WHERE slug LIKE $1 OR name = $2`,
		fixtureSlugPrefix+"%", fixtureTitle)
	if err != nil {
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		deleteContestTree(ctx, pool, id)
	}
}

func sweepRegistrations(ctx context.Context, pool *pgxpool.Pool) {
	const regs = `SELECT id FROM public.registrations WHERE contest_slug = $1`
	for _, q := range []string{
		`DELETE FROM public.registration_status_events WHERE registration_id IN (` + regs + `)`,
		`DELETE FROM public.contestants                WHERE registration_id IN (` + regs + `)`,
		`DELETE FROM public.registrations              WHERE contest_slug = $1`,
	} {
		_, _ = pool.Exec(ctx, q, fixtureRegSlug)
	}
}
