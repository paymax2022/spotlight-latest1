package connectvoting

// LIVE-DB test: locality must reach the API, not just the database.
//
// Why live: 20272000000000 put locality_state/_lga/_village on connect_contests
// and lga/village on contestants, and the mirror trigger carries them. That is
// necessary but not sufficient — Go reads connect_contests through an explicit
// column list (`contestColumns`) and the roster through two hand-written
// SELECTs whose scan lists are positional. A column that is not in the SELECT
// is invisible no matter how correct the trigger is, and a scan list that is out
// of step with its SELECT fails at runtime on a real row only.
//
// Three things are pinned here:
//   - the contest reads (detail + list) carry what the console stored;
//   - the roster reads (list + profile) carry what promotion stored;
//   - the JSON key names the mobile mapper reads.
//
// GATED ON TEST_DATABASE_URL only (see railTestPool):
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/voting/ -run TestLiveDB_LocalityServed -v

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// seedLocalContest writes the row the admin console writes for a local contest —
// on the LEGACY plane, so the mirror trigger is part of what this exercises.
func seedLocalContest(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	slug := "zz-local-" + id[:8]
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO public.contests
			(id, name, slug, status, category, location_scope,
			 locality_state, locality_lga, locality_village)
		VALUES ($1, $2, $3, 'active', 'Music', 'village', $4, $5, $6)`,
		id, "ZZ local "+id[:8], slug, localityState, localityLGA, localityVillage15); err != nil {
		t.Fatalf("seed local contest: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(context.Background())
		_, _ = pool.Exec(ctx, `DELETE FROM public.contestants WHERE connect_contest_id = $1::uuid`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM public.connect_contests WHERE id = $1::uuid`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM public.contests WHERE id = $1::uuid`, id)
	})
	return id
}

func TestLiveDB_LocalityServedOnContestReads(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	id := seedLocalContest(t, pool)

	got, err := repo.GetContest(ctx, id)
	if err != nil {
		t.Fatalf("GetContest: %v", err)
	}
	if got.LocalityState != localityState || got.LocalityLGA != localityLGA || got.LocalityVillage != localityVillage15 {
		t.Errorf("contest detail served %q/%q/%q, want %q/%q/%q — the phone reads this row, so a column missing from contestColumns means locality never displays",
			got.LocalityState, got.LocalityLGA, got.LocalityVillage, localityState, localityLGA, localityVillage15)
	}

	// The list is the card grid, and it scans the same column list through a
	// different function; both must carry it.
	list, err := repo.ListContests(ctx, 200)
	if err != nil {
		t.Fatalf("ListContests: %v", err)
	}
	var found bool
	for _, c := range list {
		if c.ID != id {
			continue
		}
		found = true
		if c.LocalityLGA != localityLGA || c.LocalityVillage != localityVillage15 {
			t.Errorf("contest list served %q/%q for the local contest, want %q/%q",
				c.LocalityLGA, c.LocalityVillage, localityLGA, localityVillage15)
		}
	}
	if !found {
		t.Fatalf("local contest %s missing from ListContests", id)
	}
}

func TestLiveDB_LocalityServedOnRosterReads(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	id := seedLocalContest(t, pool)

	contestantID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.contestants
			(id, name, connect_contest_id, state, lga, village, status, is_active)
		VALUES ($1::uuid, 'ZZ local artist', $2::uuid, $3, $4, $5, 'approved', true)`,
		contestantID, id, localityState, localityLGA, "Ogbendida"); err != nil {
		t.Fatalf("seed contestant: %v", err)
	}

	list, err := repo.ListRoster(ctx, id, false, "")
	if err != nil {
		t.Fatalf("ListRoster: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("roster length = %d, want 1", len(list))
	}
	got := list[0]
	if got.State != localityState || got.LGA != localityLGA || got.Village != "Ogbendida" {
		t.Errorf("roster served %q/%q/%q, want %q/%q/%q — the locality filter can only run on what the roster row carries",
			got.State, got.LGA, got.Village, localityState, localityLGA, "Ogbendida")
	}

	// The profile screen reads the other roster SELECT; a locality shown on the
	// list but blank on the profile is the same bug the song join guards against.
	one, err := repo.GetRosterEntry(ctx, contestantID, "")
	if err != nil {
		t.Fatalf("GetRosterEntry: %v", err)
	}
	if one == nil {
		t.Fatalf("GetRosterEntry returned nil for an active contestant")
	}
	if one.LGA != got.LGA || one.Village != got.Village {
		t.Errorf("profile disagrees with roster: %q/%q vs %q/%q",
			one.LGA, one.Village, got.LGA, got.Village)
	}
}

// TestLiveDB_LocalityWireKeys pins the JSON names. The mobile mapper is
// `state: e.state`-style field reads, so a renamed tag is a silent blank card on
// a shipped phone build, not a compile error.
func TestLiveDB_LocalityWireKeys(t *testing.T) {
	contestJSON, err := json.Marshal(Contest{
		ID: "c1", LocalityState: localityState, LocalityLGA: localityLGA, LocalityVillage: localityVillage15,
	})
	if err != nil {
		t.Fatalf("marshal contest: %v", err)
	}
	var contest map[string]any
	if err := json.Unmarshal(contestJSON, &contest); err != nil {
		t.Fatalf("unmarshal contest: %v", err)
	}
	for key, want := range map[string]string{
		"locality_state":   localityState,
		"locality_lga":     localityLGA,
		"locality_village": localityVillage15,
	} {
		if got, ok := contest[key].(string); !ok || got != want {
			t.Errorf("contest JSON key %q = %v, want %q — mobile reads this exact name", key, contest[key], want)
		}
	}

	rosterJSON, err := json.Marshal(RosterEntry{
		ContestantID: "r1", State: localityState, LGA: localityLGA, Village: "Ogbendida",
	})
	if err != nil {
		t.Fatalf("marshal roster: %v", err)
	}
	var roster map[string]any
	if err := json.Unmarshal(rosterJSON, &roster); err != nil {
		t.Fatalf("unmarshal roster: %v", err)
	}
	for key, want := range map[string]string{
		"state":   localityState,
		"lga":     localityLGA,
		"village": "Ogbendida",
	} {
		if got, ok := roster[key].(string); !ok || got != want {
			t.Errorf("roster JSON key %q = %v, want %q — mobile reads this exact name", key, roster[key], want)
		}
	}
}
