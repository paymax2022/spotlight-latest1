package services

import "spotlight/backend/internal/domain"

// leaderboardRankStore is an OPTIONAL capability a StemRepository may implement
// to persist and read previous-rank snapshots. It is deliberately separate from
// the core StemRepository interface so existing implementations (and test stubs)
// need not change — the service type-asserts for it at runtime. This keeps the
// rankChange feature an additive extension of the projection layer; it never
// reaches into the protected voting-module internals.
type leaderboardRankStore interface {
	// GetLeaderboardRankSnapshot returns the participant→rank map from the most
	// recent snapshot for a contest (empty map when none exists).
	GetLeaderboardRankSnapshot(contestID string) (map[string]int, error)
	// SaveLeaderboardRankSnapshot persists the current participant→rank map as a
	// new immutable snapshot row for the contest.
	SaveLeaderboardRankSnapshot(contestID string, ranks map[string]int) error
}

// ComputeRankChange annotates each current leaderboard entry with its movement
// relative to a previous-rank snapshot. Pure function — no I/O.
//
//	previous[participantID] = prior rank (1-based)
//
// Rules: lower rank number = higher position.
//   - prev > current rank  → "up"
//   - prev < current rank  → "down"
//   - prev == current rank → "same"
//   - participant absent from snapshot → "new" (PreviousRank stays 0)
func ComputeRankChange(current []domain.StemLeaderboardEntry, previous map[string]int) []domain.StemLeaderboardEntry {
	out := make([]domain.StemLeaderboardEntry, len(current))
	for i, e := range current {
		annotated := e
		prev, seen := previous[e.ParticipantID]
		if !seen || prev == 0 {
			annotated.PreviousRank = 0
			annotated.RankChange = "new"
		} else {
			annotated.PreviousRank = prev
			switch {
			case prev > e.RankPosition:
				annotated.RankChange = "up"
			case prev < e.RankPosition:
				annotated.RankChange = "down"
			default:
				annotated.RankChange = "same"
			}
		}
		out[i] = annotated
	}
	return out
}

// SnapshotFromEntries derives the participant→rank map to persist after a read,
// so the next read can compute deltas against it.
func SnapshotFromEntries(entries []domain.StemLeaderboardEntry) map[string]int {
	snap := make(map[string]int, len(entries))
	for _, e := range entries {
		snap[e.ParticipantID] = e.RankPosition
	}
	return snap
}

// ListLeaderboardWithRankChange returns the leaderboard annotated with rankChange.
// It reads the previous snapshot (if the repo supports snapshots), computes the
// delta, then persists the current ordering as the new snapshot for next time.
// When the underlying repo does not implement leaderboardRankStore, entries are
// returned with RankChange = "new" and persistence is skipped — fully additive
// and safe on existing deployments.
func (s *stemService) ListLeaderboardWithRankChange(contestID string, limit int) ([]domain.StemLeaderboardEntry, error) {
	entries, err := s.ListLeaderboard(contestID, limit)
	if err != nil {
		return nil, err
	}

	store, ok := s.repo.(leaderboardRankStore)
	if !ok {
		// No snapshot capability — annotate as first-run and return.
		return ComputeRankChange(entries, nil), nil
	}

	previous, err := store.GetLeaderboardRankSnapshot(contestID)
	if err != nil {
		// Fail soft: a snapshot read failure must not break the leaderboard.
		previous = nil
	}
	annotated := ComputeRankChange(entries, previous)

	// Persist the current ordering for the next read (best-effort, immutable row).
	_ = store.SaveLeaderboardRankSnapshot(contestID, SnapshotFromEntries(entries))

	return annotated, nil
}
