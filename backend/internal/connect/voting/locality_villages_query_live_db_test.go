package connectvoting

// LIVE-DB test for the village read: the curated list, its order, and the
// empty-is-not-an-error rule.
//
// Why live: the names live in public.villages, which 20272000000000 seeds with
// exactly the 15 quarters a human supplied for Onitsha North. A read that
// silently filtered on the wrong column, or that returned an error for an
// uncurated LGA, turns the picker into either a blank list with no explanation or
// a red screen on 773 LGAs that are supposed to fall back to free text.
//
// GATED ON TEST_DATABASE_URL only (see railTestPool):
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/voting/ -run TestLiveDB_Villages -v

import (
	"context"
	"sort"
	"testing"
)

func TestLiveDB_VillagesCuratedList(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	got, err := repo.ListVillages(ctx, localityState, localityLGA)
	if err != nil {
		t.Fatalf("ListVillages: %v", err)
	}
	if len(got) != len(onitshaQuarters) {
		t.Fatalf("villages = %d rows, want %d: %v", len(got), len(onitshaQuarters), got)
	}

	names := make([]string, 0, len(got))
	for _, v := range got {
		names = append(names, v.Name)
	}

	// Same set, by exact spelling: the picker's value is what lands on
	// contestants.village, so a case or spacing drift here is data drift later.
	want := append([]string(nil), onitshaQuarters...)
	sort.Strings(want)
	if !sort.StringsAreSorted(names) {
		t.Errorf("villages are not alphabetical: %v — the picker renders the response order, so an unordered read scrambles it on every load", names)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Errorf("villages = %v, want the supplied list %v", names, want)
			break
		}
	}
}

// An LGA nobody curated answers 200 + mode=free_text, and the service (not the
// caller) is what decides that.
func TestLiveDB_VillagesUncuratedLGAIsFreeText(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()
	repo := NewRepository(pool)
	svc := NewService(repo, nil, nil, nil, nil)

	empty, err := repo.ListVillages(ctx, localityState, "Onitsha South")
	if err != nil {
		t.Fatalf("uncurated LGA must not error, got %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("Onitsha South carries %d curated villages; only the LGA that was named may have rows", len(empty))
	}

	list, err := svc.Villages(ctx, localityState, "Onitsha South")
	if err != nil {
		t.Fatalf("Villages(uncurated): %v", err)
	}
	if list.Mode != "free_text" {
		t.Errorf("mode = %q, want free_text — a picker that renders an empty select instead of a text field blocks the application", list.Mode)
	}
	if list.Villages == nil {
		t.Error("villages = nil, want an empty slice")
	}

	// The curated case, through the same service entry point.
	full, err := svc.Villages(ctx, localityState, localityLGA)
	if err != nil {
		t.Fatalf("Villages(curated): %v", err)
	}
	if full.Mode != "curated" || len(full.Villages) != len(onitshaQuarters) {
		t.Errorf("mode=%q with %d villages, want curated with %d", full.Mode, len(full.Villages), len(onitshaQuarters))
	}
}

// is_active=false hides a quarter from the picker without deleting the answer an
// applicant already stored — the property the column exists for.
func TestLiveDB_VillagesInactiveAreHidden(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	if _, err := pool.Exec(ctx, `
		UPDATE public.villages SET is_active = false
		WHERE state = $1 AND lga = $2 AND name = $3`,
		localityState, localityLGA, localityVillage15); err != nil {
		t.Fatalf("deactivate %s: %v", localityVillage15, err)
	}
	t.Cleanup(func() {
		clean := context.WithoutCancel(ctx)
		_, _ = pool.Exec(clean, `
			UPDATE public.villages SET is_active = true
			WHERE state = $1 AND lga = $2 AND name = $3`,
			localityState, localityLGA, localityVillage15)
	})

	got, err := repo.ListVillages(ctx, localityState, localityLGA)
	if err != nil {
		t.Fatalf("ListVillages: %v", err)
	}
	if len(got) != len(onitshaQuarters)-1 {
		t.Fatalf("villages = %d, want %d after deactivating one", len(got), len(onitshaQuarters)-1)
	}
	for _, v := range got {
		if v.Name == localityVillage15 {
			t.Errorf("%s is still offered after being deactivated", localityVillage15)
		}
	}
}
