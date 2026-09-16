// Is this contest accepting votes right now?
//
// Mirrors the server's gate in backend/internal/connect/voting/service.go
// (`votingOpen`): status must be open AND now must fall inside
// [opens_at, closes_at]. The client used to check the STATUS ALONE, which meant a
// contest whose deadline had passed still rendered as Live with active vote
// buttons — the user tapped through to the vote sheet or the packages screen and
// only there met "Voting is closed for this contest". Nothing flips
// contests.status to 'ended' when the end date passes, so this is not a rare edge:
// it is the normal state of every contest after its deadline.
//
// This is a UX gate, not a security one. The server is the authority and already
// refuses a late vote; this exists so the app stops offering an action it knows
// will fail.

import type { Contest } from '../types/voting.types';

export type VotingClosedReason = 'not_live' | 'not_started' | 'ended';

export interface VotingWindow {
  open: boolean;
  /** Why voting is unavailable; undefined when it is open. */
  reason?: VotingClosedReason;
  /** Ready-to-render explanation, so screens do not each invent their own. */
  message?: string;
}

const parse = (iso?: string): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * @param contest  undefined while the query is in flight
 * @param now      injectable for tests
 */
export function getVotingWindow(contest?: Contest | null, now: number = Date.now()): VotingWindow {
  // An unknown contest is treated as OPEN so a pending query does not flash a
  // "closed" state over a contest that is running. Callers gate on `contest`
  // being loaded before they act on this.
  if (!contest) return { open: true };

  const opensAt = parse(contest.startsAt);
  const closesAt = parse(contest.endsAt);

  // The deadline wins over the status. A contest left at LIVE past its end date
  // is exactly the case this exists for, and the server would refuse the vote.
  if (closesAt !== null && now > closesAt) {
    return { open: false, reason: 'ended', message: 'Voting has closed for this contest.' };
  }
  if (opensAt !== null && now < opensAt) {
    return { open: false, reason: 'not_started', message: 'Voting has not opened yet.' };
  }
  if (contest.status !== 'LIVE') {
    return { open: false, reason: 'not_live', message: 'Voting is not open for this contest.' };
  }
  return { open: true };
}

/** Convenience for call sites that only need the boolean. */
export function isVotingOpen(contest?: Contest | null, now: number = Date.now()): boolean {
  return getVotingWindow(contest, now).open;
}
