package connectvoting

// LIVE-DB test for the Open Mic song the connect roster hands to mobile.
//
// Why live: the join crosses three planes that only exist together in a real
// database — public.contests (where competition_entries.competition_id points),
// public.connect_contests (what contestants.connect_contest_id points at) and
// the mirror trigger that makes them the SAME id. A mock would happily accept a
// query keyed on the wrong one, and the symptom in the app is silent: the
// profile shows no player. Status and object-key filtering are here too,
// because a roster that advertises a draft is a security problem, not a
// rendering one — the web reader refuses those bytes.
//
// GATED ON TEST_DATABASE_URL only (see railTestPool):
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/voting/ -run TestLiveDB_RosterSong -v

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// seedRosterContestant promotes a contestant onto a connect contest's roster the
// way the registration seam does: connect_contest_id plus the artist's user_id,
// which is exactly the pair the song join needs.
func seedRosterContestant(t *testing.T, pool *pgxpool.Pool, contestID, userID, name string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO public.contestants (id, name, connect_contest_id, user_id, status, is_active)
		VALUES ($1::uuid, $2, $3::uuid, NULLIF($4,'')::uuid, 'approved', true)`,
		id, name, contestID, userID); err != nil {
		t.Fatalf("seed contestant %s: %v", name, err)
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(context.Background())
		_, _ = pool.Exec(ctx, `DELETE FROM public.contestants WHERE id = $1::uuid`, id)
	})
	return id
}

// seedSongEntry files one Open Mic submission for the artist. summary is the
// JSON the web writer stores in lyrical_concept_summary — pass "" to simulate a
// row whose status is playable but that has no song object behind it.
func seedSongEntry(t *testing.T, pool *pgxpool.Pool, contestID, userID, status, summary string, age time.Duration) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO public.competition_entries
			(id, competition_id, user_id, entry_title, lyrical_concept_summary, status, created_at)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7)`,
		id, contestID, userID, "ZZ song "+status, summary, status, time.Now().Add(-age)); err != nil {
		t.Fatalf("seed entry (%s): %v", status, err)
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(context.Background())
		_, _ = pool.Exec(ctx, `DELETE FROM public.competition_entries WHERE id = $1::uuid`, id)
	})
	return id
}

func songSummary(submissionID string) string {
	return fmt.Sprintf(`{"songObjectKey":"openmic/zz-test/artist/%s.mp3","songFileName":"demo.mp3"}`, submissionID)
}

func TestLiveDB_RosterSong(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	svc := NewService(repo, nil, nil, nil, nil)
	svc.SetMediaBaseURL("https://web.test")

	// railTestContest writes connect_contests; the AFTER INSERT mirror trigger
	// creates the public.contests twin with the same id. The entries below
	// reference that twin, so this fixture proves the id-equality the join
	// depends on rather than assuming it.
	contestID := railTestContest(t, pool, 0)
	otherContestID := railTestContest(t, pool, 0)

	artist := railTestVoter(t, pool)

	t.Run("a submitted song with bytes is surfaced with an absolute reader url", func(t *testing.T) {
		contestantID := seedRosterContestant(t, pool, contestID, artist, "ZZ artist")
		entryID := seedSongEntry(t, pool, contestID, artist, "submitted", songSummary(uuid.NewString()), time.Hour)

		list, err := svc.ListRoster(ctx, contestID, false, "")
		if err != nil {
			t.Fatalf("ListRoster: %v", err)
		}
		if len(list) != 1 {
			t.Fatalf("roster length = %d, want 1 (fixture leaked onto this contest?)", len(list))
		}
		got := list[0]
		if got.ContestantID != contestantID {
			t.Errorf("contestant id = %q, want %q", got.ContestantID, contestantID)
		}
		if got.SongSubmissionID != entryID {
			t.Errorf("SongSubmissionID = %q, want %q", got.SongSubmissionID, entryID)
		}
		if got.SongStatus != "submitted" {
			t.Errorf("SongStatus = %q, want submitted", got.SongStatus)
		}
		if want := "https://web.test/api/open-mic/songs/" + entryID; got.SongURL != want {
			t.Errorf("SongURL = %q, want %q", got.SongURL, want)
		}

		// The profile screen must agree with the list screen: both read the same
		// shared join, so a song visible in one is visible in the other.
		one, err := svc.GetContestant(ctx, contestantID, "")
		if err != nil {
			t.Fatalf("GetContestant: %v", err)
		}
		if one.SongSubmissionID != got.SongSubmissionID || one.SongURL != got.SongURL {
			t.Errorf("profile disagrees with roster: %q/%q vs %q/%q",
				one.SongSubmissionID, one.SongURL, got.SongSubmissionID, got.SongURL)
		}
	})

	t.Run("a draft is not surfaced", func(t *testing.T) {
		// A fresh contest, so this rule is isolated from the submitted row the
		// first subtest filed for the same-shaped artist.
		draftContest := railTestContest(t, pool, 0)
		draftArtist := railTestVoter(t, pool)
		seedRosterContestant(t, pool, draftContest, draftArtist, "ZZ draft only")
		seedSongEntry(t, pool, draftContest, draftArtist, "draft", songSummary(uuid.NewString()), time.Hour)

		list, err := svc.ListRoster(ctx, draftContest, false, "")
		if err != nil {
			t.Fatalf("ListRoster(draft contest): %v", err)
		}
		if len(list) != 1 {
			t.Fatalf("roster length = %d, want 1", len(list))
		}
		if list[0].SongSubmissionID != "" || list[0].SongURL != "" {
			t.Errorf("a draft must stay artist-private, got %q / %q", list[0].SongSubmissionID, list[0].SongURL)
		}
	})

	t.Run("a playable status with no song object is not surfaced", func(t *testing.T) {
		c := railTestContest(t, pool, 0)
		u := railTestVoter(t, pool)
		seedRosterContestant(t, pool, c, u, "ZZ no bytes")
		// Approved, published even — but the summary names no object key, so
		// there are no bytes behind it and the reader would 404.
		seedSongEntry(t, pool, c, u, "published_for_voting", `{"stageName":"no bytes"}`, time.Hour)

		list, err := repo.ListRoster(ctx, c, false, "")
		if err != nil {
			t.Fatalf("ListRoster: %v", err)
		}
		if len(list) != 1 {
			t.Fatalf("roster length = %d, want 1", len(list))
		}
		if list[0].SongSubmissionID != "" {
			t.Errorf("a row without an object key has no bytes to play, got %q", list[0].SongSubmissionID)
		}
	})

	t.Run("the newest playable submission wins", func(t *testing.T) {
		c := railTestContest(t, pool, 0)
		u := railTestVoter(t, pool)
		seedRosterContestant(t, pool, c, u, "ZZ two songs")
		older := seedSongEntry(t, pool, c, u, "submitted", songSummary(uuid.NewString()), 48*time.Hour)
		newer := seedSongEntry(t, pool, c, u, "finalist", songSummary(uuid.NewString()), time.Hour)
		if older == newer {
			t.Fatal("fixture ids collided")
		}

		list, err := svc.ListRoster(ctx, c, false, "")
		if err != nil {
			t.Fatalf("ListRoster: %v", err)
		}
		if list[0].SongSubmissionID != newer {
			t.Errorf("SongSubmissionID = %q, want the newest %q (older was %q)", list[0].SongSubmissionID, newer, older)
		}
		if list[0].SongStatus != "finalist" {
			t.Errorf("SongStatus = %q, want finalist", list[0].SongStatus)
		}
	})

	t.Run("another artist's song is never attached", func(t *testing.T) {
		c := railTestContest(t, pool, 0)
		singer := railTestVoter(t, pool)
		neighbour := railTestVoter(t, pool)
		singerID := seedRosterContestant(t, pool, c, singer, "ZZ singer")
		neighbourID := seedRosterContestant(t, pool, c, neighbour, "ZZ neighbour")
		seedSongEntry(t, pool, c, neighbour, "submitted", songSummary(uuid.NewString()), time.Hour)

		list, err := repo.ListRoster(ctx, c, false, "")
		if err != nil {
			t.Fatalf("ListRoster: %v", err)
		}
		byID := map[string]RosterEntry{}
		for _, e := range list {
			byID[e.ContestantID] = e
		}
		if len(byID) != 2 {
			t.Fatalf("roster length = %d, want 2", len(byID))
		}
		if byID[singerID].SongSubmissionID != "" {
			t.Errorf("the singer was handed the neighbour's song: %q", byID[singerID].SongSubmissionID)
		}
		if byID[neighbourID].SongSubmissionID == "" {
			t.Error("the neighbour's own song disappeared — the user key is wrong")
		}
	})

	t.Run("a song from another contest is never attached", func(t *testing.T) {
		u := railTestVoter(t, pool)
		seedSongEntry(t, pool, otherContestID, u, "winner", songSummary(uuid.NewString()), time.Hour)
		c := railTestContest(t, pool, 0)
		seedRosterContestant(t, pool, c, u, "ZZ cross contest")

		list, err := repo.ListRoster(ctx, c, false, "")
		if err != nil {
			t.Fatalf("ListRoster: %v", err)
		}
		if len(list) != 1 {
			t.Fatalf("roster length = %d, want 1", len(list))
		}
		if list[0].SongSubmissionID != "" {
			t.Errorf("an entry from contest %s leaked onto contest %s: %q", otherContestID, c, list[0].SongSubmissionID)
		}
	})

	t.Run("a guest contestant with no user has no song", func(t *testing.T) {
		c := railTestContest(t, pool, 0)
		seedRosterContestant(t, pool, c, "", "ZZ guest") // user_id NULL, as the seam promotes guests
		list, err := repo.ListRoster(ctx, c, false, "")
		if err != nil {
			t.Fatalf("ListRoster: %v", err)
		}
		if len(list) != 1 || list[0].SongSubmissionID != "" {
			t.Errorf("guest row should be present and songless, got %+v", list)
		}
	})
}
