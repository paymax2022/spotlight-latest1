package connect_test

// ---------------------------------------------------------------------------
// My votes, and who voted for a contestant.
//
// WHY THIS EXISTS
// ---------------
// The My Votes screen called GET /voting/my-votes, which nothing served — it
// answered 404 with an HTML body, and with mock mode off the list could never
// render a row. The votes were in connect_votes the whole time.
//
// "Who voted for me" is new, and it hands out something the rest of this module
// deliberately never has. voting_settings publishes show_public_vote_count,
// show_public_leaderboard and show_public_rank — AGGREGATES — and has no flag
// for publishing identities. So the read is contestant-private, and the two
// properties worth pinning are both about who is allowed to see what:
//
//   • only the contestant themselves may read their supporters
//   • a free vote cast under allow_anonymous_free_vote is COUNTED but NEVER
//     NAMED, and the name is dropped in SQL rather than shipped to a client
//     that is trusted to hide it
//
// Live-DB: skipped without TEST_DATABASE_URL.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"

	connectvoting "spotlight/backend/internal/connect/voting"
)

func TestVotingSupporters_ContestantOnlyAndAnonymityHonoured(t *testing.T) {
	pool := blockLiveDBPool(t)
	// t.Cleanup, NOT defer. A deferred Close runs when the test function
	// returns, which is BEFORE any t.Cleanup — so every fixture DELETE below
	// would fire against a closed pool and silently no-op, leaking rows into a
	// shared database. Cleanups run LIFO, so registering the close FIRST makes
	// it run LAST, after the fixtures are gone.
	t.Cleanup(pool.Close)
	ctx := context.Background()
	repo := connectvoting.NewRepository(pool)
	svc := connectvoting.NewService(repo, nil, nil, nil, nil)

	owner := uuid.NewString()
	voter := uuid.NewString()
	stranger := uuid.NewString()
	for _, u := range []string{owner, voter, stranger} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			u, u+"@votes.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}

	contestID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO connect_contests (id, title, status) VALUES ($1,$2,'open')`,
		contestID, "Supporters fixture "+contestID[:8]); err != nil {
		t.Fatalf("seed contest: %v", err)
	}

	var contestantID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO contestants (name, connect_contest_id, user_id, is_active)
		VALUES ($1,$2,$3,true) RETURNING id::text`,
		"Fixture Contestant", contestID, owner).Scan(&contestantID); err != nil {
		t.Fatalf("seed contestant: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO connect_votes (contest_id, voter_id, option_ref, paid, quantity, amount_kobo)
		VALUES ($1,$2,$3,false,1,0)`, contestID, voter, contestantID); err != nil {
		t.Fatalf("seed vote: %v", err)
	}

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM connect_votes WHERE contest_id=$1`, contestID)
		_, _ = pool.Exec(ctx, `DELETE FROM voting_settings WHERE contest_id=$1`, contestID)
		_, _ = pool.Exec(ctx, `DELETE FROM contestants WHERE id=$1`, contestantID)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_contests WHERE id=$1`, contestID)
		for _, u := range []string{owner, voter, stranger} {
			_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1`, u)
		}
	})

	// The contestant sees their supporter, by name.
	list, err := svc.Supporters(ctx, owner, contestantID)
	if err != nil {
		t.Fatalf("owner read: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("supporters = %d, want 1", len(list))
	}
	if list[0].Anonymous || list[0].VoterName == "" {
		t.Errorf("with anonymity off the voter must be named, got %+v", list[0])
	}

	// Nobody else does — not the voter, not a stranger.
	for name, caller := range map[string]string{"the voter": voter, "a stranger": stranger, "nobody": ""} {
		if _, err := svc.Supporters(ctx, caller, contestantID); err == nil {
			t.Errorf("%s must not be able to read another contestant's supporters", name)
		}
	}

	// Turn anonymity on: the vote still counts, but the name must be gone
	// BEFORE it leaves the database.
	// A voting_settings row is created with the contest, so this is an upsert:
	// a plain INSERT hits voting_settings_contest_id_key.
	if _, err := pool.Exec(ctx, `
		INSERT INTO voting_settings (contest_id, allow_anonymous_free_vote) VALUES ($1,true)
		ON CONFLICT (contest_id) DO UPDATE SET allow_anonymous_free_vote = true`,
		contestID); err != nil {
		t.Fatalf("enable anonymity: %v", err)
	}
	list, err = svc.Supporters(ctx, owner, contestantID)
	if err != nil {
		t.Fatalf("owner read with anonymity: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("supporters = %d, want 1 — an anonymous vote still counts", len(list))
	}
	if !list[0].Anonymous {
		t.Error("the vote must be flagged anonymous")
	}
	if list[0].VoterName != "" {
		t.Errorf("voterName = %q, want empty — an anonymous voter must never be named", list[0].VoterName)
	}
	if list[0].Quantity != 1 {
		t.Errorf("quantity = %d, want 1 — anonymity hides the name, not the vote", list[0].Quantity)
	}
}

func TestVotingMyVotes_ReturnsOnlyTheCallersOwnVotes(t *testing.T) {
	pool := blockLiveDBPool(t)
	// t.Cleanup, NOT defer. A deferred Close runs when the test function
	// returns, which is BEFORE any t.Cleanup — so every fixture DELETE below
	// would fire against a closed pool and silently no-op, leaking rows into a
	// shared database. Cleanups run LIFO, so registering the close FIRST makes
	// it run LAST, after the fixtures are gone.
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := connectvoting.NewService(connectvoting.NewRepository(pool), nil, nil, nil, nil)

	mine := uuid.NewString()
	theirs := uuid.NewString()
	for _, u := range []string{mine, theirs} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			u, u+"@myvotes.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	contestID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO connect_contests (id, title, status) VALUES ($1,$2,'open')`,
		contestID, "MyVotes fixture "+contestID[:8]); err != nil {
		t.Fatalf("seed contest: %v", err)
	}
	var contestantID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO contestants (name, connect_contest_id, is_active) VALUES ($1,$2,true) RETURNING id::text`,
		"MyVotes Contestant", contestID).Scan(&contestantID); err != nil {
		t.Fatalf("seed contestant: %v", err)
	}
	// One free vote from me, one paid vote from somebody else.
	if _, err := pool.Exec(ctx, `
		INSERT INTO connect_votes (contest_id, voter_id, option_ref, paid, quantity, amount_kobo)
		VALUES ($1,$2,$3,false,1,0), ($1,$4,$3,true,5,50000)`,
		contestID, mine, contestantID, theirs); err != nil {
		t.Fatalf("seed votes: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM connect_votes WHERE contest_id=$1`, contestID)
		_, _ = pool.Exec(ctx, `DELETE FROM contestants WHERE id=$1`, contestantID)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_contests WHERE id=$1`, contestID)
		for _, u := range []string{mine, theirs} {
			_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1`, u)
		}
	})

	got, err := svc.MyVotes(ctx, mine, contestID, false, false)
	if err != nil {
		t.Fatalf("MyVotes: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("votes = %d, want 1 — the list must hold the caller's own votes only", len(got))
	}
	if got[0].Paid {
		t.Error("returned somebody else's paid vote")
	}
	// The contestant and contest names come from a join, not the vote row.
	if got[0].ContestantName != "MyVotes Contestant" {
		t.Errorf("contestantName = %q, want the joined contestant name", got[0].ContestantName)
	}
	if got[0].ContestTitle == "" {
		t.Error("contestTitle is empty — the contest join did not resolve")
	}

	// The PAID filter excludes my only (free) vote.
	paid, err := svc.MyVotes(ctx, mine, contestID, true, false)
	if err != nil {
		t.Fatalf("MyVotes paid: %v", err)
	}
	if len(paid) != 0 {
		t.Errorf("paid-only = %d, want 0", len(paid))
	}
}
