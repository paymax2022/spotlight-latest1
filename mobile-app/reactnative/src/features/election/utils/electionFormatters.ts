import type { Election, ElectionStatus } from '../types/election.types';

// The election window is the source of truth for "is it live right now".
export function isLiveNow(e: Pick<Election, 'startsAt' | 'endsAt'>): boolean {
  const now = Date.now();
  return now >= +new Date(e.startsAt) && now < +new Date(e.endsAt);
}

export function hasEnded(e: Pick<Election, 'endsAt'>): boolean {
  return Date.now() >= +new Date(e.endsAt);
}

// Derive a display status from the window + publish flag (server status is a hint).
export function derivedStatus(e: Election): ElectionStatus {
  if (e.resultsPublished) return 'results_published';
  if (hasEnded(e)) return 'closed';
  if (isLiveNow(e)) return 'live';
  return 'scheduled';
}

// Compact countdown, e.g. "2h 14m left", "Starts in 3d 4h".
function fmtDelta(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

export function countdownLabel(e: Election): string {
  const now = Date.now();
  if (isLiveNow(e)) return `Closes in ${fmtDelta(+new Date(e.endsAt) - now)}`;
  if (now < +new Date(e.startsAt)) return `Starts in ${fmtDelta(+new Date(e.startsAt) - now)}`;
  return 'Voting closed';
}

export function totalVotesFor(positionCandidates: { votes: number }[]): number {
  return positionCandidates.reduce((s, c) => s + c.votes, 0);
}
