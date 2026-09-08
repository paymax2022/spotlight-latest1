package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB test: campaigns.contributor_count stays equal to the number of
// DISTINCT non-refunded contributors.
//
// WHY THIS EXISTS
// ---------------
// The column was read in at least six places — the public campaign payload, the
// "trending" and featured sort orders (ORDER BY c.contributor_count DESC), the
// featured console, the feature-request queue and the CSR listing — and written
// by nothing at all. No Go path, no RPC, no trigger. It therefore held its
// default forever, and production data showed the result: a campaign with two
// backers and ₦1,050 raised reported 0 backers to every one of those surfaces,
// and every "sort by popularity" collapsed because all the values were equal.
//
// Migration 20270184000000 gives the column an owner (a recount trigger) and
// backfills. This test pins the behaviour that migration promises, because the
// failure mode is silent: nothing errors when a counter drifts, the number is
// just quietly wrong on a public page.
//
// The cases are the ones an increment-based implementation gets wrong, which is
// why the trigger recounts instead:
//   - the same person contributing twice must still be ONE backer
//   - an escrowed contribution counts (the money is committed)
//   - a refund stops counting, and reversing the refund counts again
//   - moving a contribution between campaigns must fix BOTH campaigns
//   - deleting the rows returns the count to zero
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL, which the root .env
// points at the production pooler and this test INSERTs (see
// scripts/ci/check-live-db-gate.sh).
//
// Bring-up:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_ContributorCount -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func contributorCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, campaignID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(contributor_count, 0) FROM campaigns WHERE id = $1`, campaignID).Scan(&n); err != nil {
		t.Fatalf("read contributor_count: %v", err)
	}
	return n
}

func TestLiveDB_ContributorCountTracksDistinctNonRefundedBackers(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)

	campaignA, _, trackUser := seedCampaign(t, ctx, pool)
	campaignB, _, _ := seedCampaign(t, ctx, pool)

	user1 := uuid.NewString()
	user2 := uuid.NewString()
	trackUser(user1)
	trackUser(user2)
	for _, u := range []string{user1, user2} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')
			ON CONFLICT (id) DO NOTHING`, u, "cf-count-"+u+"@test.local"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}

	insert := func(id, campaign, user, status string, amount int64) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO contributions (id, campaign_id, contributor_id, amount_kobo, status, idempotency_key)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			id, campaign, user, amount, status, "cf-count-"+id); err != nil {
			t.Fatalf("insert contribution: %v", err)
		}
	}
	exec := func(what, sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", what, err)
		}
	}
	want := func(step string, campaign string, expected int) {
		t.Helper()
		if got := contributorCount(t, ctx, pool, campaign); got != expected {
			t.Errorf("%s: contributor_count = %d, want %d", step, got, expected)
		}
	}

	k1, k2, k3 := uuid.NewString(), uuid.NewString(), uuid.NewString()

	want("before any contribution", campaignA, 0)

	insert(k1, campaignA, user1, "released", 50000)
	want("after the first contribution", campaignA, 1)

	// The case an increment gets wrong.
	insert(k2, campaignA, user1, "released", 70000)
	want("same contributor gives again", campaignA, 1)

	insert(k3, campaignA, user2, "escrowed", 30000)
	want("a second contributor, still escrowed", campaignA, 2)

	exec("refund", `UPDATE contributions SET status='refunded' WHERE id=$1`, k3)
	want("after that contribution is refunded", campaignA, 1)

	exec("un-refund", `UPDATE contributions SET status='released' WHERE id=$1`, k3)
	want("after the refund is reversed", campaignA, 2)

	// Both sides must be recounted, which is why the trigger looks at OLD and NEW.
	exec("move campaign", `UPDATE contributions SET campaign_id=$1 WHERE id=$2`, campaignB, k3)
	want("source after the contribution moves away", campaignA, 1)
	want("destination after the contribution moves in", campaignB, 1)

	exec("delete", `DELETE FROM contributions WHERE id = ANY($1)`, []string{k1, k2})
	want("after both remaining rows are deleted", campaignA, 0)
}

// TestLiveDB_ContributorCountHasNoDrift is the invariant over whatever is
// already in the database, not just rows this test created. It is the check that
// would have caught the original bug, which existed for the life of the column
// and was found by eye in an admin console rather than by anything automated.
func TestLiveDB_ContributorCountHasNoDrift(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)

	rows, err := pool.Query(ctx, `
		SELECT c.id::text, c.title, COALESCE(c.contributor_count,0),
		       (SELECT COUNT(DISTINCT k.contributor_id)
		          FROM contributions k
		         WHERE k.campaign_id = c.id
		           AND k.status IN ('escrowed','released'))
		  FROM campaigns c
		 WHERE c.deleted_at IS NULL`)
	if err != nil {
		t.Fatalf("query campaigns: %v", err)
	}
	defer rows.Close()

	drifted := 0
	for rows.Next() {
		var id, title string
		var stored, actual int
		if err := rows.Scan(&id, &title, &stored, &actual); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if stored != actual {
			drifted++
			t.Errorf("campaign %s (%q): contributor_count = %d, actual distinct backers = %d",
				id, title, stored, actual)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	if drifted > 0 {
		t.Logf("%d campaign(s) drifted — the public page and every popularity sort read this column", drifted)
	}
}
