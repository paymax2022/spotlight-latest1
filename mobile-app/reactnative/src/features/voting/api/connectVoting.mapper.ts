// Maps the Go backend's Connect voting shapes (/api/v1/connect/contests/*) onto
// the mobile voting types.
//
// The two models differ in one important way: the backend's immutable vote log
// keys a vote by `option_ref`, a plain string. For roster contests that string
// IS the contestant id, which is what lets the roster and the tally join
// without touching the append-only vote table. Everything below assumes that
// convention and nothing else.

import type { Contest, Contestant, ContestStatus, LeaderboardEntry } from '../types/voting.types';

/** One row of GET /api/v1/connect/contests/:id/contestants. */
export interface BackendRosterEntry {
  contestant_id: string;
  name: string;
  category: string;
  bio: string;
  photo_url: string;
  status: string;
  is_active: boolean;
  free_votes: number;
  paid_votes: number;
  total_votes: number;
  rank: number;
}

/** One row of GET /api/v1/connect/contests. */
export interface BackendContest {
  id: string;
  title: string;
  description?: string | null;
  status: string; // draft | open | closed
  paid_vote_kobo: number;
  free_votes_per_user: number;
  velocity_per_minute?: number;
  opens_at?: string | null;
  closes_at?: string | null;
  created_at?: string;
  /** Roster/tally summary returned by the list endpoint. */
  contestant_count?: number;
  total_votes?: number;
}

/**
 * The backend's lifecycle is draft|open|closed; the app's is richer. Anything
 * unrecognised maps to 'upcoming' rather than throwing, so a future backend
 * status cannot blank the contest list.
 */
function mapStatus(status: string): ContestStatus {
  switch (status) {
    case 'open':
      return 'LIVE';
    case 'closed':
      return 'CLOSED';
    case 'draft':
    default:
      return 'UPCOMING';
  }
}

export function mapContest(
  raw: BackendContest,
  contestantCount = raw.contestant_count ?? 0,
  totalVotes: number | null = raw.total_votes ?? null,
): Contest {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? undefined,
    category: '',
    status: mapStatus(raw.status),
    contestantCount,
    totalVotes,
    startsAt: raw.opens_at ?? undefined,
    endsAt: raw.closes_at ?? undefined,
    freeVotesPerDay: raw.free_votes_per_user ?? 0,
    paidVotingEnabled: (raw.paid_vote_kobo ?? 0) > 0,
  };
}

export function mapContestant(raw: BackendRosterEntry, contestId: string): Contestant {
  return {
    id: raw.contestant_id,
    contestId,
    name: raw.name,
    category: raw.category || undefined,
    photo: raw.photo_url || undefined,
    bio: raw.bio || undefined,
    rank: raw.rank,
    votes: raw.total_votes,
    // The roster only returns active contestants to members, so anything that
    // arrives here is in the running.
    status: 'ACTIVE',
  };
}

export function mapLeaderboardEntry(raw: BackendRosterEntry, contestId: string): LeaderboardEntry {
  return {
    rank: raw.rank,
    contestant: mapContestant(raw, contestId),
    votes: raw.total_votes,
  } as LeaderboardEntry;
}
