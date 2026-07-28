package services

import (
	"testing"

	"spotlight/backend/internal/domain"
)

// TestComputeRankChange covers the additive rankChange projection: given the
// current leaderboard ordering and a previous-rank snapshot, each entry is
// annotated up / down / same (and "new" when previously unseen). The voting
// module internals are never touched — this is pure projection logic.
func TestComputeRankChange(t *testing.T) {
	current := []domain.StemLeaderboardEntry{
		{ParticipantID: "p1", RankPosition: 1}, // was 2 → moved up
		{ParticipantID: "p2", RankPosition: 2}, // was 1 → moved down
		{ParticipantID: "p3", RankPosition: 3}, // was 3 → same
		{ParticipantID: "p4", RankPosition: 4}, // not in snapshot → new
	}
	previous := map[string]int{
		"p1": 2,
		"p2": 1,
		"p3": 3,
	}

	out := ComputeRankChange(current, previous)

	want := []struct {
		id         string
		prev       int
		rankChange string
	}{
		{"p1", 2, "up"},
		{"p2", 1, "down"},
		{"p3", 3, "same"},
		{"p4", 0, "new"},
	}
	if len(out) != len(want) {
		t.Fatalf("expected %d entries, got %d", len(want), len(out))
	}
	for i, w := range want {
		if out[i].ParticipantID != w.id {
			t.Fatalf("entry %d: id=%s want %s", i, out[i].ParticipantID, w.id)
		}
		if out[i].PreviousRank != w.prev {
			t.Errorf("%s: PreviousRank=%d want %d", w.id, out[i].PreviousRank, w.prev)
		}
		if out[i].RankChange != w.rankChange {
			t.Errorf("%s: RankChange=%q want %q", w.id, out[i].RankChange, w.rankChange)
		}
	}
	// Current rank must be preserved untouched by the projection.
	if out[0].RankPosition != 1 {
		t.Errorf("projection must not alter RankPosition")
	}
}

// TestComputeRankChange_NoSnapshot — with no prior snapshot every entry is "new"
// and PreviousRank is 0; the leaderboard still renders (first-run safe).
func TestComputeRankChange_NoSnapshot(t *testing.T) {
	current := []domain.StemLeaderboardEntry{
		{ParticipantID: "a", RankPosition: 1},
		{ParticipantID: "b", RankPosition: 2},
	}
	out := ComputeRankChange(current, nil)
	for _, e := range out {
		if e.RankChange != "new" {
			t.Errorf("%s: expected new, got %q", e.ParticipantID, e.RankChange)
		}
		if e.PreviousRank != 0 {
			t.Errorf("%s: expected PreviousRank 0, got %d", e.ParticipantID, e.PreviousRank)
		}
	}
}

// TestSnapshotFromEntries derives the participant→rank map that gets persisted
// after each leaderboard read, so the *next* read can compute deltas.
func TestSnapshotFromEntries(t *testing.T) {
	entries := []domain.StemLeaderboardEntry{
		{ParticipantID: "x", RankPosition: 5},
		{ParticipantID: "y", RankPosition: 6},
	}
	snap := SnapshotFromEntries(entries)
	if snap["x"] != 5 || snap["y"] != 6 {
		t.Fatalf("snapshot wrong: %+v", snap)
	}
	if len(snap) != 2 {
		t.Fatalf("expected 2 keys, got %d", len(snap))
	}
}
