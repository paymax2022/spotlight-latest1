package connectgamification

import (
	"context"
	"errors"
	"testing"
)

// TestLevelFor exercises the pure XP -> display-level derivation. Level is a flat
// xpPerLevel (1000) cost per level, floored at 1, so the interesting cases are the
// per-level boundaries and the non-positive clamp.
func TestLevelFor(t *testing.T) {
	t.Parallel()

	// Guard the constant the boundaries below are computed from, so this test
	// stays honest if xpPerLevel is ever retuned.
	if xpPerLevel != 1000 {
		t.Fatalf("test assumes xpPerLevel==1000, got %d", xpPerLevel)
	}

	cases := []struct {
		name    string
		totalXP int64
		want    int
	}{
		{"negative clamps to level 1", -500, 1},
		{"zero clamps to level 1", 0, 1},
		{"one xp is still level 1", 1, 1},
		{"just below first boundary", 999, 1},
		{"exactly first boundary promotes", 1000, 2},
		{"just past first boundary", 1001, 2},
		{"just below second boundary", 1999, 2},
		{"exactly second boundary promotes", 2000, 3},
		{"mid third level", 2500, 3},
		{"large value", 999999, 1000},
		{"exact large boundary", 1000000, 1001},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := levelFor(tc.totalXP); got != tc.want {
				t.Fatalf("levelFor(%d) = %d, want %d", tc.totalXP, got, tc.want)
			}
		})
	}
}

// TestLevelForMonotonic asserts the derived level never decreases as XP grows and
// only ever steps up by one at a boundary — the property the dashboard relies on.
func TestLevelForMonotonic(t *testing.T) {
	t.Parallel()
	prev := levelFor(0)
	for xp := int64(1); xp <= 10_000; xp++ {
		cur := levelFor(xp)
		if cur < prev {
			t.Fatalf("level decreased at xp=%d: %d -> %d", xp, prev, cur)
		}
		if cur-prev > 1 {
			t.Fatalf("level jumped more than one at xp=%d: %d -> %d", xp, prev, cur)
		}
		prev = cur
	}
}

// TestAwardXPValidation covers the input-guard branch of AwardXP, which rejects an
// empty event key or a non-positive XP amount BEFORE any repository call. A nil
// repo is safe here precisely because the guard returns early; a regression that
// moved the DB call ahead of the guard would panic and fail this test.
func TestAwardXPValidation(t *testing.T) {
	t.Parallel()
	svc := NewService(nil, nil)

	cases := []struct {
		name string
		in   AwardInput
	}{
		{"empty event key", AwardInput{EventKey: "", XP: 10}},
		{"zero xp", AwardInput{EventKey: "e1", XP: 0}},
		{"negative xp", AwardInput{EventKey: "e1", XP: -5}},
		{"empty key and zero xp", AwardInput{EventKey: "", XP: 0}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			awarded, err := svc.AwardXP(context.Background(), "user-1", tc.in)
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("AwardXP(%+v) err = %v, want ErrInvalidInput", tc.in, err)
			}
			if awarded {
				t.Fatalf("AwardXP(%+v) awarded = true, want false on invalid input", tc.in)
			}
		})
	}
}

// TestUpsertMissionValidation covers the guard branch that rejects a mission with a
// missing code or title before hitting the repo/auditor. Nil repo+audit are safe
// because the guard returns first.
func TestUpsertMissionValidation(t *testing.T) {
	t.Parallel()
	svc := NewService(nil, nil)

	cases := []struct {
		name string
		in   UpsertMissionInput
	}{
		{"missing code", UpsertMissionInput{Code: "", Title: "Daily login"}},
		{"missing title", UpsertMissionInput{Code: "daily_login", Title: ""}},
		{"missing both", UpsertMissionInput{}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			m, err := svc.UpsertMission(context.Background(), "admin-1", tc.in)
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("UpsertMission(%+v) err = %v, want ErrInvalidInput", tc.in, err)
			}
			if m != nil {
				t.Fatalf("UpsertMission(%+v) returned mission %+v, want nil", tc.in, m)
			}
		})
	}
}

// TestUpsertSeasonValidation covers the guard branch that rejects a season with a
// missing code or name before hitting the repo/auditor.
func TestUpsertSeasonValidation(t *testing.T) {
	t.Parallel()
	svc := NewService(nil, nil)

	cases := []struct {
		name string
		in   UpsertSeasonInput
	}{
		{"missing code", UpsertSeasonInput{Code: "", Name: "Season One"}},
		{"missing name", UpsertSeasonInput{Code: "s1", Name: ""}},
		{"missing both", UpsertSeasonInput{}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			se, err := svc.UpsertSeason(context.Background(), "admin-1", tc.in)
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("UpsertSeason(%+v) err = %v, want ErrInvalidInput", tc.in, err)
			}
			if se != nil {
				t.Fatalf("UpsertSeason(%+v) returned season %+v, want nil", tc.in, se)
			}
		})
	}
}
