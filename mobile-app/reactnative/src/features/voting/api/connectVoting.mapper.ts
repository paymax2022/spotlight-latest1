// Maps the Go backend's Connect voting shapes (/api/v1/connect/contests/*) onto
// the mobile voting types.
// The two models differ in one important way: the backend's immutable vote log
// keys a vote by `option_ref`, a plain string. For roster contests that string
// IS the contestant id, which is what lets the roster and the tally join
// without touching the append-only vote table. Everything below assumes that
// convention and nothing else.

import type { Contest, Contestant, ContestStatus, LeaderboardEntry } from '../types/voting.types';
import { formatAmount } from '../utils/voteFormatters';

/**
 * One row of the contest's prize ladder — public.voting_contest_prizes, written by
 * the console's prize editor and read back by Go's detail endpoint.
 */
export interface BackendContestPrize {
  position: number;
  description: string;
  /** Null when the organizer described the prize without pricing it. */
  value_kobo?: number | null;
}

/** One row of GET /api/v1/connect/contests/:id/contestants. */
export interface BackendRosterEntry {
  contestant_id: string;
  name: string;
  stage_name: string;
  category: string;
  state: string;
  bio: string;
  photo_url: string;
  media_url: string;
  status: string;
  is_active: boolean;
  free_votes: number;
  paid_votes: number;
  total_votes: number;
  rank: number;
  like_count?: number;
  share_count?: number;
  liked_by_me?: boolean;
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
  rules_text?: string;
  banner_image_url?: string;
  logo_url?: string;
  /**
   * The two prize rails, both served by GET /contests/:id: the free-text headline
   * from public.contests.prize_pool (the console's "Price to be won" field) and the
   * structured per-position ladder from public.voting_contest_prizes (the console's
   * prize editor). A contest can have either, both or neither, and the screen has one
   * list — so prizeLines picks between them instead of printing the same promise twice.
   */
  prize_text?: string;
  prizes?: BackendContestPrize[];
}

/**
 * Turns either prize rail into the bullet lines contest-details.tsx renders.
 *
 * The ladder wins when it exists: it is the same promise the organizer filled in
 * more precisely, and printing both rails would show "₦500,000" twice. Otherwise the
 * headline is the single line — and it stays first, which is where the screen paints
 * the gold dot.
 *
 * A row with neither description nor amount is dropped rather than rendered empty,
 * and a description without an amount shows text alone — never "— ₦0", which reads as
 * a prize worth nothing. When neither rail carries anything, the field is undefined so
 * the section hides instead of opening on an empty card.
 */
function prizeLines(raw: BackendContest): string[] | undefined {
  const ladder = (raw.prizes ?? [])
    // Sorted here as well as in Go because the gold dot is index 0: a wire that
    // arrives out of order would crown the runner-up and every layer below it
    // reports success. Cheap guarantee, not a workaround.
    .slice()
    .sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0))
    .map((p) => {
      const text = (p?.description ?? '').trim();
      const kobo = typeof p?.value_kobo === 'number' && p.value_kobo > 0 ? p.value_kobo : null;
      const amount = kobo === null ? '' : formatAmount(kobo);
      return text && amount ? `${text} — ${amount}` : text || amount;
    })
    .filter(Boolean);
  if (ladder.length) return ladder;
  const headline = (raw.prize_text ?? '').trim();
  return headline ? [headline] : undefined;
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
  totalLikes = 0,
  totalShares = 0,
): Contest {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? undefined,
    category: '',
    status: mapStatus(raw.status),
    contestantCount,
    totalVotes,
    totalLikes,
    totalShares,
    startsAt: raw.opens_at ?? undefined,
    endsAt: raw.closes_at ?? undefined,
    freeVotesPerDay: raw.free_votes_per_user ?? 0,
    paidVotingEnabled: (raw.paid_vote_kobo ?? 0) > 0,
    rulesText: raw.rules_text || undefined,
    bannerImage: raw.banner_image_url || undefined,
    logoImage: raw.logo_url || undefined,
    prizes: prizeLines(raw),
  };
}

export function mapContestant(raw: BackendRosterEntry, contestId: string): Contestant {
  return {
    id: raw.contestant_id,
    contestId,
    name: raw.name,
    stageName: raw.stage_name || undefined,
    category: raw.category || undefined,
    state: raw.state || undefined,
    photo: raw.photo_url || undefined,
    mediaUrl: raw.media_url || undefined,
    bio: raw.bio || undefined,
    rank: raw.rank,
    votes: raw.total_votes,
    likeCount: raw.like_count ?? 0,
    shareCount: raw.share_count ?? 0,
    likedByMe: raw.liked_by_me ?? false,
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
