// Maps the Go backend's Connect voting shapes (/api/v1/connect/contests/*) onto
// the mobile voting types.
// The two models differ in one important way: the backend's immutable vote log
// keys a vote by `option_ref`, a plain string. For roster contests that string
// IS the contestant id, which is what lets the roster and the tally join
// without touching the append-only vote table. Everything below assumes that
// convention and nothing else.

import type { Contest, Contestant, ContestStatus, LeaderboardEntry, VotePackage, VoteTransaction } from '../types/voting.types';
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
  /**
   * The village tier of the state -> LGA -> village cascade (migration
   * 20272000000000). Present-but-empty on a contestant who left the level blank;
   * absent entirely from a backend deployed before that migration, so both stay
   * optional here rather than pretending the old shape cannot arrive.
   */
  lga?: string;
  village?: string;
  bio: string;
  /**
   * The contestant's picture, already resolved by the API: since #1172 Go names
   * frontend-web's reader (`/api/v1/contestants/<id>/photo`) instead of signing the
   * stored R2 key, because the plane holding the bytes — bucket or its own disk — is
   * the only one that can answer for them. The value is absolute when the deployment
   * sets WEB_APP_BASE_URL and root-relative when it has not, and empty when nothing
   * renderable exists. Pass it through `contestantPhotoUri()` before handing it to an
   * `<Image>`, the same way `song_url` below goes through `mediaUrl()`.
   */
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
  /**
   * Emitted by the Go roster only for a song whose status is publicly playable
   * (`omitempty`, so absent means "nothing to play"). `song_url` is absolute
   * when the backend has a media base configured and root-relative when it has
   * not — pass it through `mediaUrl()` before handing it to a player.
   */
  song_submission_id?: string;
  song_status?: string;
  song_url?: string;
}

/**
 * One row of the BFF's GET /api/v1/contests/:id/vote-packages, which answers
 * with the server's own camelCase DTO straight from `public.vote_packages`.
 *
 * The units are the whole reason this type exists: `amount` is NAIRA, because
 * `vote_packages.amount` is a `numeric(12,2)` major-unit column that the admin
 * console writes in naira (its editor shows `amount × 100` kobo to the operator).
 * `VotePackage.amount` on this side is KOBO — payment-method.tsx hands it to
 * `checkout.start({ amountKobo })` and to `formatAmount`, which divides by 100 —
 * so the two only meet correctly through `nairaToKobo`.
 */
export interface BackendVotePackage {
  id: string;
  contestId?: string;
  name: string;
  description?: string | null;
  votes: number;
  bonusVotes?: number | null;
  totalVotes?: number | null;
  /** Naira major units. Absent or unreadable means "no price", not "free". */
  amount?: number | null;
  currency?: string;
  isActive?: boolean;
  isRecommended?: boolean;
  promoLabel?: string | null;
  displayOrder?: number;
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
    // Locality below the state. The roster emits both keys on every row (repo.go), so
    // a missing one means the applicant left that level blank, not that the field
    // does not exist — which is why they map to `undefined` and the card drops them
    // instead of rendering an empty segment. Optional on the entry type because a
    // backend deployed before 20272000000000 sends neither key at all.
    lga: raw.lga || undefined,
    village: raw.village || undefined,
    photo: raw.photo_url || undefined,
    mediaUrl: raw.media_url || undefined,
    bio: raw.bio || undefined,
    songUrl: raw.song_url || undefined,
    songStatus: raw.song_status || undefined,
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

/**
 * Naira (major units) → kobo, the only conversion between the two money columns
 * in this product. Rounds rather than truncates so a `numeric(12,2)` value like
 * 1999.99 stays 199,999 kobo, and returns 0 for anything unparseable: a broken
 * price must not reach the gateway as NaN.
 */
function nairaToKobo(amount: number | null | undefined): number {
  const naira = Number(amount ?? 0);
  if (!Number.isFinite(naira) || naira <= 0) return 0;
  return Math.round(naira * 100);
}

export function mapVotePackage(raw: BackendVotePackage): VotePackage {
  const bonusVotes = Number(raw.bonusVotes ?? 0);
  return {
    id: raw.id,
    // Base votes only: VotePackageCard prints `votes + bonusVotes` itself, so
    // folding the server's totalVotes in here would count the bonus twice.
    votes: Number(raw.votes ?? 0),
    amount: nairaToKobo(raw.amount),
    currency: 'NGN',
    // The DTO has no `label`; `name` is the pack title the console operator set.
    label: raw.name || undefined,
    bonusVotes: bonusVotes > 0 ? bonusVotes : undefined,
    // And no `popular`: the console's "Recommended" switch is `isRecommended`.
    isPopular: Boolean(raw.isRecommended),
  };
}

/** A row of connect_votes as the Go connect module returns it. */
export interface ConnectVoteRow {
  id: string;
  contest_id: string;
  contest_title: string;
  contestant_id: string;
  contestant_name: string;
  photo_url: string;
  paid: boolean;
  quantity: number;
  amount_kobo: number;
  created_at: string;
}

/**
 * connect_votes is an immutable log of votes that HAPPENED, so there is no
 * pending or failed row to represent: anything the caller can see already
 * counted. Mapping every row to SUCCESSFUL is the honest translation, not a
 * default — a status field that could only ever hold one value would invite the
 * screen to render a filter that never changes anything.
 *
 * amount_kobo is kobo and VoteTransaction.amount is kobo — the same client unit
 * as VotePackage.amount (#1170), what MOCK_VOTE_TRANSACTIONS writes, and what
 * formatAmount expects. This seam therefore passes the figure through. It used
 * to divide by 100 here, which the two screens that render it undid a second
 * time: my-votes.tsx and VoteReceiptCard.tsx both call formatAmount(tx.amount),
 * so a ₦500 vote printed "₦5". Do not "fix" that by changing the renderers to
 * treat amount as naira — the payment path reads the same field as kobo.
 *
 * Relocated here from voting.api.ts unchanged, so the money line is testable by
 * execution: voting.api.ts imports react-native-url-polyfill through the api
 * client and cannot load under `node --test`, which is why this suite's older
 * specs fell back to asserting source text. A number that renders 100× wrong is
 * not something a regex should be trusted to catch.
 */
export function toVoteTransaction(r: ConnectVoteRow): VoteTransaction {
  return {
    id: r.id,
    contestId: r.contest_id,
    contestantId: r.contestant_id,
    contestantName: r.contestant_name,
    contestTitle: r.contest_title,
    /**
     * Already a renderable URL, but not a signature: since #1172 Go names
     * frontend-web's reader (/api/v1/contestants/<id>/photo), which resolves the
     * stored key against its own bucket or disk. A pasted external URL comes
     * through unchanged; a value the reader cannot serve comes through empty,
     * and the screens fall back to their initials placeholder.
     */
    contestantPhoto: r.photo_url || undefined,
    voteType: r.paid ? 'PAID' : 'FREE',
    votes: r.quantity,
    amount: r.paid ? r.amount_kobo : undefined,
    currency: 'NGN',
    status: 'SUCCESSFUL',
    reference: r.id,
    createdAt: r.created_at,
  };
}
