import type { OpenMicContest } from './types';

/**
 * One definition of what the admin's two voting display switches mean, for
 * every surface that shows standings: the programme page's step block, the
 * `/entries` board and the SSE snapshot.
 *
 * `!== false` is the whole rule. A contest whose `sponsor_assets` carries no
 * `voting` block — every row written before the admin form grew these
 * switches — reads as "both on", because treating absent as off would hide
 * standings nobody ever configured.
 */
export type OpenMicStandingsSwitches = {
  showLeaderboard: boolean;
  showVoteCounts: boolean;
};

type VotingSwitches = Pick<
  NonNullable<OpenMicContest['votingConfig']>,
  'leaderboardVisible' | 'voteCountPublic'
>;

export function standingsSwitches(
  voting: Partial<VotingSwitches> | null | undefined,
): OpenMicStandingsSwitches {
  return {
    showLeaderboard: voting?.leaderboardVisible !== false,
    showVoteCounts: voting?.voteCountPublic !== false,
  };
}

/**
 * The stream's redaction rule. Two independent signals have to say the numbers
 * may travel: the contest must be publicly listed (`visibility`, the gate this
 * route had already) and the admin must not have marked the counts private
 * (`voteCountPublic`). Absent the second check, marking counts private left
 * every `public_vote_count` and `leaderboard_score` streaming to any browser
 * that opened an EventSource.
 *
 * Takes the raw row rather than a mapped contest because the route reads
 * `contests` directly; `sponsor_assets` is where the switch actually lives.
 */
/** The two columns of a `contests` row the stream's gate reads. */
export type StreamCountGateRow = {
  visibility?: string | null;
  sponsor_assets?: { voting?: { voteCountPublic?: boolean } } | null;
};

export function streamCountsVisible(row: StreamCountGateRow): boolean {
  return row.visibility === 'public' && standingsSwitches(row.sponsor_assets?.voting).showVoteCounts;
}

/**
 * Standing numbers as the per-artist voting card receives them.
 *
 * Props that cross into a client component are serialised into the served
 * HTML, so rendering a number conditionally still publishes it: `/entry/…`
 * carried `"voteCount":412` in its page source with the switches off. A hidden
 * number is `null` here, so it never reaches the payload at all.
 */
export function clientStandings(
  switches: OpenMicStandingsSwitches,
  data: { voteCount: number; totalVotes: number; rank: number },
): OpenMicStandingsSwitches & {
  voteCount: number | null;
  totalVotes: number | null;
  rank: number | null;
} {
  return {
    ...switches,
    voteCount: switches.showVoteCounts ? data.voteCount : null,
    totalVotes: switches.showVoteCounts ? data.totalVotes : null,
    rank: switches.showLeaderboard ? data.rank : null,
  };
}

/** The same rule for the board's rows: one entry array, tally per row. */
export function clientEntryRows<T extends { voteCount: number }>(
  rows: T[],
  switches: OpenMicStandingsSwitches,
): Array<Omit<T, 'voteCount'> & { voteCount: number | null }> {
  return rows.map((row) => ({
    ...row,
    voteCount: switches.showVoteCounts ? row.voteCount : null,
  }));
}
