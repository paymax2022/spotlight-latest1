// ── Competition leaderboard ranking (pure) ───────────────────────────────────
// The viewer's own score is the single source of truth (their earned points);
// the board is then re-ranked so a learner who earns points actually moves up.
// Pure + deterministic (stable tie order) so it is unit-testable and mirrors the
// server's `RANK() OVER (ORDER BY score DESC)` shape.

/** Any leaderboard row: needs a numeric score, a rank slot and an isMe flag. */
type Rankable = { score: number; rank: number; isMe: boolean };

/**
 * Recompute a leaderboard from a set of rows and the live viewer score.
 * - the `isMe` row's score is overwritten with `viewerScore` (single source);
 * - all rows are sorted by score DESC (ties keep input order — stable);
 * - ranks are reassigned 1..N contiguously.
 * Pure: never mutates the input rows or array.
 */
export function rankByScore<T extends Rankable>(entries: readonly T[], viewerScore: number): T[] {
  const scored = entries.map((e) => (e.isMe ? { ...e, score: viewerScore } : { ...e }));
  // Stable sort by score desc: keep original order for equal scores so ties are
  // deterministic regardless of the engine's sort stability guarantees.
  const withIndex = scored.map((e, i) => ({ e, i }));
  withIndex.sort((a, b) => b.e.score - a.e.score || a.i - b.i);
  return withIndex.map(({ e }, i) => ({ ...e, rank: i + 1 }));
}

/** The viewer's rank in an already-ranked board (undefined if no isMe row). */
export function viewerRank<T extends { isMe: boolean; rank: number }>(ranked: readonly T[]): number | undefined {
  return ranked.find((e) => e.isMe)?.rank;
}
