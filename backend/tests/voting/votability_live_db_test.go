package voting_test

// Every contest is votable, and the two contest planes stay joined.
//
// Guards migrations 20270127000000 (default vote package ladder), 20270128000000
// (open contests are always votable) and 20270129000000 (connect → legacy
// mirror).
//
// The failure these prevent is silent: a contest opens, a contestant is approved
// onto the roster, and nobody can vote — either because there is no package to
// price the purchase from, or because the contest has no legacy row and
// therefore cannot hold a package at all.

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestLadder_PricesInNairaFromThePerVoteKoboPrice(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	contest := newContest(t, ctx, pool, contestOpts{paidVoteKobo: 10_000}) // NGN 100/vote

	rows, err := pool.Query(ctx,
		`SELECT votes, amount FROM public.vote_packages WHERE contest_id=$1 ORDER BY display_order`, contest)
	if err != nil {
		t.Fatalf("read packages: %v", err)
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var votes int
		var amount float64
		if err := rows.Scan(&votes, &amount); err != nil {
			t.Fatalf("scan: %v", err)
		}
		n++
		// NAIRA, not kobo: 10 votes at NGN 100 is 1000, not 100000. Getting this
		// wrong publishes every package at 100x its price, and nothing in the
		// column names says which unit is which.
		if got := amount / float64(votes); got != 100 {
			t.Errorf("package of %d votes priced %.2f — %.2f per vote, want 100", votes, amount, got)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate: %v", err)
	}
	if n != 3 {
		t.Errorf("seeded %d packages, want 3", n)
	}
}

// An unpriced contest has no rate to derive a ladder from, so it must get none
// rather than a ladder of zeroes.
func TestLadder_SeedsNothingForAnUnpricedContest(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	contest := newContest(t, ctx, pool, contestOpts{paidVoteKobo: 0, freeVotes: 1})

	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM public.vote_packages WHERE contest_id=$1`, contest).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Errorf("seeded %d packages for an unpriced contest, want 0", n)
	}
}

// Re-pricing must not resurrect tiers an admin deliberately retired.
func TestLadder_DoesNotResurrectRetiredPackages(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	contest := newContest(t, ctx, pool, contestOpts{paidVoteKobo: 10_000})

	if _, err := pool.Exec(ctx,
		`UPDATE public.vote_packages SET is_active=FALSE WHERE contest_id=$1`, contest); err != nil {
		t.Fatalf("retire: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE public.connect_contests SET paid_vote_kobo=50000 WHERE id=$1`, contest); err != nil {
		t.Fatalf("reprice: %v", err)
	}

	var total, active int
	if err := pool.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE is_active)
		  FROM public.vote_packages WHERE contest_id=$1`, contest).Scan(&total, &active); err != nil {
		t.Fatalf("count: %v", err)
	}
	if total != 3 {
		t.Errorf("packages = %d, want the original 3", total)
	}
	if active != 0 {
		t.Errorf("%d packages came back active after re-pricing; retired tiers must stay retired", active)
	}
}

func freeVotes(t *testing.T, ctx context.Context, pool *pgxpool.Pool, contest string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT free_votes_per_user FROM public.connect_contests WHERE id=$1`, contest).Scan(&n); err != nil {
		t.Fatalf("read free_votes_per_user: %v", err)
	}
	return n
}

// A draft is allowed to be half-configured — that is what draft means. Silently
// rewriting an admin's explicit 0 mid-setup would be a nasty surprise.
func TestVotability_LeavesAnUnconfiguredDraftAlone(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	contest := newContest(t, ctx, pool, contestOpts{status: "draft"})

	if got := freeVotes(t, ctx, pool, contest); got != 0 {
		t.Errorf("free_votes_per_user = %d on a draft, want 0 (untouched)", got)
	}
}

// What must never happen is a PUBLISHED contest nobody can vote in.
func TestVotability_GrantsTheHouseDefaultWhenAContestIsCreatedOpen(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	contest := newContest(t, ctx, pool, contestOpts{status: "open"})

	if got := freeVotes(t, ctx, pool, contest); got != 1 {
		t.Errorf("free_votes_per_user = %d, want the house default of 1", got)
	}
}

func TestVotability_GrantsItAtTheMomentADraftIsOpened(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	contest := newContest(t, ctx, pool, contestOpts{status: "draft"})

	if _, err := pool.Exec(ctx,
		`UPDATE public.connect_contests SET status='open' WHERE id=$1`, contest); err != nil {
		t.Fatalf("open the contest: %v", err)
	}
	if got := freeVotes(t, ctx, pool, contest); got != 1 {
		t.Errorf("free_votes_per_user = %d after opening, want 1", got)
	}
}

// A priced contest is votable through its price, so it must not also be handed
// free votes — that would give away what the organiser is selling.
func TestVotability_LeavesAPricedContestOnZeroFreeVotes(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	contest := newContest(t, ctx, pool, contestOpts{status: "open", paidVoteKobo: 10_000})

	if got := freeVotes(t, ctx, pool, contest); got != 0 {
		t.Errorf("free_votes_per_user = %d on a priced contest, want 0 — the price is the route", got)
	}
}

// An allowance the admin set explicitly is theirs, not the default's.
func TestVotability_NeverOverwritesAnExplicitAllowance(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	contest := newContest(t, ctx, pool, contestOpts{status: "open", freeVotes: 5})

	if got := freeVotes(t, ctx, pool, contest); got != 5 {
		t.Errorf("free_votes_per_user = %d, want the explicit 5", got)
	}
}

// vote_packages.contest_id FKs the legacy contests table, so before the mirror a
// connect-created paid contest could hold no package at all — invisible until
// somebody tried to buy a vote.
func TestMirror_CreatesTheLegacyRowSoTheContestCanHoldPackages(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	contest := newContest(t, ctx, pool, contestOpts{status: "open", paidVoteKobo: 10_000})

	var legacy int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM public.contests WHERE id=$1`, contest).Scan(&legacy); err != nil {
		t.Fatalf("read legacy contest: %v", err)
	}
	if legacy != 1 {
		t.Fatalf("legacy contests rows = %d, want 1 — a connect contest must get its twin", legacy)
	}

	var packages int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM public.vote_packages WHERE contest_id=$1`, contest).Scan(&packages); err != nil {
		t.Fatalf("read packages: %v", err)
	}
	if packages != 3 {
		t.Errorf("packages = %d, want 3 — the twin exists, so the ladder should seed", packages)
	}
}

// 10050 kobo is NGN 100.50, and the legacy vote_price_ngn is INTEGER naira.
// Without the restore, the round trip through the legacy plane reprices it.
func TestMirror_KeepsTheKoboPriceExact(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	contest := newContest(t, ctx, pool, contestOpts{status: "open", paidVoteKobo: 10_050})

	var kobo int
	if err := pool.QueryRow(ctx,
		`SELECT paid_vote_kobo FROM public.connect_contests WHERE id=$1`, contest).Scan(&kobo); err != nil {
		t.Fatalf("read: %v", err)
	}
	if kobo != 10_050 {
		t.Errorf("paid_vote_kobo = %d after the legacy round trip, want 10050", kobo)
	}
}

// contests.slug carries a UNIQUE INDEX. Copying a colliding slug raises 23505
// inside an AFTER trigger, which aborts creation of the connect contest itself.
//
// A collision is only reachable when a legacy row has NO connect twin —
// otherwise connect's own unique slug index rejects the second contest first.
// sync_connect_contest() skips names shorter than 2 characters, so a 1-character
// name is how you get a legacy row that was never mirrored.
func TestMirror_YieldsTheSlugRatherThanFailingWhenLegacyAlreadyHoldsIt(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()

	taken := fixtureSlugPrefix + "taken-" + uuid.NewString()[:8]
	orphan := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO public.contests (id, name, slug, status) VALUES ($1, 'X', $2, 'draft')`,
		orphan, taken); err != nil {
		t.Fatalf("seed orphan legacy contest: %v", err)
	}
	t.Cleanup(func() { deleteContestTree(context.Background(), pool, orphan) })

	// The real assertion is that this insert SUCCEEDS. Before the fix the mirror
	// copied the slug, hit the unique index, and took the whole write down.
	contest := newContest(t, ctx, pool, contestOpts{slug: taken})

	var mirrored *string
	if err := pool.QueryRow(ctx,
		`SELECT slug FROM public.contests WHERE id=$1`, contest).Scan(&mirrored); err != nil {
		t.Fatalf("read mirror: %v — the twin must still exist, so packages stay possible", err)
	}
	if mirrored != nil {
		t.Errorf("mirror slug = %q, want NULL — it must yield the contested slug", *mirrored)
	}

	var original string
	if err := pool.QueryRow(ctx,
		`SELECT slug FROM public.contests WHERE id=$1`, orphan).Scan(&original); err != nil {
		t.Fatalf("read orphan: %v", err)
	}
	if original != taken {
		t.Errorf("the original legacy row's slug became %q, want %q — it was there first", original, taken)
	}
}
