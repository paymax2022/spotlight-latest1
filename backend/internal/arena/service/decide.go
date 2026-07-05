// Package service holds the Arena orchestration services and the PURE decision
// helpers they call. The helpers here take no DB/network dependency so they can
// be unit-tested directly and reused by handlers, keeping the money/merit
// firewall (NDC-1) and the advancement rule (merit-only) auditable at one place.
package service

import (
	"sort"

	"spotlight/backend/internal/arena"
)

// ── Support-rail aggregates (money → display only, NEVER merit) ──────────────

// SupportRow is one tagged Support contribution (already ledgered).
type SupportRow struct {
	ContestantID string
	HomeState    string
	AmountKobo   int64
}

// PotTotalKobo sums Support contributions into the standing pot total. Integer
// kobo only (IRON RULE). This is a projection over ledgered rows — the pot is
// never a stored mutable balance.
func PotTotalKobo(rows []SupportRow) int64 {
	var total int64
	for _, r := range rows {
		total += r.AmountKobo
	}
	return total
}

// PeoplesChampion returns the contestant_id with the highest Support total and
// the tally per contestant. Ties break by contestant_id (deterministic). This is
// a Support-fed award (NOT merit) — arena.AwardFedByMeritOnly(PeoplesChampion)
// is false, enforcing that it can never influence the crown.
func PeoplesChampion(rows []SupportRow) (winner string, tally map[string]int64) {
	tally = map[string]int64{}
	for _, r := range rows {
		if r.ContestantID == "" {
			continue
		}
		tally[r.ContestantID] += r.AmountKobo
	}
	ids := make([]string, 0, len(tally))
	for id := range tally {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var best int64 = -1
	for _, id := range ids {
		if tally[id] > best {
			best, winner = tally[id], id
		}
	}
	return winner, tally
}

// StatePride returns the home_state with the highest Support total and the
// per-state tally. Ties break by state code (deterministic).
func StatePride(rows []SupportRow) (winner string, tally map[string]int64) {
	tally = map[string]int64{}
	for _, r := range rows {
		if r.HomeState == "" {
			continue
		}
		tally[r.HomeState] += r.AmountKobo
	}
	states := make([]string, 0, len(tally))
	for s := range tally {
		states = append(states, s)
	}
	sort.Strings(states)
	var best int64 = -1
	for _, s := range states {
		if tally[s] > best {
			best, winner = tally[s], s
		}
	}
	return winner, tally
}

// ── Merit leaderboard (the ONLY input to advancement — NDC-1) ────────────────

// LeaderRow is a contestant's aggregate merit at a stage (projection of the
// signed merit ledger via the arena_merit_leaderboard matview).
type LeaderRow struct {
	ContestantID string
	Stage        arena.Stage
	TotalScore   float64
}

// RankMerit sorts contestants by total merit descending (ties by contestant_id,
// deterministic) and returns their ordered ids. This is the sole ranking used
// for QUALIFIED/FINALIST/CROWNED advancement.
func RankMerit(rows []LeaderRow) []string {
	cp := make([]LeaderRow, len(rows))
	copy(cp, rows)
	sort.SliceStable(cp, func(i, j int) bool {
		if cp[i].TotalScore != cp[j].TotalScore {
			return cp[i].TotalScore > cp[j].TotalScore
		}
		return cp[i].ContestantID < cp[j].ContestantID
	})
	out := make([]string, len(cp))
	for i, r := range cp {
		out[i] = r.ContestantID
	}
	return out
}

// TopN returns the top-n contestant ids by merit (used to pick who QUALIFIES /
// becomes a FINALIST). n <= 0 or n beyond the field returns the full ranking.
func TopN(rows []LeaderRow, n int) []string {
	ranked := RankMerit(rows)
	if n <= 0 || n >= len(ranked) {
		return ranked
	}
	return ranked[:n]
}

// MeritLeader returns the single top-ranked contestant (the crown holder) or ""
// when the field is empty.
func MeritLeader(rows []LeaderRow) string {
	ranked := RankMerit(rows)
	if len(ranked) == 0 {
		return ""
	}
	return ranked[0]
}

// AdvancementQualifies reports whether `contestant` is within the top-n of the
// merit ranking, i.e. whether a merit-only advancement to `to` is justified. It
// panics-guards nothing about money because it receives ONLY merit rows.
func AdvancementQualifies(rows []LeaderRow, contestant string, topN int) bool {
	for _, id := range TopN(rows, topN) {
		if id == contestant {
			return true
		}
	}
	return false
}

// ── Play-Along credential threshold (engagement → credential, NEVER merit) ───

// PassesCertification reports whether a spectator's cumulative Play-Along points
// meet the config threshold to earn a CERTIFIED_SAFE_DRIVER credential.
func PassesCertification(points, threshold int) bool {
	return threshold > 0 && points >= threshold
}
